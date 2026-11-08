import multer from 'multer';
import { AppError } from '../utils/appError.js';
import { CONFIGURACION } from '../config/constantes.js';
import { registrarErrorMonitor } from '../controllers/admin.controller.js';

/**
 * Middleware centralizado de manejo global de errores y telemetría de fallos.
 */
export function manejarErroresGlobales(err, req, res, next) {
  let codigoEstado = err.codigoEstado || err.status || 500;
  let mensaje = err.message || 'Ocurrió un error inesperado en el servidor.';
  let detalles = err.detalles || null;

  // Registrar en el monitor de telemetría de errores y caídas
  try {
    registrarErrorMonitor({
      ruta: req.originalUrl || req.url,
      metodo: req.method,
      status: codigoEstado,
      mensaje: mensaje,
      stack: err.stack,
      usuarioId: req.usuario?.id
    });
  } catch (_) {}

  // Manejo de errores específicos de Multer (subida de archivos)
  if (err instanceof multer.MulterError) {
    codigoEstado = 400;
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        mensaje = `El archivo supera el límite máximo permitido de ${Math.round(CONFIGURACION.ARCHIVOS.LIMITE_TAMANIO_BYTES / (1024 * 1024 * 1024))}GB.`;
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        mensaje = `Campo de archivo no esperado en la petición (${err.field}).`;
        break;
      case 'LIMIT_FILE_COUNT':
        mensaje = 'Se excedió el número máximo de archivos simultáneos permitidos.';
        break;
      default:
        mensaje = `Error al procesar la subida del archivo: ${err.message}`;
    }
  }

  // Manejo de JSON malformado en body
  if (err instanceof SyntaxError && 'body' in err) {
    codigoEstado = 400;
    mensaje = 'El cuerpo de la petición contiene un formato JSON inválido.';
  }

  // En producción, solo ofuscar errores no operacionales (bugs o fallos graves de infraestructura)
  const esProduccion = process.env.NODE_ENV === 'production' || CONFIGURACION.ENTORNO === 'produccion';
  const esErrorOperacional = err instanceof AppError || err.isOperational || (codigoEstado >= 400 && codigoEstado < 500);

  if (codigoEstado === 500 && esProduccion && !esErrorOperacional) {
    // Si el error contiene detalles sobre certificados, contraseñas, correos o datos de usuario, permitir mensaje descriptivo
    const esErrorDescriptivo = /contrase|certificad|p12|pfx|formato|firma|archivo|p[aá]gina|bytes|descarga|correo|email|recuperac|otp/i.test(mensaje);
    if (!esErrorDescriptivo) {
      mensaje = 'Ocurrió un error interno al procesar su solicitud. Intente nuevamente más tarde.';
    }
  }

  // Log detallado en servidor para depuración
  if (codigoEstado >= 500) {
    console.error(`[Error 500] ${req.method} ${req.originalUrl}:`, err);
  } else {
    console.warn(`[Error ${codigoEstado}] ${req.method} ${req.originalUrl}: ${mensaje}`);
  }

  res.status(codigoEstado).json({
    exito: false,
    codigoEstado,
    mensaje,
    ...(detalles ? { detalles } : {}),
    fecha: new Date().toISOString()
  });
}
