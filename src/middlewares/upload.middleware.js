import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { CONFIGURACION } from '../config/constantes.js';
import { generarNombreArchivoSeguro } from '../utils/fileSecurity.js';

// Asegurar que el directorio temporal exista
if (!fs.existsSync(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL)) {
  fs.mkdirSync(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, { recursive: true });
}

// Configuración de almacenamiento seguro en disco para Multer
const almacenamiento = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL);
  },
  filename: (req, file, cb) => {
    // Generar nombre aleatorio con UUID para evitar colisiones y path injection
    const nombreSeguro = generarNombreArchivoSeguro(file.originalname);
    cb(null, nombreSeguro);
  }
});

const multerInstancia = multer({
  storage: almacenamiento,
  limits: {
    fileSize: CONFIGURACION.ARCHIVOS.LIMITE_TAMANIO_BYTES // 2GB
  }
});

/**
 * Función auxiliar para materializar un archivo recibido en Base64
 * evitando que Multer sobreescriba req.file a undefined en peticiones JSON.
 */
function poblarArchivoDesdeBase64(req, nombreCampo = 'archivo') {
  if (req.body && req.body.archivoBase64) {
    try {
      const nombreOriginal = req.body.nombreArchivo || `archivo_${Date.now()}.bin`;
      const nombreSeguro = generarNombreArchivoSeguro(nombreOriginal);
      const rutaTemp = path.join(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, nombreSeguro);

      fs.writeFileSync(rutaTemp, Buffer.from(req.body.archivoBase64, 'base64'));

      const fileObj = {
        path: rutaTemp,
        originalname: nombreOriginal,
        filename: path.basename(rutaTemp),
        size: fs.statSync(rutaTemp).size,
        mimetype: req.body.mimetype || 'application/octet-stream'
      };

      req.file = fileObj;
      req.files = req.files || {};
      req.files[nombreCampo] = [fileObj];

      const ext = path.extname(nombreOriginal).toLowerCase();
      if (ext === '.p12' || ext === '.pfx' || nombreCampo === 'p12') {
        req.files['p12'] = [fileObj];
      } else {
        req.files['pdf'] = [fileObj];
        req.files['archivo'] = [fileObj];
      }
      return true;
    } catch (err) {
      console.error('[Upload] Error al decodificar archivoBase64 en middleware:', err.message);
    }
  }
  return false;
}

/**
 * Middleware híbrido:
 * - Si la petición viene en JSON con 'archivoBase64', crea req.file automáticamente.
 * - Si viene como multipart/form-data tradicional, ejecuta Multer con nombres seguros.
 */
export const subirArchivos = {
  single: (nombreCampo) => (req, res, next) => {
    if (poblarArchivoDesdeBase64(req, nombreCampo)) {
      return next();
    }
    return multerInstancia.single(nombreCampo)(req, res, (err) => {
      if (err) return next(err);
      poblarArchivoDesdeBase64(req, nombreCampo);
      next();
    });
  },
  fields: (campos) => (req, res, next) => {
    if (poblarArchivoDesdeBase64(req, 'pdf')) {
      return next();
    }
    return multerInstancia.fields(campos)(req, res, (err) => {
      if (err) return next(err);
      poblarArchivoDesdeBase64(req, 'pdf');
      next();
    });
  },
  array: (nombreCampo, maxCount) => (req, res, next) => {
    if (poblarArchivoDesdeBase64(req, nombreCampo)) {
      return next();
    }
    return multerInstancia.array(nombreCampo, maxCount)(req, res, (err) => {
      if (err) return next(err);
      poblarArchivoDesdeBase64(req, nombreCampo);
      next();
    });
  }
};
