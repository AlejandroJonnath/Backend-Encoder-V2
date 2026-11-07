import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/appError.js';
import { responderExito } from '../utils/response.js';

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

