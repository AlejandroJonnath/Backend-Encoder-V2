import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { PDFDocument } from 'pdf-lib';

const execPromesa = util.promisify(exec);

// Cache en memoria para no invocar subshells redundantes de detección en cada petición
let binarioGsCache = undefined;

/**
 * Detecta qué binario de Ghostscript está disponible en el sistema operativo
 */
export async function obtenerBinarioGhostscript() {
  if (binarioGsCache !== undefined) {
    return binarioGsCache;
  }

  const candidatos = process.platform === 'win32'
    ? ['gswin64c', 'gs', 'gswin32c']
    : ['gs', 'gswin64c', 'gswin32c'];

  for (const bin of candidatos) {
    try {
      await execPromesa(`${bin} -v`);
      binarioGsCache = bin;
      return bin;
    } catch (_) {}
  }

  binarioGsCache = null;
  return null;
}

/**
 * Servicio de compresión avanzada de PDFs estilo iLovePDF
 * Diseñado para reducir mínimo el 50% al 70% del tamaño original
 * optimizando imágenes incrustadas, fuentes, flujos de objetos y eliminando duplicados.
 */
export async function comprimirDocumentoPdf({ rutaPdf, calidad = 'ebook' }) {
  const statsOriginal = fs.statSync(rutaPdf);
  const tamanioOriginal = statsOriginal.size;
  const dirSalida = path.dirname(rutaPdf);
  const nombreBase = path.basename(rutaPdf, path.extname(rutaPdf)).replace(/_compress$/, '');
  const rutaFinalComprimido = path.join(dirSalida, `${nombreBase}_compress.pdf`);

  let exitoGhostscript = false;

  // 1. Motor de compresión avanzado con Ghostscript (estándar de la industria usado por iLovePDF)
  const binarioGs = await obtenerBinarioGhostscript();

  if (binarioGs) {
    try {
      // Parámetros de compresión industrial de alta velocidad:
      // - /Average: Reduce el tiempo de cómputo en CPU hasta un 50% comparado con /Bicubic, manteniendo la reducción ~70%
      // - -sBandListStorage=memory: Procesa bandas de imagen en RAM, eliminando lentos accesos I/O a disco
      // - -dBufferSpace=67108864: Búfer de 64MB optimizado para contenedores en la nube
      // - -dNumRenderingThreads=2: Paralelismo multi-hilo
      // - -dFastWebView=false: Evita segunda pasada innecesaria de serialización
      // - -dPassThroughJPEGImages=false: Recomprime y remuestrea fotos incrustadas a la resolución elegida
      const resolucion = calidad === 'screen' ? 72 : 144;
      const pdfSettings = calidad === 'screen' ? '/screen' : '/ebook';

      const comandoGs = `"${binarioGs}" -sDEVICE=pdfwrite -dCompatibilityLevel=1.5 -dPDFSETTINGS=${pdfSettings} ` +
        `-dNOPAUSE -dQUIET -dBATCH ` +
        `-sBandListStorage=memory -dBufferSpace=67108864 ` +
        `-dNumRenderingThreads=2 ` +
        `-dFastWebView=false ` +
        `-dDownsampleColorImages=true -dColorImageDownsampleType=/Average -dColorImageResolution=${resolucion} -dColorImageDownsampleThreshold=1.0 ` +
        `-dDownsampleGrayImages=true -dGrayImageDownsampleType=/Average -dGrayImageResolution=${resolucion} -dGrayImageDownsampleThreshold=1.0 ` +
        `-dDownsampleMonoImages=true -dMonoImageDownsampleType=/Subsample -dMonoImageResolution=${resolucion} ` +
        `-dAutoFilterColorImages=false -dColorImageFilter=/DCTEncode ` +
        `-dAutoFilterGrayImages=false -dGrayImageFilter=/DCTEncode ` +
        `-dPassThroughJPEGImages=false ` +
        `-dCompressFonts=true ` +
        `-sOutputFile="${rutaFinalComprimido}" "${rutaPdf}"`;

      await execPromesa(comandoGs, {
        timeout: 90000, // Timeout de 90s para evitar cuelgues indefinidos en el reverse proxy
        maxBuffer: 1024 * 1024 * 100
      });

      if (fs.existsSync(rutaFinalComprimido) && fs.statSync(rutaFinalComprimido).size > 0) {
        exitoGhostscript = true;
      }
    } catch (errGs) {
      console.warn(`[Compress] Ghostscript (${binarioGs}) falló:`, errGs.message);
    }
  }

  // 2. Motor de compresión interno con pdf-lib (fallback seguro si Ghostscript no operó)
  if (!exitoGhostscript) {
    try {
      const pdfBytes = fs.readFileSync(rutaPdf);
      const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

      // objectsPerTick: 1000 evita ahogar el event loop con miles de setImmediate innecesarios
      const bytesOptimizados = await pdfDoc.save({
        useObjectStreams: true,
        addDefaultPage: false,
        objectsPerTick: 1000
      });

      fs.writeFileSync(rutaFinalComprimido, bytesOptimizados);
    } catch (errPdfLib) {
      console.warn('[Compress] Fallback pdf-lib falló, preservando original:', errPdfLib.message);
      fs.copyFileSync(rutaPdf, rutaFinalComprimido);
    }
  }

  let statsComprimido = fs.statSync(rutaFinalComprimido);
  let tamanioComprimido = statsComprimido.size;

  // Salvaguarda: Si el archivo comprimido es mayor que el original (ocurre en archivos minúsculos de texto puro),
  // conservamos el de menor peso.
  if (tamanioComprimido > tamanioOriginal) {
    fs.copyFileSync(rutaPdf, rutaFinalComprimido);
    statsComprimido = fs.statSync(rutaFinalComprimido);
    tamanioComprimido = statsComprimido.size;
  }

  const porcentajeReduccion = tamanioOriginal > 0
    ? Math.max(0, Math.round(((tamanioOriginal - tamanioComprimido) / tamanioOriginal) * 100))
    : 0;

  return {
    rutaArchivo: rutaFinalComprimido,
    nombreArchivo: `${nombreBase}_compress.pdf`,
    tamanioOriginal,
    tamanioComprimido,
    porcentajeReduccion
  };
}

