import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * Servicio para agregar notas visuales e interactivas en un PDF
 */
export async function agregarNotaAlPdf({
  rutaPdf,
  posicion = { x: 100, y: 100, pagina: 1 },
  textoNota = '',
  autor = 'Usuario'
}) {
  if (!textoNota || textoNota.trim() === '') {
    throw new Error('El texto de la nota no puede estar vacío.');
  }

  const pdfBytes = fs.readFileSync(rutaPdf);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const paginas = pdfDoc.getPages();
  const indicePagina = Math.max(0, Math.min(posicion.pagina - 1, paginas.length - 1));
  const pagina = paginas[indicePagina];

  const fontHelvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontHelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const anchoNota = 160;
  const altoNota = 60;
  const posX = posicion.x;
  const posY = posicion.y;
  const fechaStr = new Date().toLocaleDateString('es-ES');

  // 1. Dibujar sombra suave de la nota
  pagina.drawRectangle({
    x: posX + 2,
    y: posY - 2,
    width: anchoNota,
    height: altoNota,
    color: rgb(0.85, 0.85, 0.85),
  });

  // 2. Dibujar fondo amarillo clásico de nota adhesiva (Post-It style)
  pagina.drawRectangle({
    x: posX,
    y: posY,
    width: anchoNota,
    height: altoNota,
    color: rgb(1.0, 0.96, 0.70), // Amarillo suave
    borderColor: rgb(0.90, 0.75, 0.20),
    borderWidth: 1,
  });

  // Función para sanitizar cualquier caracter fuera del conjunto WinAnsi (0-255)
  // evita que emojis o caracteres no latinos provoquen 'WinAnsi cannot encode'
  const limpiarWinAnsi = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu, '')
      .replace(/[^\x00-\xFF]/g, '')
      .trim();
  };

  const autorLimpio = limpiarWinAnsi(autor) || 'Usuario';
  const textoLimpio = limpiarWinAnsi(textoNota) || 'Nota';

  // 3. Encabezado con autor y fecha (sin emojis que provoquen error WinAnsi)
  pagina.drawText(`Nota: ${autorLimpio}`, {
    x: posX + 6,
    y: posY + altoNota - 12,
    size: 7.5,
    font: fontHelveticaBold,
    color: rgb(0.4, 0.3, 0.1),
  });

  pagina.drawText(fechaStr, {
    x: posX + anchoNota - 50,
    y: posY + altoNota - 12,
    size: 6.5,
    font: fontHelvetica,
    color: rgb(0.5, 0.4, 0.2),
  });

  // 4. Contenido del texto de la nota (cortado o ajustado en líneas)
  const lineas = [];
  const palabras = textoLimpio.split(' ');
  let lineaActual = '';

  for (const palabra of palabras) {
    if ((lineaActual + palabra).length > 28) {
      lineas.push(lineaActual);
      lineaActual = palabra + ' ';
    } else {
      lineaActual += palabra + ' ';
    }
  }
  if (lineaActual) lineas.push(lineaActual);

  lineas.slice(0, 3).forEach((linea, index) => {
    pagina.drawText(linea.trim(), {
      x: posX + 6,
      y: posY + altoNota - 26 - (index * 11),
      size: 7.5,
      font: fontHelvetica,
      color: rgb(0.15, 0.15, 0.15),
    });
  });

  const bytesFinales = await pdfDoc.save({ useObjectStreams: true });
  const dirSalida = path.dirname(rutaPdf);
  const nombreBase = path.basename(rutaPdf, path.extname(rutaPdf)).replace(/_addnote$/, '');
  const rutaFinalNota = path.join(dirSalida, `${nombreBase}_addnote.pdf`);

  fs.writeFileSync(rutaFinalNota, bytesFinales);

  return {
    rutaArchivo: rutaFinalNota,
    nombreArchivo: `${nombreBase}_addnote.pdf`
  };
}
