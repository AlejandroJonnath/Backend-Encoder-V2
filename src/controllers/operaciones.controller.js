import path from 'path';
import fs from 'fs';
import { supabaseAdmin } from '../config/supabase.js';
import { CONFIGURACION } from '../config/constantes.js';
import { firmarDocumentoPdf } from '../services/firmaec.service.js';
import { comprimirDocumentoPdf } from '../services/compress.service.js';
import { unirDocumentosPdf } from '../services/merge.service.js';
import { agregarNotaAlPdf } from '../services/notes.service.js';
import { inspeccionarHojasExcel, convertirExcelConHojasSeleccionadas } from '../services/excel.service.js';
import { convertirImagenAPdf, convertirTextoPlanoAPdf, convertirOfficeAPdf } from '../services/office.service.js';
import { generarResumenPdf, traducirDocumentoPdf } from '../services/groq.service.js';

/**
 * Función auxiliar para responder archivo físico o JSON con URL de descarga
 * compatible al 100% con FileSystem.uploadAsync / downloadAsync de Expo
 */
function responderArchivoOJson(req, res, rutaArchivo, nombreArchivo, extras = {}) {
  const host = req.get('host') || '192.168.1.2:3000';
  const protocolo = req.protocol || 'http';
  const nombreFisico = path.basename(rutaArchivo);
  const descargaUrl = `${protocolo}://${host}/api/descargar/${nombreFisico}?nombre=${encodeURIComponent(nombreArchivo)}`;

  const quiereJson = req.headers['x-retorno-json'] === 'true' || 
                     req.headers['accept']?.includes('application/json');

  if (quiereJson) {
    return res.json({
      exito: true,
      nombreArchivo,
      descargaUrl,
      ...extras
    });
  }

  res.download(rutaArchivo, nombreArchivo);
}

/**
 * Registra auditoría en Supabase
 */
async function registrarOperacionSupabase({
  userId,
  nombreOriginal,
  nombreResultado,
  operacion,
  tamanioOriginal,
  tamanioResultado,
  rutaStorage,
  metadatos = {}
}) {
  try {
    if (!userId || userId === '00000000-0000-0000-0000-000000000000') return null;

    const { data, error } = await supabaseAdmin.from('documents').insert({
      user_id: userId,
      original_name: nombreOriginal,
      result_name: nombreResultado,
      operation: operacion,
      original_size_bytes: tamanioOriginal || 0,
      result_size_bytes: tamanioResultado || 0,
      storage_path: rutaStorage || 'local',
      metadata: metadatos
    }).select().single();

    if (error) console.error('Error guardando en Supabase documents:', error.message);
    return data;
  } catch (err) {
    console.error('Excepción registrando documento:', err.message);
    return null;
  }
}

// ====================================================================
// 1. FIRMA ELECTRÓNICA .P12 (FirmaEC)
// Soporta tanto archivo p12 vía multer como p12Base64 (para Expo uploadAsync)
// ====================================================================
// 1.1 Subir archivo de certificado .p12 para firma nativa
export async function subirCertificadoP12Controller(req, res) {
  try {
    const archivo = req.file;
    if (!archivo) {
      return res.status(400).json({ exito: false, mensaje: 'No se recibió ningún certificado .p12' });
    }
    res.json({
      exito: true,
      tokenP12: path.basename(archivo.path)
    });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: err.message });
  }
}

