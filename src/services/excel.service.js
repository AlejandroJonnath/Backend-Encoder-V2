import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * 1. Inspecciona el archivo Excel y devuelve información detallada de cada hoja
 * para permitir la previsualización y selección en la aplicación móvil.
 */
export function inspeccionarHojasExcel(rutaExcel) {
  const buffer = fs.readFileSync(rutaExcel);
  const libro = XLSX.read(buffer, { type: 'buffer' });

  const resumenHojas = libro.SheetNames.map(nombreHoja => {

    const hoja = libro.Sheets[nombreHoja];
    // Obtener rango de la hoja (filas y columnas)
    const rango = XLSX.utils.decode_range(hoja['!ref'] || 'A1:A1');
    const filasTotales = rango.e.r - rango.s.r + 1;
    const columnasTotales = rango.e.c - rango.s.c + 1;

    // Convertir a matriz las primeras 5 filas para la vista previa
    const datosFilas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });
    const datosMuestra = datosFilas.slice(0, 5).map(fila => fila.slice(0, 6).map(celda => String(celda)));

    return {
      nombre: nombreHoja,
      filasTotales,
      columnasTotales,
      datosMuestra
    };
  });

  return {
    nombreArchivo: path.basename(rutaExcel),
    totalHojas: libro.SheetNames.length,
    hojas: resumenHojas
  };
}

/**
 * 2. Convierte a PDF únicamente las hojas de Excel seleccionadas por el usuario.
 */
export async function convertirExcelConHojasSeleccionadas({
  rutaExcel,
  hojasSeleccionadas = []
}) {
  const buffer = fs.readFileSync(rutaExcel);
  const libro = XLSX.read(buffer, { type: 'buffer' });

  // Si no se especificaron, tomar todas las hojas
  const hojasAProcesar = hojasSeleccionadas.length > 0
    ? libro.SheetNames.filter(h => hojasSeleccionadas.includes(h))
    : libro.SheetNames;

  if (hojasAProcesar.length === 0) {
    throw new Error('Debes seleccionar al menos una hoja del archivo Excel para convertir.');
  }

  // Generar documento PDF con formato de tabla para cada hoja seleccionada
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (const nombreHoja of hojasAProcesar) {
    const hoja = libro.Sheets[nombreHoja];
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });

    if (filas.length === 0) continue;

    // Paginación de filas por hoja de PDF
    const filasPorPagina = 28;
    for (let i = 0; i < filas.length; i += filasPorPagina) {
      const loteFilas = filas.slice(i, i + filasPorPagina);
      const pagina = pdfDoc.addPage([595.28, 841.89]); // A4 estándar
      const { height } = pagina.getSize();

      // Encabezado de la hoja
      pagina.drawText(`Hoja: ${nombreHoja}`, {
        x: 40,
        y: height - 40,
        size: 13,
        font: fontBold,
        color: rgb(0.12, 0.35, 0.65),
      });

      let yPos = height - 65;

      // Renderizar filas de la tabla
      loteFilas.forEach((fila, filaIdx) => {
        const esEncabezado = (i === 0 && filaIdx === 0);
        const colWidth = 80;

        // Fondo alternado para filas
        if (!esEncabezado && filaIdx % 2 === 0) {
          pagina.drawRectangle({
            x: 35,
            y: yPos - 3,
            width: 520,
            height: 18,
            color: rgb(0.96, 0.97, 0.99),
          });
        }

        fila.slice(0, 6).forEach((celda, colIdx) => {
          const texto = String(celda).substring(0, 15);
          pagina.drawText(texto, {
            x: 40 + (colIdx * colWidth),
            y: yPos + 2,
            size: esEncabezado ? 8.5 : 7.5,
            font: esEncabezado ? fontBold : fontRegular,
            color: esEncabezado ? rgb(0.1, 0.2, 0.4) : rgb(0.2, 0.2, 0.2),
          });
        });

        yPos -= 22;
      });
    }
  }

  const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
  const dirSalida = path.dirname(rutaExcel);
  const nombreBase = path.basename(rutaExcel, path.extname(rutaExcel));
  const rutaFinalPdf = path.join(dirSalida, `${nombreBase}_converted.pdf`);

  fs.writeFileSync(rutaFinalPdf, pdfBytes);

  return {
    rutaArchivo: rutaFinalPdf,
    nombreArchivo: `${nombreBase}_converted.pdf`
  };
}
