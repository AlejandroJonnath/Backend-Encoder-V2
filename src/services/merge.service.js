import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { CONFIGURACION } from '../config/constantes.js';
import { generarNombreArchivoSeguro } from '../utils/fileSecurity.js';
import { comprimirDocumentoPdf } from './compress.service.js';

/**
 * Servicio para unir múltiples documentos PDF aplicando optimización de peso.
 * Garantiza que el archivo resultante siempre se almacene en la raíz de RUTA_TEMPORAL
 * con un nombre seguro para evitar borrados accidentales en la purga de sesiones.
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
  
  // Guardar directamente en el directorio temporal principal (no en el subdirectorio de la sesión)
  const dirTemporalPrincipal = CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL;
  const nombreTemporal = generarNombreArchivoSeguro(`${nombreBase}_temp_join.pdf`);
  const rutaTemporalUnido = path.join(dirTemporalPrincipal, nombreTemporal);
  fs.writeFileSync(rutaTemporalUnido, bytesUnidos);

  let rutaFinalJoin = rutaTemporalUnido;

  // Aplicar compresión adicional para que el archivo final no sea pesado
  try {
    const resultadoCompresion = await comprimirDocumentoPdf({
      rutaPdf: rutaTemporalUnido,
      calidad: 'ebook'
    });

    const nombreFisicoFinal = generarNombreArchivoSeguro(`${nombreBase}_join.pdf`);
    rutaFinalJoin = path.join(dirTemporalPrincipal, nombreFisicoFinal);
    fs.renameSync(resultadoCompresion.rutaArchivo, rutaFinalJoin);

    // Limpiar archivo temporal inicial si difiere
    if (fs.existsSync(rutaTemporalUnido) && rutaTemporalUnido !== rutaFinalJoin) {
      fs.unlinkSync(rutaTemporalUnido);
    }
  } catch (errCompresion) {
    console.warn('[Merge] Aviso en compresión post-unión, conservando versión pdf-lib:', errCompresion.message);
    const nombreFisicoFinal = generarNombreArchivoSeguro(`${nombreBase}_join.pdf`);
    rutaFinalJoin = path.join(dirTemporalPrincipal, nombreFisicoFinal);
    fs.renameSync(rutaTemporalUnido, rutaFinalJoin);
  }

  const stats = fs.statSync(rutaFinalJoin);

  return {
    rutaArchivo: rutaFinalJoin,
    nombreArchivo: `${nombreBase}_join.pdf`,
    tamanioFinalBytes: stats.size
  };
}
