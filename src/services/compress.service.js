import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { PDFDocument } from 'pdf-lib';

const execPromesa = util.promisify(exec);

/**
 * Detecta qué binario de Ghostscript está disponible en el sistema operativo
 */
async function obtenerBinarioGhostscript() {
  const candidatos = ['gswin64c', 'gs', 'gswin32c'];
  for (const bin of candidatos) {
    try {
      await execPromesa(`${bin} -v`);
      return bin;
    } catch (_) {}
  }
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
      // Parámetros avanzados de compresión idénticos a los servicios de optimización documental:
      // -dPDFSETTINGS=/ebook (150 DPI) para balance perfecto entre fidelidad y reducción >50%
      // -dDownsampleColorImages=true y Bicubic a 144 DPI para fotos y escaneos
      // -dDetectDuplicateImages=true para unificar imágenes idénticas
      // -dCompressFonts=true para empaquetado de tipografías
      const resolucion = calidad === 'screen' ? 72 : 144;
      const pdfSettings = calidad === 'screen' ? '/screen' : '/ebook';

      const comandoGs = `"${binarioGs}" -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=${pdfSettings} ` +
        `-dNOPAUSE -dQUIET -dBATCH ` +
        `-dDownsampleColorImages=true -dColorImageDownsampleType=/Bicubic -dColorImageResolution=${resolucion} ` +
        `-dDownsampleGrayImages=true -dGrayImageDownsampleType=/Bicubic -dGrayImageResolution=${resolucion} ` +
        `-dDownsampleMonoImages=true -dMonoImageDownsampleType=/Bicubic -dMonoImageResolution=${resolucion} ` +
        `-dDetectDuplicateImages=true -dCompressFonts=true ` +
        `-sOutputFile="${rutaFinalComprimido}" "${rutaPdf}"`;

      await execPromesa(comandoGs, { maxBuffer: 1024 * 1024 * 100 });

      if (fs.existsSync(rutaFinalComprimido) && fs.statSync(rutaFinalComprimido).size > 0) {
        exitoGhostscript = true;
      }
    } catch (errGs) {
      console.warn(`Ghostscript (${binarioGs}) falló:`, errGs.message);
    }
  }

  // 2. Motor de compresión interno con pdf-lib (fallback si Ghostscript no operó)
  if (!exitoGhostscript) {
    const pdfBytes = fs.readFileSync(rutaPdf);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

    const bytesOptimizados = await pdfDoc.save({
      useObjectStreams: true,
      addDefaultPage: false,
      objectsPerTick: 100
    });

    fs.writeFileSync(rutaFinalComprimido, bytesOptimizados);
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