export async function firmarPdfController(req, res) {
  let rutaP12Temp = null;
  try {
    const archivoPdf = req.file || req.files?.pdf?.[0];
    const contrasena = req.body?.contrasena || req.query?.contrasena;
    
    let posicionRaw = { x: 50, y: 50, pagina: 1 };
    const rawPos = req.body?.posicion || req.query?.posicion;
    if (rawPos) {
      posicionRaw = typeof rawPos === 'string' ? JSON.parse(rawPos) : rawPos;
    }
    const razon = req.body?.razon || req.query?.razon || 'Firma Electrónica';

    if (!archivoPdf) {
      return res.status(400).json({ exito: false, mensaje: 'Debes proporcionar el archivo PDF a firmar.' });
    }

    let rutaP12;
    if (req.files?.p12?.[0] && req.files.p12[0].path !== archivoPdf.path) {
      rutaP12 = req.files.p12[0].path;
    } else if (req.body?.tokenP12 || req.query?.tokenP12 || req.headers['x-token-p12']) {
      const token = req.body?.tokenP12 || req.query?.tokenP12 || req.headers['x-token-p12'];
      const posible = path.join(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, token);
      if (fs.existsSync(posible)) {
        rutaP12 = posible;
      } else {
        return res.status(400).json({ exito: false, mensaje: 'El certificado .p12 expiró o no se encuentra en el servidor.' });
      }
    } else if (req.body?.p12Base64 || req.headers['x-p12-base64']) {
      const b64 = req.body?.p12Base64 || req.headers['x-p12-base64'];
      rutaP12Temp = path.join(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, `${Date.now()}_cert.p12`);
      fs.writeFileSync(rutaP12Temp, Buffer.from(b64, 'base64'));
      rutaP12 = rutaP12Temp;
    } else {
      return res.status(400).json({ exito: false, mensaje: 'Se requiere el certificado .p12 (archivo, token o base64).' });
    }

    if (!contrasena) {
      return res.status(400).json({ exito: false, mensaje: 'Se requiere la contraseña del certificado .p12.' });
    }

    const resultado = await firmarDocumentoPdf({
      rutaPdf: archivoPdf.path,
      rutaP12,
      contrasenaP12: contrasena,
      posicion: posicionRaw,
      razon
    });

    const stats = fs.statSync(resultado.rutaArchivo);
    await registrarOperacionSupabase({
      userId: req.usuario?.id,
      nombreOriginal: archivoPdf.originalname,
      nombreResultado: resultado.nombreArchivo,
      operacion: CONFIGURACION.TIPOS_OPERACION.FIRMAR,
      tamanioOriginal: archivoPdf.size,
      tamanioResultado: stats.size,
      metadatos: { titular: resultado.titular, fecha: resultado.fecha }
    });

    responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo, {
      titular: resultado.titular,
      fecha: resultado.fecha
    });
  } catch (err) {
    console.error('Error en firma de PDF:', err.message);
    res.status(500).json({ exito: false, mensaje: err.message });
  } finally {
    if (rutaP12Temp && fs.existsSync(rutaP12Temp)) {
      try { fs.unlinkSync(rutaP12Temp); } catch (_) {}
    }
  }
}

// ====================================================================
// 2. COMPRIMIR PDF (Hasta 2GB, >50% Reducción)
// ====================================================================
export async function comprimirPdfController(req, res) {
  try {
    const archivo = req.file;
    if (!archivo) {
      return res.status(400).json({ exito: false, mensaje: 'Debes subir un archivo PDF para comprimir.' });
    }

    const resultado = await comprimirDocumentoPdf({
      rutaPdf: archivo.path,
      calidad: req.body?.calidad || 'ebook'
    });

    await registrarOperacionSupabase({
      userId: req.usuario?.id,
      nombreOriginal: archivo.originalname,
      nombreResultado: resultado.nombreArchivo,
      operacion: CONFIGURACION.TIPOS_OPERACION.COMPRIMIR,
      tamanioOriginal: resultado.tamanioOriginal,
      tamanioResultado: resultado.tamanioComprimido,
      metadatos: { reduccion: `${resultado.porcentajeReduccion}%` }
    });

    responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo, {
      tamanioOriginal: resultado.tamanioOriginal,
      tamanioComprimido: resultado.tamanioComprimido,
      porcentajeReduccion: resultado.porcentajeReduccion
    });
  } catch (err) {
    console.error('Error en compresión de PDF:', err.message);
    res.status(500).json({ exito: false, mensaje: err.message });
  }
}

// ====================================================================
// 3. UNIR MÚLTIPLES PDFS (Soporta múltiples archivos y por sesión)
// ====================================================================
export async function subirPdfParaUnirController(req, res) {
  try {
    const archivo = req.file;
    const sesionId = req.body?.sesionId || req.query?.sesionId || req.headers['x-sesion-id'] || 'default';
    if (!archivo) return res.status(400).json({ exito: false, mensaje: 'No se recibió ningún archivo.' });

    const dirSesion = path.join(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, `unir_${sesionId}`);
    if (!fs.existsSync(dirSesion)) fs.mkdirSync(dirSesion, { recursive: true });

    const destino = path.join(dirSesion, `${Date.now()}_${archivo.originalname}`);
    fs.renameSync(archivo.path, destino);

    res.json({ exito: true, archivoId: path.basename(destino), nombre: archivo.originalname });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: err.message });
  }
}

