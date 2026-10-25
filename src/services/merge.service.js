import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { comprimirDocumentoPdf } from './compress.service.js';

/**
 * Servicio para unir múltiples documentos PDF aplicando optimización de peso.
 */
export async function unirDocumentosPdf({ rutasPdf, nombreBase = 'documento' }) {
  if (!rutasPdf || rutasPdf.length < 2) {
    throw new Error('Debes proporcionar al menos dos documentos PDF para unirlos.');
  }

  const docUnificado = await PDFDocument.create();

  for (const ruta of rutasPdf) {
    const bytesActual = fs.readFileSync(ruta);
    const docActual = await PDFDocument.load(bytesActual, { ignoreEncryption: true });
    const paginasCopiadas = await docUnificado.copyPages(docActual, docActual.getPageIndices());
    
    paginasCopiadas.forEach(pagina => docUnificado.addPage(pagina));
  }

  // Guardar inicialmente con compresión de streams
  const bytesUnidos = await docUnificado.save({ useObjectStreams: true });
  const dirSalida = path.dirname(rutasPdf[0]);
  const rutaTemporalUnido = path.join(dirSalida, `${nombreBase}_temp_join.pdf`);
  fs.writeFileSync(rutaTemporalUnido, bytesUnidos);

  // Aplicar compresión adicional para que el archivo final no sea pesado
  const resultadoCompresion = await comprimirDocumentoPdf({
    rutaPdf: rutaTemporalUnido,
    calidad: 'ebook'
  });

  const rutaFinalJoin = path.join(dirSalida, `${nombreBase}_join.pdf`);
  fs.renameSync(resultadoCompresion.rutaArchivo, rutaFinalJoin);

  // Limpiar archivo temporal si existe
  if (fs.existsSync(rutaTemporalUnido)) {
    fs.unlinkSync(rutaTemporalUnido);
  }

  const stats = fs.statSync(rutaFinalJoin);

  return {
    rutaArchivo: rutaFinalJoin,
    nombreArchivo: `${nombreBase}_join.pdf`,
    tamanioFinalBytes: stats.size
  };
}
