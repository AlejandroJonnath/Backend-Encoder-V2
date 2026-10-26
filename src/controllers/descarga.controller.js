import fs from 'fs';
import path from 'path';
import { CONFIGURACION } from '../config/constantes.js';
import { sanearRutaDescarga } from '../utils/fileSecurity.js';
import { AppError } from '../utils/appError.js';

/**
 * Controlador de descarga directa y segura de archivos procesados.
 * Protegido contra Directory Traversal (LFI) y descarga de certificados o secretos.
 */
export async function descargarArchivoController(req, res, next) {
  try {
    const nombreFisico = req.params.nombreArchivo;

    // Validación y saneamiento estricto contra Path Traversal
    const rutaSegura = sanearRutaDescarga(nombreFisico, CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL);

    if (!fs.existsSync(rutaSegura)) {
      throw new AppError('El archivo solicitado expiró o no existe en el servidor.', 404);
    }

    // Sanitizar el nombre visible de descarga sugerido por query param
    const nombreSugerido = req.query.nombre 
      ? path.basename(req.query.nombre).replace(/[^a-zA-Z0-9._-]/g, '_')
      : nombreFisico;

    res.download(rutaSegura, nombreSugerido);
  } catch (err) {
    next(err);
  }
}
