import path from 'path';
import fs from 'fs';

import { CONFIGURACION } from '../config/constantes.js';

import { inspeccionarHojasExcel, convertirExcelConHojasSeleccionadas } from '../services/excel.service.js';
import { convertirImagenAPdf, convertirTextoPlanoAPdf, convertirOfficeAPdf } from '../services/office.service.js';

import { responderArchivoOJson } from '../utils/response.js';
import { eliminarArchivoSeguro } from '../services/cleanup.service.js';

import { AppError } from '../utils/appError.js';
import { esFormatoValido } from '../utils/fileSecurity.js';

// 1. INSPECCIÓN Y CONVERSIÓN DE EXCEL
export async function inspeccionarExcelController(req, res, next) {

  try {

    const archivo = req.file;

    if (!archivo) {
      throw new AppError('Debes subir un archivo Excel (.xlsx o .xls).', 400);
    }

    const extValidas = ['.xlsx', '.xls'];

    const mimesValidos = ['spreadsheetml', 'ms-excel', 'officedocument.spreadsheet'];

    if (!esFormatoValido(archivo, extValidas, mimesValidos)) {

      eliminarArchivoSeguro(archivo.path);

      throw new AppError(`Formato no válido. Sube un archivo de Excel (.xlsx o .xls). Recibido: ${archivo.originalname}`, 400);
    }

    const reporte = inspeccionarHojasExcel(archivo.path);

    res.json({

      exito: true,

      archivoTemporalId: path.basename(archivo.path),

      reporte

    });

  } catch (err) {

    next(err);

  }
}

export async function procesarExcelAPdfController(req, res, next) {

  let rutaExcel = null;

  try {

    const { archivoTemporalId, hojasSeleccionadas } = req.body;

    if (!archivoTemporalId) {

      throw new AppError('Identificador de archivo temporal no proporcionado.', 400);

    }

    // Sanitizar el nombre para prevenir Directory Traversal
    const nombreLimpio = path.basename(archivoTemporalId);

    rutaExcel = path.join(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, nombreLimpio);

    if (!fs.existsSync(rutaExcel)) {

      throw new AppError('El archivo Excel temporal no existe o expiró. Por favor cárgalo de nuevo.', 404);

    }

    const hojasArray = typeof hojasSeleccionadas === 'string' ? JSON.parse(hojasSeleccionadas) : (hojasSeleccionadas || []);

    const resultado = await convertirExcelConHojasSeleccionadas({ rutaExcel, hojasSeleccionadas: hojasArray });

    return responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo);

  } catch (err) {

    next(err);

  } finally {
    // Eliminar el archivo Excel temporal de origen
    eliminarArchivoSeguro(rutaExcel);
  }
}

// 2. CONVERSIÓN DE DOCUMENTOS OFFICE (WORD, POWERPOINT, TXT, IMÁGENES)
// A. Word a PDF
export async function convertirWordController(req, res, next) {

  let rutaEntrada = null;

  try {

    const archivo = req.file;

    if (!archivo) {

      throw new AppError('Sube un archivo de Word (.docx o .doc).', 400);

    }

    rutaEntrada = archivo.path;

    const extValidas = ['.docx', '.doc'];
    const mimesValidos = ['wordprocessingml', 'msword', 'officedocument.word'];

    if (!esFormatoValido(archivo, extValidas, mimesValidos)) {

      throw new AppError(`El archivo seleccionado no es un documento de Word válido. (Recibido: ${archivo.originalname})`, 400);

    }

    const resultado = await convertirOfficeAPdf(archivo.path);

    return responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo);

  } catch (err) {

    next(err);

  } finally {
    eliminarArchivoSeguro(rutaEntrada);
  }
}

// B. PowerPoint a PDF
export async function convertirPowerPointController(req, res, next) {

  let rutaEntrada = null;

  try {

    const archivo = req.file;

    if (!archivo) {

      throw new AppError('Sube una presentación PowerPoint (.pptx o .ppt).', 400);

    }

    rutaEntrada = archivo.path;

    const extValidas = ['.pptx', '.ppt'];
    const mimesValidos = ['presentationml', 'powerpoint', 'officedocument.presentation'];

    if (!esFormatoValido(archivo, extValidas, mimesValidos)) {

      throw new AppError(`El archivo seleccionado no es una presentación PowerPoint válida. (Recibido: ${archivo.originalname})`, 400);

    }

    const resultado = await convertirOfficeAPdf(archivo.path);

    return responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo);

  } catch (err) {
    next(err);
  } finally {
    eliminarArchivoSeguro(rutaEntrada);
  }
}

// C. Bloc de notas (.txt) a PDF
export async function convertirTxtController(req, res, next) {
  let rutaEntrada = null;
  try {
    const archivo = req.file;
    if (!archivo) {
      throw new AppError('Sube un archivo de texto plano (.txt).', 400);
    }
    rutaEntrada = archivo.path;

    const extValidas = ['.txt'];
    const mimesValidos = ['text/plain', 'text/'];

    if (!esFormatoValido(archivo, extValidas, mimesValidos)) {
      throw new AppError(`El archivo seleccionado debe ser un archivo .txt. (Recibido: ${archivo.originalname})`, 400);
    }

    const resultado = await convertirTextoPlanoAPdf(archivo.path);
    return responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo);
  } catch (err) {
    next(err);
  } finally {
    eliminarArchivoSeguro(rutaEntrada);
  }
}

// D. Imágenes (JPG, PNG, JPEG) a PDF
export async function convertirImagenController(req, res, next) {
  let rutaEntrada = null;
  try {
    const archivo = req.file;
    if (!archivo) {
      throw new AppError('Sube una imagen (JPG, PNG o JPEG).', 400);
    }
    rutaEntrada = archivo.path;

    const extValidas = ['.jpg', '.jpeg', '.png'];
    const mimesValidos = ['image/jpeg', 'image/png', 'image/jpg'];

    if (!esFormatoValido(archivo, extValidas, mimesValidos)) {
      throw new AppError(`Formato no válido. Debe ser JPG, JPEG o PNG. (Recibido: ${archivo.originalname})`, 400);
    }

    const resultado = await convertirImagenAPdf(archivo.path);
    return responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo);
  } catch (err) {
    next(err);
  } finally {
    eliminarArchivoSeguro(rutaEntrada);
  }
}