export async function ejecutarUnirSesionController(req, res) {
  try {
    const sesionId = req.body?.sesionId || req.query?.sesionId || req.headers['x-sesion-id'] || 'default';
    const { nombresOrdenados } = req.body || {};
    const dirSesion = path.join(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, `unir_${sesionId}`);

    if (!fs.existsSync(dirSesion)) {
      return res.status(400).json({ exito: false, mensaje: 'Sesión no encontrada o expirada.' });
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

    // Fallback: si por alguna razón el mapeo por nombre no completó todos los archivos,
    // tomar todos los archivos cargados en el directorio de la sesión ordenados cronológicamente
    if (rutasFinales.length < archivosEnDisco.length) {
      rutasFinales = archivosEnDisco.map(f => path.join(dirSesion, f));
    }

    if (rutasFinales.length < 2) {
      return res.status(400).json({ exito: false, mensaje: 'Se necesitan mínimo dos archivos para unir.' });
    }

    const resultado = await unirDocumentosPdf({
      rutasPdf: rutasFinales,
      nombreBase: 'documentos'
    });

    responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo, {
      tamanioFinalBytes: resultado.tamanioFinalBytes
    });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: err.message });
  }
}

export async function unirPdfsController(req, res) {
  try {
    const archivos = req.files;
    if (!archivos || archivos.length < 2) {
      return res.status(400).json({ exito: false, mensaje: 'Se necesitan mínimo dos archivos PDF para unirlos.' });
    }

    const rutas = archivos.map(a => a.path);
    const nombreBaseOriginal = path.basename(archivos[0].originalname, path.extname(archivos[0].originalname));

    const resultado = await unirDocumentosPdf({
      rutasPdf: rutas,
      nombreBase: nombreBaseOriginal
    });

    responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo, {
      tamanioFinalBytes: resultado.tamanioFinalBytes
    });
  } catch (err) {
    console.error('Error al unir PDFs:', err.message);
    res.status(500).json({ exito: false, mensaje: err.message });
  }
}

// ====================================================================
// 4. AGREGAR NOTAS A PDF
// ====================================================================
export async function agregarNotaPdfController(req, res) {
  try {
    const archivo = req.file;
    const textoNota = req.body?.nota;
    const posicionRaw = req.body?.posicion ? JSON.parse(req.body.posicion) : { x: 100, y: 100, pagina: 1 };
    const autor = req.usuario?.user_metadata?.first_name || 'Usuario';

    if (!archivo || !textoNota) {
      return res.status(400).json({ exito: false, mensaje: 'Debes proporcionar el PDF y el texto de la nota.' });
    }

    const resultado = await agregarNotaAlPdf({
      rutaPdf: archivo.path,
      posicion: posicionRaw,
      textoNota,
      autor
    });

    const stats = fs.statSync(resultado.rutaArchivo);
    await registrarOperacionSupabase({
      userId: req.usuario?.id,
      nombreOriginal: archivo.originalname,
      nombreResultado: resultado.nombreArchivo,
      operacion: CONFIGURACION.TIPOS_OPERACION.AGREGAR_NOTA,
      tamanioOriginal: archivo.size,
      tamanioResultado: stats.size,
      metadatos: { posicion: posicionRaw, notaPreview: textoNota.substring(0, 40) }
    });

    responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo);
  } catch (err) {
    console.error('Error agregando nota al PDF:', err.message);
    res.status(500).json({ exito: false, mensaje: err.message });
  }
}

// ====================================================================
// 5. INSPECCIONAR Y PROCESAR HOJAS DE EXCEL
// ====================================================================
export async function inspeccionarExcelController(req, res) {
  try {
    const archivo = req.file;
    if (!archivo) {
      return res.status(400).json({ exito: false, mensaje: 'Debes subir un archivo Excel (.xlsx o .xls).' });
    }

    const reporte = inspeccionarHojasExcel(archivo.path);
    res.json({
      exito: true,
      archivoTemporalId: path.basename(archivo.path),
      reporte
    });
  } catch (err) {
    console.error('Error inspeccionando Excel:', err.message);
    res.status(500).json({ exito: false, mensaje: err.message });
  }
}

