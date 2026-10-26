import multer from 'multer';
import { AppError } from '../utils/appError.js';
import { CONFIGURACION } from '../config/constantes.js';

/**
 * Middleware centralizado de manejo global de errores.
 */
export function manejarErroresGlobales(err, req, res, next) {
  let codigoEstado = err.codigoEstado || err.status || 500;
  let mensaje = err.message || 'Ocurrió un error inesperado en el servidor.';
  let detalles = err.detalles || null;

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

  // En producción, ofuscar mensajes de errores inesperados (500)
  const esProduccion = process.env.NODE_ENV === 'production' || CONFIGURACION.ENTORNO === 'produccion';
  if (codigoEstado === 500 && esProduccion) {
    mensaje = 'Ocurrió un error interno al procesar su solicitud. Intente nuevamente más tarde.';
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
