import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { CONFIGURACION } from '../config/constantes.js';
import { generarNombreArchivoSeguro } from '../utils/fileSecurity.js';

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

  const anchoNota = 170;
  const altoNota = 65;
  const posX = posicion.x;
  const posY = posicion.y;
  
  // Fecha actual formateada en español
  const fechaStr = new Date().toLocaleDateString('es-EC', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

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
      .normalize('NFC')
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu, '')
      .replace(/[^\x00-\xFF]/g, '')
      .trim();
  };

  const autorLimpio = limpiarWinAnsi(autor) || 'Usuario';
  const textoLimpio = limpiarWinAnsi(textoNota) || 'Nota';

  // 3. Encabezado con persona que lo hizo y fecha actual
  // Autor (izquierda)
  const textoEncabezadoAutor = autorLimpio.length > 18 ? `${autorLimpio.substring(0, 16)}...` : autorLimpio;
  pagina.drawText(`Por: ${textoEncabezadoAutor}`, {
    x: posX + 6,
    y: posY + altoNota - 13,
    size: 7.5,
    font: fontHelveticaBold,
    color: rgb(0.35, 0.25, 0.05),
  });

  // Fecha actual (derecha)
  pagina.drawText(fechaStr, {
    x: posX + anchoNota - 55,
    y: posY + altoNota - 13,
    size: 6.5,
    font: fontHelvetica,
    color: rgb(0.5, 0.4, 0.2),
  });

  // Línea divisoria muy sutil bajo el encabezado
  pagina.drawLine({
    start: { x: posX + 6, y: posY + altoNota - 17 },
    end: { x: posX + anchoNota - 6, y: posY + altoNota - 17 },
    color: rgb(0.90, 0.80, 0.35),
    thickness: 0.5,
  });

  // 4. Mensaje / contenido del texto de la nota (cortado o ajustado en líneas)
  const lineas = [];
  const palabras = textoLimpio.split(' ');
  let lineaActual = '';

  for (const palabra of palabras) {
    if ((lineaActual + palabra).length > 30) {
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
      y: posY + altoNota - 30 - (index * 11),
      size: 7.5,
      font: fontHelvetica,
      color: rgb(0.15, 0.15, 0.15),
    });
  });

  const bytesFinales = await pdfDoc.save({ useObjectStreams: true });
  const dirSalida = CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL;
  const nombreBase = path.basename(rutaPdf, path.extname(rutaPdf)).replace(/_addnote$/, '');
  const nombreFisicoFinal = generarNombreArchivoSeguro(`${nombreBase}_addnote.pdf`);
  const rutaFinalNota = path.join(dirSalida, nombreFisicoFinal);

  fs.writeFileSync(rutaFinalNota, bytesFinales);

  return {
    rutaArchivo: rutaFinalNota,
    nombreArchivo: `${nombreBase}_addnote.pdf`
  };
}