export async function procesarExcelAPdfController(req, res) {
  try {
    const { archivoTemporalId, hojasSeleccionadas } = req.body;
    const rutaExcel = path.join(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, archivoTemporalId);

    if (!fs.existsSync(rutaExcel)) {
      return res.status(404).json({ exito: false, mensaje: 'El archivo Excel temporal no existe o expiró.' });
    }

    const hojasArray = typeof hojasSeleccionadas === 'string' 
      ? JSON.parse(hojasSeleccionadas) 
      : (hojasSeleccionadas || []);

    const resultado = await convertirExcelConHojasSeleccionadas({
      rutaExcel,
      hojasSeleccionadas: hojasArray
    });

    responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo);
  } catch (err) {
    console.error('Error convirtiendo Excel a PDF:', err.message);
    res.status(500).json({ exito: false, mensaje: err.message });
  }
}

// ====================================================================
// 6. HERRAMIENTAS DE CONVERSIÓN SEPARADAS
// ====================================================================

/**
 * Función auxiliar que verifica si un archivo es del tipo esperado,
 * validando tanto la extensión del nombre como el mimetype del archivo.
 * Es permisiva con 'application/octet-stream' (Android Expo Go lo reporta así).
 */
function esFormatoValido(archivo, extensionesValidas, mimetypesValidos) {
  const ext = path.extname(archivo.originalname || '').toLowerCase();
  const mime = (archivo.mimetype || '').toLowerCase();
  const esOctetStream = mime === 'application/octet-stream';
  return extensionesValidas.includes(ext) || mimetypesValidos.some(m => mime.includes(m)) || (esOctetStream && extensionesValidas.includes(ext));
}

// A. Word a PDF
export async function convertirWordController(req, res) {
  try {
    const archivo = req.file;
    if (!archivo) return res.status(400).json({ exito: false, mensaje: 'Sube un archivo de Word (.docx o .doc).' });

    const extValidas = ['.docx', '.doc'];
    const mimesValidos = ['wordprocessingml', 'msword', 'officedocument.word'];

    if (!esFormatoValido(archivo, extValidas, mimesValidos)) {
      const ext = path.extname(archivo.originalname).toLowerCase();
      console.log(`[Word] Rechazado - nombre: ${archivo.originalname}, mime: ${archivo.mimetype}, ext: ${ext}`);
      return res.status(400).json({ exito: false, mensaje: `El archivo seleccionado no es un documento de Word. (Recibido: ${archivo.originalname})` });
    }

    const resultado = await convertirOfficeAPdf(archivo.path);
    responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo);
  } catch (err) {
    console.error('Error convirtiendo Word:', err.message);
    res.status(500).json({ exito: false, mensaje: err.message });
  }
}

// B. PowerPoint a PDF
export async function convertirPowerPointController(req, res) {
  try {
    const archivo = req.file;
    if (!archivo) return res.status(400).json({ exito: false, mensaje: 'Sube una presentación PowerPoint (.pptx o .ppt).' });

    const extValidas = ['.pptx', '.ppt'];
    const mimesValidos = ['presentationml', 'powerpoint', 'officedocument.presentation'];

    if (!esFormatoValido(archivo, extValidas, mimesValidos)) {
      console.log(`[PowerPoint] Rechazado - nombre: ${archivo.originalname}, mime: ${archivo.mimetype}`);
      return res.status(400).json({ exito: false, mensaje: `El archivo seleccionado no es una presentación PowerPoint. (Recibido: ${archivo.originalname})` });
    }

    const resultado = await convertirOfficeAPdf(archivo.path);
    responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo);
  } catch (err) {
    console.error('Error convirtiendo PowerPoint:', err.message);
    res.status(500).json({ exito: false, mensaje: err.message });
  }
}

// C. Bloc de notas (.txt) a PDF
export async function convertirTxtController(req, res) {
  try {
    const archivo = req.file;
    if (!archivo) return res.status(400).json({ exito: false, mensaje: 'Sube un archivo de texto plano (.txt).' });

    const extValidas = ['.txt'];
    const mimesValidos = ['text/plain', 'text/'];

    if (!esFormatoValido(archivo, extValidas, mimesValidos)) {
      console.log(`[TXT] Rechazado - nombre: ${archivo.originalname}, mime: ${archivo.mimetype}`);
      return res.status(400).json({ exito: false, mensaje: `El archivo seleccionado debe ser un archivo .txt (Recibido: ${archivo.originalname})` });
    }

    const resultado = await convertirTextoPlanoAPdf(archivo.path);
    responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo);
  } catch (err) {
    console.error('Error convirtiendo TXT:', err.message);
    res.status(500).json({ exito: false, mensaje: err.message });
  }
}

