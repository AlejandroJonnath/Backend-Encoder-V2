import path from 'path';
import fs from 'fs';
import { CONFIGURACION } from '../config/constantes.js';
import { comprimirDocumentoPdf } from '../services/compress.service.js';
import { unirDocumentosPdf } from '../services/merge.service.js';
import { agregarNotaAlPdf } from '../services/notes.service.js';
import { registrarOperacionDocumento } from '../services/audit.service.js';
import { responderArchivoOJson } from '../utils/response.js';
import { AppError } from '../utils/appError.js';
import { eliminarArchivoSeguro, eliminarDirectorioSeguro } from '../services/cleanup.service.js';
import { esFormatoValido } from '../utils/fileSecurity.js';

/**
 * 1. Comprimir PDF (Hasta 2GB con Ghostscript / pdf-lib)
 */
export async function comprimirPdfController(req, res, next) {
  let rutaEntrada = null;
  try {
    const archivo = req.file;
    if (!archivo) {
      throw new AppError('Debes subir un archivo PDF para comprimir.', 400);
    }
    rutaEntrada = archivo.path;

    if (!esFormatoValido(archivo, ['.pdf'], ['application/pdf'])) {
      throw new AppError('El archivo seleccionado no es un documento PDF válido.', 400);
    }

    const resultado = await comprimirDocumentoPdf({
      rutaPdf: archivo.path,
      calidad: req.body?.calidad || 'ebook'
    });

    await registrarOperacionDocumento({
      userId: req.usuario?.id,
      nombreOriginal: archivo.originalname,
      nombreResultado: resultado.nombreArchivo,
      operacion: CONFIGURACION.TIPOS_OPERACION.COMPRIMIR,
      tamanioOriginal: resultado.tamanioOriginal,
      tamanioResultado: resultado.tamanioComprimido,
      metadatos: { reduccion: `${resultado.porcentajeReduccion}%` }
    });

    return responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo, {
      tamanioOriginal: resultado.tamanioOriginal,
      tamanioComprimido: resultado.tamanioComprimido,
      porcentajeReduccion: resultado.porcentajeReduccion
    });
  } catch (err) {
    next(err);
  } finally {
    // Eliminar el archivo de entrada original
    eliminarArchivoSeguro(rutaEntrada);
  }
}

/**
 * 2. Subir un archivo PDF individual para una sesión de unión múltiple
 */
