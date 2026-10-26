import { generarResumenPdf, traducirDocumentoPdf } from '../services/groq.service.js';
import { registrarTareaIA } from '../services/audit.service.js';
import { AppError } from '../utils/appError.js';
import { eliminarArchivoSeguro } from '../services/cleanup.service.js';
import { esFormatoValido } from '../utils/fileSecurity.js';

/**
 * 1. Generar resumen ejecutivo de un PDF usando Groq AI
 */
export async function resumirPdfIaController(req, res, next) {
  let rutaEntrada = null;
  try {
    const archivo = req.file;
    if (!archivo) {
      throw new AppError('Debes subir un archivo PDF para generar el resumen con IA.', 400);
    }
    rutaEntrada = archivo.path;

    if (!esFormatoValido(archivo, ['.pdf'], ['application/pdf'])) {
      throw new AppError('El archivo debe ser un documento PDF válido.', 400);
    }

    const resultado = await generarResumenPdf({ rutaPdf: archivo.path });

    await registrarTareaIA({
      userId: req.usuario?.id,
      taskType: 'summary',
      outputContent: resultado.resumen,
      promptTokens: resultado.tokensUsados?.prompt_tokens,
      completionTokens: resultado.tokensUsados?.completion_tokens
    });

    res.json({
      exito: true,
      nombreArchivo: archivo.originalname,
      resumen: resultado.resumen,
      modelo: resultado.modeloUtilizado
    });
  } catch (err) {
    next(err);
  } finally {
    eliminarArchivoSeguro(rutaEntrada);
  }
}

/**
 * 2. Traducir contenido de un PDF usando Groq AI
 */
export async function traducirPdfIaController(req, res, next) {
  let rutaEntrada = null;
  try {
    const archivo = req.file;
    const idiomaDestino = req.body?.idiomaDestino;
    const idiomaOrigen = req.body?.idiomaOrigen || 'Detección automática';

    if (!archivo || !idiomaDestino) {
      throw new AppError('Debes proporcionar el PDF y el idioma destino (Español, Inglés, Francés, Alemán, Chino Mandarín).', 400);
    }
    rutaEntrada = archivo.path;

    if (!esFormatoValido(archivo, ['.pdf'], ['application/pdf'])) {
      throw new AppError('El archivo debe ser un documento PDF válido.', 400);
    }

    const resultado = await traducirDocumentoPdf({
      rutaPdf: archivo.path,
      idiomaOrigen,
      idiomaDestino
    });

    await registrarTareaIA({
      userId: req.usuario?.id,
      taskType: 'translate',
      targetLanguage: idiomaDestino,
      outputContent: resultado.traduccion,
      promptTokens: resultado.tokensUsados?.prompt_tokens,
      completionTokens: resultado.tokensUsados?.completion_tokens
    });

    res.json({
      exito: true,
      nombreArchivo: archivo.originalname,
      idiomaDestino,
      traduccion: resultado.traduccion,
      modelo: resultado.modeloUtilizado
    });
  } catch (err) {
    next(err);
  } finally {
    eliminarArchivoSeguro(rutaEntrada);
  }
}
