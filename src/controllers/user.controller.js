import { supabaseAdmin } from '../config/supabase.js';
import { CONFIGURACION } from '../config/constantes.js';
import { AppError } from '../utils/appError.js';
import { responderExito } from '../utils/response.js';

/**
 * Elimina definitivamente la cuenta de un usuario y todos sus datos asociados (Right to be Forgotten).
 */
export async function eliminarCuentaController(req, res, next) {
  try {
    const usuarioId = req.usuario?.id;
    if (!usuarioId) {
      throw new AppError('Usuario no autenticado para realizar esta acción destructiva.', 401);
    }

    console.log(`[Cuenta] Iniciando eliminación definitiva de cuenta para usuario: ${usuarioId}`);

    // 1. Purgar archivos en Supabase Storage (bucket pdf_vault) asociados al usuario
    try {
      const bucketName = CONFIGURACION.SUPABASE.BUCKET_DOCUMENTOS || 'pdf_vault';
      const { data: listaArchivos, error: errorListar } = await supabaseAdmin.storage
        .from(bucketName)
        .list(usuarioId);

      if (!errorListar && listaArchivos && listaArchivos.length > 0) {
        const rutasAEliminar = listaArchivos.map(archivo => `${usuarioId}/${archivo.name}`);
        const { error: errorBorradoStorage } = await supabaseAdmin.storage
          .from(bucketName)
          .remove(rutasAEliminar);

        if (errorBorradoStorage) {
          console.warn('[Cuenta] Advertencia al limpiar storage del usuario:', errorBorradoStorage.message);
        } else {
          console.log(`[Cuenta] Purgados ${rutasAEliminar.length} archivos de storage para ${usuarioId}.`);
        }
      }
    } catch (storageErr) {
      console.warn('[Cuenta] Error durante el purgado de storage:', storageErr.message);
    }

    // 2. Eliminar registros de bases de datos asociadas
    try {
      await supabaseAdmin.from('documents').delete().eq('user_id', usuarioId);
      await supabaseAdmin.from('ai_tasks').delete().eq('user_id', usuarioId);
      await supabaseAdmin.from('support_tickets').delete().eq('user_id', usuarioId);
      await supabaseAdmin.from('user_consents').delete().eq('user_id', usuarioId);
      await supabaseAdmin.from('profiles').delete().eq('id', usuarioId);
    } catch (dbErr) {
      console.warn('[Cuenta] Advertencia al eliminar registros públicos en cascada:', dbErr.message);
    }

    // 3. Eliminar usuario en Supabase Auth
    const { error: errorAuth } = await supabaseAdmin.auth.admin.deleteUser(usuarioId);
    if (errorAuth) {
      console.error('[Cuenta] Error al eliminar usuario de Supabase Auth:', errorAuth.message);
      throw new AppError(`No se pudo eliminar el usuario de autenticación: ${errorAuth.message}`, 500);
    }

    console.log(`[Cuenta] Usuario ${usuarioId} y todos sus datos han sido eliminados satisfactoriamente.`);

    return responderExito(res, {
      mensaje: 'Tu cuenta y todos tus datos asociados han sido eliminados permanentemente del sistema.',
      usuarioId,
      eliminado: true
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Genera una copia de seguridad y exportación completa de los datos del usuario (Portabilidad / GDPR).
 */
export async function exportarDatosUsuarioController(req, res, next) {
  try {
    const usuario = req.usuario;
    const usuarioId = usuario?.id;
    if (!usuarioId) {
      throw new AppError('Usuario no autenticado.', 401);
    }

    // Consultar perfil
    let perfil = null;
    try {
      const { data } = await supabaseAdmin.from('profiles').select('*').eq('id', usuarioId).single();
      perfil = data;
    } catch (_) {}

    // Consultar historial de documentos procesados
    let documentos = [];
    try {
      const { data } = await supabaseAdmin.from('documents').select('*').eq('user_id', usuarioId);
      documentos = data || [];
    } catch (_) {}

    // Consultar tareas de IA
    let tareasIa = [];
    try {
      const { data } = await supabaseAdmin.from('ai_tasks').select('*').eq('user_id', usuarioId);
      tareasIa = data || [];
    } catch (_) {}

    // Consultar tickets de soporte
    let tickets = [];
    try {
      const { data } = await supabaseAdmin.from('support_tickets').select('*').eq('user_id', usuarioId);
      tickets = data || [];
    } catch (_) {}

    // Consultar consentimientos
    let consentimientos = [];
    try {
      const { data } = await supabaseAdmin.from('user_consents').select('*').eq('user_id', usuarioId);
      consentimientos = data || [];
    } catch (_) {}

    const backupData = {
      plataforma: 'EncoderGoti',
      fechaExportacion: new Date().toISOString(),
      usuario: {
        id: usuario.id,
        email: usuario.email,
        metadatos: usuario.user_metadata,
        perfil: perfil
      },
      metricas: {
        totalDocumentos: documentos.length,
        totalTareasIa: tareasIa.length,
        totalTickets: tickets.length
      },
      documentos,
      tareasIa,
      ticketsSoporte: tickets,
      consentimientos
    };

    return responderExito(res, {
      mensaje: 'Copia de seguridad y exportación de datos generada exitosamente.',
      backup: backupData
    });
  } catch (err) {
    next(err);
  }
}