export async function subirPdfParaUnirController(req, res, next) {
  try {
    const archivo = req.file;
    const rawSesionId = req.body?.sesionId || req.headers['x-sesion-id'] || 'default';
    const sesionId = path.basename(rawSesionId.replace(/[^a-zA-Z0-9_-]/g, ''));

    if (!archivo) {
      throw new AppError('No se recibió ningún archivo PDF para la sesión.', 400);
    }

    if (!esFormatoValido(archivo, ['.pdf'], ['application/pdf'])) {
      eliminarArchivoSeguro(archivo.path);
      throw new AppError('El archivo debe ser un formato PDF válido.', 400);
    }

    const dirSesion = path.join(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, `unir_${sesionId}`);
    if (!fs.existsSync(dirSesion)) {
      fs.mkdirSync(dirSesion, { recursive: true });
    }

    const destino = path.join(dirSesion, `${Date.now()}_${path.basename(archivo.originalname)}`);
    fs.renameSync(archivo.path, destino);

    res.json({
      exito: true,
      archivoId: path.basename(destino),
      nombre: archivo.originalname
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 3. Ejecutar la unión de PDFs de una sesión por lotes y purgar el directorio temporal
 */
export async function ejecutarUnirSesionController(req, res, next) {
  let dirSesion = null;
  try {
    const rawSesionId = req.body?.sesionId || req.headers['x-sesion-id'] || 'default';
    const sesionId = path.basename(rawSesionId.replace(/[^a-zA-Z0-9_-]/g, ''));
    const { nombresOrdenados } = req.body || {};
    
    dirSesion = path.join(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, `unir_${sesionId}`);

    if (!fs.existsSync(dirSesion)) {
      throw new AppError('La sesión de unión no existe o ha expirado. Sube los archivos nuevamente.', 400);
    }

    const archivosEnDisco = fs.readdirSync(dirSesion).filter(f => f.toLowerCase().endsWith('.pdf') || !path.extname(f));
    let rutasFinales = [];

    if (Array.isArray(nombresOrdenados) && nombresOrdenados.length > 0) {
      nombresOrdenados.forEach(nombre => {
        const coincidencia = archivosEnDisco.find(f => f.toLowerCase().includes(nombre.toLowerCase()) || f === nombre);
        if (coincidencia && !rutasFinales.includes(path.join(dirSesion, coincidencia))) {
          rutasFinales.push(path.join(dirSesion, coincidencia));
        }
      });
    }

    if (rutasFinales.length < archivosEnDisco.length) {
      rutasFinales = archivosEnDisco.map(f => path.join(dirSesion, f));
    }

    if (rutasFinales.length < 2) {
      throw new AppError('Se necesitan mínimo dos archivos PDF para realizar la unión.', 400);
    }

    const resultado = await unirDocumentosPdf({
      rutasPdf: rutasFinales,
      nombreBase: 'documentos_unidos'
    });

    await registrarOperacionDocumento({
      userId: req.usuario?.id,
      nombreOriginal: 'lote_sesion_unir.pdf',
      nombreResultado: resultado.nombreArchivo,
      operacion: CONFIGURACION.TIPOS_OPERACION.UNIR,
      tamanioResultado: resultado.tamanioFinalBytes,
      metadatos: { cantidadDocumentos: rutasFinales.length }
    });

    return responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo, {
      tamanioFinalBytes: resultado.tamanioFinalBytes
    });
  } catch (err) {
    next(err);
  } finally {
    // Purgar inmediatamente la carpeta de la sesión de unión para evitar basura
    eliminarDirectorioSeguro(dirSesion);
  }
}

/**
 * 4. Unir múltiples PDFs recibidos de forma simultánea (array multipart)
 */
export async function unirPdfsController(req, res, next) {
  const rutasEntrada = [];
  try {
    const archivos = req.files;
    if (!archivos || archivos.length < 2) {
      throw new AppError('Se necesitan mínimo dos archivos PDF para unirlos.', 400);
    }

    for (const a of archivos) {
      rutasEntrada.push(a.path);
      if (!esFormatoValido(a, ['.pdf'], ['application/pdf'])) {
        throw new AppError(`El archivo "${a.originalname}" no es un documento PDF válido.`, 400);
      }
    }

    const nombreBaseOriginal = path.basename(archivos[0].originalname, path.extname(archivos[0].originalname));

    const resultado = await unirDocumentosPdf({
      rutasPdf: rutasEntrada,
      nombreBase: nombreBaseOriginal
    });

    await registrarOperacionDocumento({
      userId: req.usuario?.id,
      nombreOriginal: `${archivos.length}_documentos.pdf`,
      nombreResultado: resultado.nombreArchivo,
      operacion: CONFIGURACION.TIPOS_OPERACION.UNIR,
      tamanioResultado: resultado.tamanioFinalBytes,
      metadatos: { totalArchivos: archivos.length }
    });

    return responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo, {
      tamanioFinalBytes: resultado.tamanioFinalBytes
    });
  } catch (err) {
    next(err);
  } finally {
    // Eliminar los archivos de entrada individuales
    rutasEntrada.forEach(eliminarArchivoSeguro);
  }
}

/**
 * 5. Agregar notas y comentarios visuales al PDF
 */
export async function agregarNotaPdfController(req, res, next) {
  let rutaEntrada = null;
  try {
    const archivo = req.file;
    const textoNota = req.body?.nota;
    const posicionRaw = req.body?.posicion ? JSON.parse(req.body.posicion) : { x: 100, y: 100, pagina: 1 };
    const autor = req.usuario?.user_metadata?.first_name || 'Usuario';

    if (!archivo || !textoNota) {
      throw new AppError('Debes proporcionar el archivo PDF y el texto de la nota.', 400);
    }
    rutaEntrada = archivo.path;

    if (!esFormatoValido(archivo, ['.pdf'], ['application/pdf'])) {
      throw new AppError('El archivo debe ser un formato PDF válido.', 400);
    }

    const resultado = await agregarNotaAlPdf({
      rutaPdf: archivo.path,
      posicion: posicionRaw,
      textoNota,
      autor
    });

    const stats = fs.statSync(resultado.rutaArchivo);

    await registrarOperacionDocumento({
      userId: req.usuario?.id,
      nombreOriginal: archivo.originalname,
      nombreResultado: resultado.nombreArchivo,
      operacion: CONFIGURACION.TIPOS_OPERACION.AGREGAR_NOTA,
      tamanioOriginal: archivo.size,
      tamanioResultado: stats.size,
      metadatos: { posicion: posicionRaw, notaPreview: textoNota.substring(0, 40) }
    });

    return responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo);
  } catch (err) {
    next(err);
  } finally {
    eliminarArchivoSeguro(rutaEntrada);
  }
}
