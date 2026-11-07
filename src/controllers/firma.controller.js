import path from 'path';
import fs from 'fs';
import { CONFIGURACION } from '../config/constantes.js';
import { firmarDocumentoPdf } from '../services/firmaec.service.js';
import { registrarOperacionDocumento } from '../services/audit.service.js';
import { responderArchivoOJson } from '../utils/response.js';
import { AppError } from '../utils/appError.js';
import { eliminarArchivoSeguro } from '../services/cleanup.service.js';
import { esFormatoValido } from '../utils/fileSecurity.js';

/**
 * 1. Subir certificado .p12 temporal para firma nativa
 */
export async function subirCertificadoP12Controller(req, res, next) {
  try {
    const archivo = req.file;
    if (!archivo) {
      throw new AppError('No se recibió ningún certificado digital (.p12 o .pfx).', 400);
    }

    const extValidas = ['.p12', '.pfx'];
    const mimesValidos = ['application/x-pkcs12', 'application/pkcs12', 'application/octet-stream'];

    if (!esFormatoValido(archivo, extValidas, mimesValidos)) {
      eliminarArchivoSeguro(archivo.path);
      throw new AppError('El archivo subido no es un certificado digital válido (.p12 o .pfx).', 400);
    }

    res.json({
      exito: true,
      tokenP12: path.basename(archivo.path)
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. Firmar documento PDF criptográficamente con .p12 (FirmaEC)
 * Destruye el certificado .p12 y archivos de entrada en el bloque finally.
 */
export async function firmarPdfController(req, res, next) {
  const archivosTemporalesAEliminar = [];

  try {
    const archivoPdf = req.file || req.files?.pdf?.[0];
    
    // Extraer parámetros con fallback resiliente (body multipart, x-parametros o query)
    let paramsHeader = {};
    if (req.headers['x-parametros']) {
      try {
        paramsHeader = typeof req.headers['x-parametros'] === 'string'
          ? JSON.parse(req.headers['x-parametros'])
          : req.headers['x-parametros'];
      } catch (_) {}
    }

    const contrasena = req.body?.contrasena || paramsHeader?.contrasena || req.query?.contrasena;
    const tokenP12 = req.body?.tokenP12 || req.headers['x-token-p12'] || paramsHeader?.tokenP12 || req.query?.tokenP12;
    const rawPos = req.body?.posicion || paramsHeader?.posicion || req.query?.posicion;
    const razon = req.body?.razon || paramsHeader?.razon || req.query?.razon || 'Firma Electrónica Documental';

    if (!archivoPdf) {
      throw new AppError('Debes proporcionar el archivo PDF a firmar.', 400);
    }
    archivosTemporalesAEliminar.push(archivoPdf.path);

    // Posición y metadatos de la firma
    let posicionRaw = { x: 50, y: 50, pagina: 1 };
    if (rawPos) {
      posicionRaw = typeof rawPos === 'string' ? JSON.parse(rawPos) : rawPos;
    }

    // Determinar la procedencia del certificado .p12
    let rutaP12 = null;

    if (req.files?.p12?.[0] && req.files.p12[0].path !== archivoPdf.path) {
      rutaP12 = req.files.p12[0].path;
    } else if (tokenP12) {
      const posible = path.join(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, path.basename(tokenP12));
      if (fs.existsSync(posible)) {
        rutaP12 = posible;
      } else {
        throw new AppError('El certificado .p12 expiró o ya fue utilizado por seguridad. Por favor cárgalo de nuevo.', 400);
      }
    } else if (req.body?.p12Base64 || req.headers['x-p12-base64'] || paramsHeader?.p12Base64) {
      const b64 = req.body?.p12Base64 || req.headers['x-p12-base64'] || paramsHeader?.p12Base64;
      const rutaP12Temp = path.join(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, `${Date.now()}_cert.p12`);
      fs.writeFileSync(rutaP12Temp, Buffer.from(b64, 'base64'));
      rutaP12 = rutaP12Temp;
    } else {
      throw new AppError('Se requiere el certificado .p12 (archivo, token previo o base64).', 400);
    }

    // Registrar para destrucción obligatoria
    if (rutaP12) {
      archivosTemporalesAEliminar.push(rutaP12);
    }

    if (!contrasena) {
      throw new AppError('Se requiere la contraseña del certificado .p12.', 400);
    }

    // Ejecutar la firma digital criptográfica con captura controlada de errores
    let resultado;
    try {
      resultado = await firmarDocumentoPdf({
        rutaPdf: archivoPdf.path,
        rutaP12,
        contrasenaP12: contrasena,
        posicion: posicionRaw,
        razon
      });
    } catch (errFirma) {
      if (errFirma instanceof AppError) {
        throw errFirma;
      }
      throw new AppError(errFirma.message || 'Error al procesar la firma digital con el certificado proporcionado.', 400);
    }

    const stats = fs.statSync(resultado.rutaArchivo);

    // Auditoría en Supabase
    await registrarOperacionDocumento({
      userId: req.usuario?.id,
      nombreOriginal: archivoPdf.originalname,
      nombreResultado: resultado.nombreArchivo,
      operacion: CONFIGURACION.TIPOS_OPERACION.FIRMAR,
      tamanioOriginal: archivoPdf.size,
      tamanioResultado: stats.size,
      metadatos: { titular: resultado.titular, fecha: resultado.fecha }
    });

    return responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo, {
      titular: resultado.titular,
      fecha: resultado.fecha
    });
  } catch (err) {
    next(err);
  } finally {
    // SEGURIDAD CRÍTICA: Destruir el certificado .p12 y archivos de entrada temporales inmediatamente
    for (const ruta of archivosTemporalesAEliminar) {
      eliminarArchivoSeguro(ruta);
    }
  }
}
