import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/appError.js';
import { responderExito } from '../utils/response.js';
import { CONFIGURACION } from '../config/constantes.js';
import { enviarCorreoRecuperacion } from '../services/email.service.js';
import crypto from 'crypto';

/**
 * Revierte el registro de un usuario que rechazó las políticas de privacidad y términos.
 * Elimina los datos en cascada y purga el usuario de Supabase Auth.
 */
export async function rollbackRegistroController(req, res, next) {
  try {
    const usuarioId = req.usuario?.id;
    if (!usuarioId) {
      throw new AppError('Identificador de usuario no proporcionado en la sesión.', 400);
    }

    console.log(`[Auth Rollback] Iniciando purga por rechazo de términos: ${usuarioId}`);

    // 1. Eliminar consentimientos y perfil si existieran en la base de datos
    try {
      await supabaseAdmin.from('user_consents').delete().eq('user_id', usuarioId);
      await supabaseAdmin.from('profiles').delete().eq('id', usuarioId);
    } catch (dbErr) {
      console.warn('[Auth Rollback] Advertencia limpiando tablas públicas:', dbErr.message);
    }

    // 2. Eliminar el usuario de Supabase Auth de forma irreversible
    const { error: errorBorradoAuth } = await supabaseAdmin.auth.admin.deleteUser(usuarioId);
    if (errorBorradoAuth) {
      console.error('[Auth Rollback] Error eliminando usuario de Supabase Auth:', errorBorradoAuth.message);
      throw new AppError(`No se pudo eliminar el registro de autenticación: ${errorBorradoAuth.message}`, 500);
    }

    console.log(`[Auth Rollback] Usuario ${usuarioId} purgado exitosamente.`);

    return responderExito(res, {
      mensaje: 'Registro cancelado y cuenta eliminada satisfactoriamente debido al rechazo de términos y políticas.',
      eliminado: true
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Registra o audita la aceptación explícita de las políticas de privacidad y términos de uso.
 */
export async function registrarConsentimientoController(req, res, next) {
  try {
    const usuarioId = req.usuario?.id;
    const { policyVersion = '1.0.0', termsVersion = '1.0.0' } = req.body || {};

    if (!usuarioId) {
      throw new AppError('Usuario no autenticado para registrar consentimiento.', 401);
    }

    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    const userAgent = req.headers['user-agent'] || null;

    // Intentar registrar en Supabase public.user_consents si la tabla existe
    try {
      const { data, error } = await supabaseAdmin
        .from('user_consents')
        .upsert(
          {
            user_id: usuarioId,
            policy_version: policyVersion,
            terms_version: termsVersion,
            accepted_at: new Date().toISOString(),
            ip_address: typeof ipAddress === 'string' ? ipAddress.split(',')[0].trim() : null,
            user_agent: userAgent
          },
          { onConflict: 'user_id,policy_version' }
        );

      if (error) {
        console.warn('[Consentimiento] Aviso guardando en user_consents:', error.message);
      }
    } catch (dbErr) {
      console.warn('[Consentimiento] No se pudo persistir en tabla user_consents:', dbErr.message);
    }

    return responderExito(res, {
      mensaje: 'Consentimiento de Políticas de Privacidad y Términos de Uso registrado con éxito.',
      policyVersion,
      termsVersion,
      aceptado: true
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RECUPERACIÓN DE CONTRASEÑA CON OTP (EmailJS — sin Supabase Magic Link)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genera un OTP de 6 dígitos, lo guarda hasheado en public.password_resets
 * y lo envía al correo del usuario vía EmailJS.
 *
 * POST /api/auth/solicitar-recuperacion
 * Body: { email: string }
 */
export async function solicitarRecuperacionController(req, res, next) {
  try {
    const { email } = req.body || {};
    if (!email) throw new AppError('El correo electrónico es requerido.', 400);

    const emailNormalizado = email.trim().toLowerCase();

    // Verificar que el usuario existe consultando public.profiles
    const { data: perfil, error: errorBusqueda } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .ilike('email', emailNormalizado)
      .maybeSingle();

    if (errorBusqueda) {
      console.warn('[Recuperación] Advertencia consultando profiles:', errorBusqueda.message);
    }

    // Por seguridad, no revelamos si el correo existe o no
    if (!perfil) {
      return responderExito(res, {
        mensaje: 'Si el correo está registrado, recibirás las instrucciones en breve.'
      });
    }

    // Generar OTP de 6 dígitos
    const otpCodigo = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = crypto.createHash('sha256').update(otpCodigo).digest('hex');
    const expiresAt = new Date(
      Date.now() + CONFIGURACION.RECUPERACION.OTP_EXPIRA_MINUTOS * 60 * 1000
    ).toISOString();

    // Invalidar OTPs anteriores del mismo correo (evitar acumulación)
    await supabaseAdmin
      .from('password_resets')
      .update({ usado: true })
      .eq('email', emailNormalizado)
      .eq('usado', false);

    // Guardar nuevo OTP hasheado
    const { error: errorInsert } = await supabaseAdmin.from('password_resets').insert({
      email: emailNormalizado,
      otp_hash: otpHash,
      expires_at: expiresAt,
    });

    if (errorInsert) {
      console.error('[Recuperación] Error guardando OTP:', errorInsert.message);
      throw new AppError('Error generando código de recuperación.', 500);
    }

    // Enviar correo vía EmailJS
    await enviarCorreoRecuperacion(emailNormalizado, otpCodigo);

    console.log(`[Recuperación] OTP enviado a ${emailNormalizado}`);

    return responderExito(res, {
      mensaje: 'Si el correo está registrado, recibirás las instrucciones en breve.'
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Valida el OTP ingresado y actualiza la contraseña del usuario en Supabase Auth.
 *
 * POST /api/auth/restablecer-contrasena
 * Body: { email: string, otp: string, nuevaContrasena: string }
 */
export async function restablecerContrasenaController(req, res, next) {
  try {
    const { email, otp, nuevaContrasena } = req.body || {};

    if (!email || !otp || !nuevaContrasena) {
      throw new AppError('Correo, código OTP y nueva contraseña son requeridos.', 400);
    }
    if (nuevaContrasena.length < 6) {
      throw new AppError('La nueva contraseña debe tener al menos 6 caracteres.', 400);
    }

    const emailNormalizado = email.trim().toLowerCase();
    const otpHashIngresado = crypto.createHash('sha256').update(otp.trim()).digest('hex');

    // Buscar el OTP más reciente válido para ese correo
    const { data: registros, error: errorConsulta } = await supabaseAdmin
      .from('password_resets')
      .select('*')
      .eq('email', emailNormalizado)
      .eq('usado', false)
      .order('created_at', { ascending: false })
      .limit(1);

    if (errorConsulta) throw new AppError('Error verificando el código de recuperación.', 500);

    const registro = registros?.[0];

    if (!registro) {
      throw new AppError('Código inválido o ya utilizado. Solicita uno nuevo.', 400);
    }

    // Verificar expiración
    if (new Date() > new Date(registro.expires_at)) {
      await supabaseAdmin.from('password_resets').update({ usado: true }).eq('id', registro.id);
      throw new AppError(`El código ha expirado. Tiene validez de ${CONFIGURACION.RECUPERACION.OTP_EXPIRA_MINUTOS} minutos.`, 400);
    }

    // Incrementar intentos y verificar límite
    const intentosActualizados = (registro.intentos || 0) + 1;
    if (intentosActualizados > CONFIGURACION.RECUPERACION.MAX_INTENTOS) {
      await supabaseAdmin.from('password_resets').update({ usado: true }).eq('id', registro.id);
      throw new AppError('Demasiados intentos fallidos. Solicita un nuevo código.', 429);
    }

    // Comparar hash
    if (registro.otp_hash !== otpHashIngresado) {
      await supabaseAdmin
        .from('password_resets')
        .update({ intentos: intentosActualizados })
        .eq('id', registro.id);
      throw new AppError(
        `Código incorrecto. Te quedan ${CONFIGURACION.RECUPERACION.MAX_INTENTOS - intentosActualizados} intento(s).`,
        400
      );
    }

    // OTP válido → Buscar userId en public.profiles
    const { data: perfil, error: errorPerfil } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('email', emailNormalizado)
      .maybeSingle();

    if (errorPerfil || !perfil) {
      throw new AppError('No existe un usuario con ese correo.', 404);
    }

    // Actualizar contraseña vía Supabase Admin
    const { error: errorActualizar } = await supabaseAdmin.auth.admin.updateUserById(
      perfil.id,
      { password: nuevaContrasena }
    );
    if (errorActualizar) throw new AppError('No se pudo actualizar la contraseña.', 500);

    // Marcar OTP como usado
    await supabaseAdmin.from('password_resets').update({ usado: true }).eq('id', registro.id);

    console.log(`[Recuperación] Contraseña restablecida para ${emailNormalizado}`);

    return responderExito(res, {
      mensaje: 'Contraseña restablecida con éxito. Ya puedes iniciar sesión con tu nueva clave.'
    });
  } catch (err) {
    next(err);
  }
}