// D. Imágenes (JPG, PNG, JPEG) a PDF
export async function convertirImagenController(req, res) {
  try {
    const archivo = req.file;
    if (!archivo) return res.status(400).json({ exito: false, mensaje: 'Sube una imagen (JPG, PNG o JPEG).' });

    const extValidas = ['.jpg', '.jpeg', '.png'];
    const mimesValidos = ['image/jpeg', 'image/png', 'image/jpg'];

    if (!esFormatoValido(archivo, extValidas, mimesValidos)) {
      console.log(`[Imagen] Rechazado - nombre: ${archivo.originalname}, mime: ${archivo.mimetype}`);
      return res.status(400).json({ exito: false, mensaje: `Formato no válido. Debe ser JPG, JPEG o PNG. (Recibido: ${archivo.originalname})` });
    }

    const resultado = await convertirImagenAPdf(archivo.path);
    responderArchivoOJson(req, res, resultado.rutaArchivo, resultado.nombreArchivo);
  } catch (err) {
    console.error('Error convirtiendo imagen:', err.message);
    res.status(500).json({ exito: false, mensaje: err.message });
  }
}

// ====================================================================
// 7. DESCARGA DIRECTA DE ARCHIVOS POR TOKEN / NOMBRE
// ====================================================================
export async function descargarArchivoController(req, res) {
  try {
    const nombreFisico = req.params.nombreArchivo;
    const rutaArchivo = path.join(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, nombreFisico);

    if (!fs.existsSync(rutaArchivo)) {
      return res.status(404).json({ exito: false, mensaje: 'El archivo solicitado expiró o no existe.' });
    }

    const nombreDescarga = req.query.nombre || nombreFisico;
    res.download(rutaArchivo, nombreDescarga);
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: err.message });
  }
}

// ====================================================================
// 8. GROQ AI: RESUMEN Y TRADUCCIÓN
// ====================================================================
export async function resumirPdfIaController(req, res) {
  try {
    const archivo = req.file;
    if (!archivo) {
      return res.status(400).json({ exito: false, mensaje: 'Debes subir un archivo PDF para generar el resumen.' });
    }

    const resultado = await generarResumenPdf({ rutaPdf: archivo.path });

    if (req.usuario?.id && req.usuario.id !== '00000000-0000-0000-0000-000000000000') {
      await supabaseAdmin.from('ai_tasks').insert({
        user_id: req.usuario.id,
        task_type: 'summary',
        output_content: resultado.resumen,
        prompt_tokens: resultado.tokensUsados?.prompt_tokens,
        completion_tokens: resultado.tokensUsados?.completion_tokens
      });
    }

    res.json({
      exito: true,
      nombreArchivo: archivo.originalname,
      resumen: resultado.resumen,
      modelo: resultado.modeloUtilizado
    });
  } catch (err) {
    console.error('Error en resumen con IA:', err.message);
    res.status(500).json({ exito: false, mensaje: err.message });
  }
}

export async function traducirPdfIaController(req, res) {
  try {
    const archivo = req.file;
    const idiomaDestino = req.body?.idiomaDestino;
    const idiomaOrigen = req.body?.idiomaOrigen || 'Detección automática';

    if (!archivo || !idiomaDestino) {
      return res.status(400).json({
        exito: false,
        mensaje: 'Debes proporcionar el PDF y el idioma destino (Español, Inglés, Francés, Alemán, Chino Mandarín).'
      });
    }

    const resultado = await traducirDocumentoPdf({
      rutaPdf: archivo.path,
      idiomaOrigen,
      idiomaDestino
    });

    if (req.usuario?.id && req.usuario.id !== '00000000-0000-0000-0000-000000000000') {
      await supabaseAdmin.from('ai_tasks').insert({
        user_id: req.usuario.id,
        task_type: 'translate',
        target_language: idiomaDestino,
        output_content: resultado.traduccion,
        prompt_tokens: resultado.tokensUsados?.prompt_tokens,
        completion_tokens: resultado.tokensUsados?.completion_tokens
      });
    }

    res.json({
      exito: true,
      nombreArchivo: archivo.originalname,
      idiomaDestino,
      traduccion: resultado.traduccion,
      modelo: resultado.modeloUtilizado
    });
  } catch (err) {
    console.error('Error en traducción con IA:', err.message);
    res.status(500).json({ exito: false, mensaje: err.message });
  }
}
