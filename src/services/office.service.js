import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import puppeteer from 'puppeteer';
import { exec } from 'child_process';
import util from 'util';
import { eliminarArchivoSeguro } from './cleanup.service.js';

const execPromesa = util.promisify(exec);

let binarioLibreOfficeCache = undefined;
let binarioNavegadorCache = undefined;

/**
 * Detecta qué binario de LibreOffice/soffice está disponible en el sistema operativo
 */
export async function obtenerBinarioLibreOffice() {
  if (binarioLibreOfficeCache !== undefined) {
    return binarioLibreOfficeCache;
  }

  const candidatos = process.platform === 'win32'
    ? [
        'soffice',
        'libreoffice',
        'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
      ]
    : ['libreoffice', 'soffice', '/usr/bin/libreoffice', '/usr/bin/soffice'];

  for (const bin of candidatos) {
    if (bin.includes('\\') || bin.includes('/')) {
      if (fs.existsSync(bin)) {
        binarioLibreOfficeCache = bin;
        return bin;
      }
    } else {
      try {
        await execPromesa(`"${bin}" --version`);
        binarioLibreOfficeCache = bin;
        return bin;
      } catch (_) {}
    }
  }

  binarioLibreOfficeCache = null;
  return null;
}

/**
 * Detecta un navegador basado en Chromium (Google Chrome o Microsoft Edge)
 * para renderizado nativo headless sin dependencias de WebSocket
 */
export async function obtenerBinarioNavegador() {
  if (binarioNavegadorCache !== undefined) {
    return binarioNavegadorCache;
  }

  const candidatos = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'chrome',
        'msedge'
      ]
    : [
        'google-chrome',
        'google-chrome-stable',
        'chromium',
        'chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
      ];

  for (const bin of candidatos) {
    if (bin.includes('\\') || bin.includes('/')) {
      if (fs.existsSync(bin)) {
        binarioNavegadorCache = bin;
        return bin;
      }
    } else {
      try {
        const cmdCheck = process.platform === 'win32' ? `where ${bin}` : `which ${bin}`;
        await execPromesa(cmdCheck);
        binarioNavegadorCache = bin;
        return bin;
      } catch (_) {}
    }
  }

  binarioNavegadorCache = null;
  return null;
}

/**
 * Escapa cadenas para inserción segura en plantillas HTML
 */
function escaparHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Decodifica entidades HTML a texto legible
 */
function decodificarEntidadesHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&#9679;/g, '•')
    .replace(/&bull;/g, '•')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&ntilde;/gi, 'ñ');
}

/**
 * Sanitiza cualquier texto para evitar fallos de codificación en WinAnsi de pdf-lib
 */
function sanitizarParaPdfLib(str, fallback = '') {
  if (!str) return fallback;
  return String(str)
    .normalize('NFC')
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu, '')
    .replace(/[^\x00-\xFF]/g, (char) => {
      const mapa = {
        '—': '-', '–': '-', '’': "'", '‘': "'", '”': '"', '“': '"', '•': '*'
      };
      return mapa[char] || ' ';
    })
    .trim() || fallback;
}

/**
 * Ajuste de línea (word wrap) inteligente para renderizado vectorial en pdf-lib
 */
function envolverTexto(texto, maxCaracteres) {
  if (!texto) return [];
  const palabras = texto.split(/\s+/);
  const lineas = [];
  let lineaActual = '';

  for (const palabra of palabras) {
    if ((lineaActual + ' ' + palabra).trim().length <= maxCaracteres) {
      lineaActual = (lineaActual + ' ' + palabra).trim();
    } else {
      if (lineaActual) lineas.push(lineaActual);
      if (palabra.length > maxCaracteres) {
        // Cortar palabra extremadamente larga
        let resto = palabra;
        while (resto.length > maxCaracteres) {
          lineas.push(resto.substring(0, maxCaracteres));
          resto = resto.substring(maxCaracteres);
        }
        lineaActual = resto;
      } else {
        lineaActual = palabra;
      }
    }
  }

  if (lineaActual) lineas.push(lineaActual);
  return lineas;
}

/**
 * Motor universal de renderizado de HTML a PDF.
 * Intenta en orden:
 * 1. Binario de navegador del sistema (Chrome / Edge / Chromium) con --print-to-pdf
 * 2. Puppeteer con perfil aislado único
 * Retorna true si generó el PDF con éxito, false si no fue posible.
 */
export async function renderizarHtmlConNavegador({ html, rutaSalidaPdf, landscape = false }) {
  const dirTemp = path.dirname(rutaSalidaPdf);
  const nombreTempHtml = `render_${Date.now()}_${Math.random().toString(36).substring(7)}.html`;
  const rutaHtmlTemp = path.join(dirTemp, nombreTempHtml);

  try {
    await fs.promises.writeFile(rutaHtmlTemp, html, 'utf-8');

    // 1. Binario Chromium directo (ultrarrápido y sin problemas de websocket o perfiles ocupados)
    const binarioNav = await obtenerBinarioNavegador();
    if (binarioNav) {
      try {
        const flagLandscape = landscape ? '--print-to-pdf-landscape' : '';
        const cmd = `"${binarioNav}" --headless --no-sandbox --disable-gpu --disable-dev-shm-usage ${flagLandscape} --print-to-pdf="${rutaSalidaPdf}" "${rutaHtmlTemp}"`;
        await execPromesa(cmd, { timeout: 35000 });

        if (fs.existsSync(rutaSalidaPdf) && fs.statSync(rutaSalidaPdf).size > 0) {
          return true;
        }
      } catch (errCmd) {
        console.warn('[HTML->PDF] Binario de navegador falló, probando Puppeteer:', errCmd.message);
      }
    }

    // 2. Puppeteer con directorio de perfil único aislado
    try {
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puppeteer-job-'));
      let browser;
      try {
        browser = await puppeteer.launch({
          headless: true,
          userDataDir,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.pdf({
          path: rutaSalidaPdf,
          format: 'A4',
          landscape: !!landscape,
          printBackground: true,
          margin: landscape
            ? { top: 0, bottom: 0, left: 0, right: 0 }
            : { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' }
        });

        if (fs.existsSync(rutaSalidaPdf) && fs.statSync(rutaSalidaPdf).size > 0) {
          return true;
        }
      } finally {
        if (browser) await browser.close();
        try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
      }
    } catch (errPup) {
      console.warn('[HTML->PDF] Puppeteer no pudo completar el renderizado:', errPup.message);
    }
  } finally {
    eliminarArchivoSeguro(rutaHtmlTemp);
  }

  return false;
}

/**
 * Convierte imágenes (JPG, PNG, JPEG) a PDF
 */
export async function convertirImagenAPdf(rutaImagen) {
  const extension = path.extname(rutaImagen).toLowerCase();
  const dirSalida = path.dirname(rutaImagen);
  const nombreBase = path.basename(rutaImagen, extension);
  const rutaFinalPdf = path.join(dirSalida, `${nombreBase}_converted.pdf`);

  const { data: imagenBuffer, info: metadata } = await sharp(rutaImagen)
    .toBuffer({ resolveWithObject: true });

  const pdfDoc = await PDFDocument.create();
  let imagenIncrustada;

  if (extension === '.png') {
    imagenIncrustada = await pdfDoc.embedPng(imagenBuffer);
  } else {
    imagenIncrustada = await pdfDoc.embedJpg(imagenBuffer);
  }

  const escala = Math.min(595.28 / (metadata.width || 600), 841.89 / (metadata.height || 800), 1);
  const anchoPagina = (metadata.width || 600) * escala;
  const altoPagina = (metadata.height || 800) * escala;

  const pagina = pdfDoc.addPage([anchoPagina, altoPagina]);
  pagina.drawImage(imagenIncrustada, {
    x: 0,
    y: 0,
    width: anchoPagina,
    height: altoPagina,
  });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
  await fs.promises.writeFile(rutaFinalPdf, pdfBytes);

  return {
    rutaArchivo: rutaFinalPdf,
    nombreArchivo: `${nombreBase}_converted.pdf`
  };
}

/**
 * Convierte archivos de texto plano (.txt) a PDF con paginación, ajuste de línea y márgenes limpios
 */
export async function convertirTextoPlanoAPdf(rutaTexto) {
  const contenido = await fs.promises.readFile(rutaTexto, 'utf-8');
  const dirSalida = path.dirname(rutaTexto);
  const nombreBase = path.basename(rutaTexto, path.extname(rutaTexto));
  const rutaFinalPdf = path.join(dirSalida, `${nombreBase}_converted.pdf`);

  const pdfDoc = await PDFDocument.create();
  const fontCourier = await pdfDoc.embedFont(StandardFonts.Courier);
  const fontCourierBold = await pdfDoc.embedFont(StandardFonts.CourierBold);

  // Dividir y envolver líneas para que ninguna se corte a los 85 caracteres
  const lineasBrutas = contenido.split(/\r?\n/);
  const lineasFormateadas = [];

  for (const l of lineasBrutas) {
    if (!l.trim()) {
      lineasFormateadas.push('');
    } else {
      const envueltas = envolverTexto(l, 80);
      lineasFormateadas.push(...envueltas);
    }
  }

  const lineasPorPagina = 50;
  const totalPaginas = Math.max(1, Math.ceil(lineasFormateadas.length / lineasPorPagina));

  for (let i = 0; i < lineasFormateadas.length; i += lineasPorPagina) {
    const paginaActual = Math.floor(i / lineasPorPagina) + 1;
    const pagina = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = pagina.getSize();
    const lote = lineasFormateadas.slice(i, i + lineasPorPagina);

    // Encabezado decorativo
    pagina.drawText(sanitizarParaPdfLib(nombreBase.toUpperCase()), {
      x: 45,
      y: height - 35,
      size: 8,
      font: fontCourierBold,
      color: rgb(0.3, 0.4, 0.5)
    });

    pagina.drawLine({
      start: { x: 45, y: height - 42 },
      end: { x: width - 45, y: height - 42 },
      color: rgb(0.85, 0.88, 0.92),
      thickness: 0.8
    });

    lote.forEach((linea, index) => {
      const limpia = sanitizarParaPdfLib(linea);
      pagina.drawText(limpia, {
        x: 45,
        y: height - 60 - (index * 14),
        size: 9.5,
        font: fontCourier,
        color: rgb(0.08, 0.10, 0.15),
      });
    });

    // Pie de página
    pagina.drawText(`Página ${paginaActual} de ${totalPaginas}`, {
      x: width - 130,
      y: 25,
      size: 8,
      font: fontCourier,
      color: rgb(0.4, 0.45, 0.5)
    });
  }

  const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
  await fs.promises.writeFile(rutaFinalPdf, pdfBytes);

  return {
    rutaArchivo: rutaFinalPdf,
    nombreArchivo: `${nombreBase}_converted.pdf`
  };
}

/**
 * Fallback estructurado con pdf-lib para Word cuando no hay navegadores en el sistema.
 * Genera un documento con jerarquía de títulos, párrafos con ajuste de línea y diseño tipográfico profesional.
 */
async function generarPdfWordEstructurado({ html, textoExtraido, rutaDestino, nombreArchivo }) {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Extraer bloques de contenido desde el HTML generado por Mammoth
  const bloques = [];
  const regexBloques = /<(h[1-6]|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = regexBloques.exec(html)) !== null) {
    const etiqueta = match[1].toLowerCase();
    const contenidoHtml = match[2];
    const textoPlano = decodificarEntidadesHtml(contenidoHtml.replace(/<[^>]+>/g, '')).trim();

    if (textoPlano) {
      bloques.push({
        tipo: etiqueta.startsWith('h') ? 'titulo' : (etiqueta === 'li' ? 'item' : 'parrafo'),
        nivel: etiqueta.startsWith('h') ? parseInt(etiqueta.charAt(1), 10) : 0,
        texto: textoPlano
      });
    }
  }

  // Si no se extrajeron bloques del HTML, usar el texto extraído
  if (bloques.length === 0) {
    const lineas = (textoExtraido || '').split(/\r?\n/).filter(l => l.trim());
    if (lineas.length === 0) {
      bloques.push({ tipo: 'parrafo', texto: 'Documento procesado sin contenido visible.' });
    } else {
      for (const linea of lineas) {
        bloques.push({ tipo: 'parrafo', texto: linea.trim() });
      }
    }
  }

  let pagina = pdfDoc.addPage([595.28, 841.89]);
  let { width, height } = pagina.getSize();
  const margenX = 54; // 19 mm
  let cursorY = height - 60;
  let numeroPagina = 1;

  function verificarSaltoPagina(espacioRequerido) {
    if (cursorY - espacioRequerido < 50) {
      // Dibujar pie de página en página saliente
      pagina.drawText(`Página ${numeroPagina}`, {
        x: width - margenX - 60,
        y: 30,
        size: 9,
        font: fontRegular,
        color: rgb(0.5, 0.55, 0.6)
      });

      numeroPagina++;
      pagina = pdfDoc.addPage([595.28, 841.89]);
      cursorY = height - 60;
    }
  }

  for (const b of bloques) {
    if (b.tipo === 'titulo') {
      const fontSize = b.nivel === 1 ? 18 : (b.nivel === 2 ? 14 : 12);
      const interlineado = fontSize + 6;
      const lineas = envolverTexto(sanitizarParaPdfLib(b.texto), b.nivel === 1 ? 48 : 60);

      verificarSaltoPagina((lineas.length * interlineado) + 20);
      cursorY -= 12;

      for (const l of lineas) {
        pagina.drawText(l, {
          x: margenX,
          y: cursorY,
          size: fontSize,
          font: fontBold,
          color: rgb(0.06, 0.09, 0.16) // #0F172A
        });
        cursorY -= interlineado;
      }

      if (b.nivel === 1) {
        pagina.drawLine({
          start: { x: margenX, y: cursorY + 4 },
          end: { x: width - margenX, y: cursorY + 4 },
          color: rgb(0.85, 0.88, 0.92),
          thickness: 1.2
        });
      }
      cursorY -= 8;
    } else if (b.tipo === 'item') {
      const lineas = envolverTexto(sanitizarParaPdfLib(b.texto), 70);
      verificarSaltoPagina(lineas.length * 15);

      lineas.forEach((l, idx) => {
        if (idx === 0) {
          pagina.drawCircle({
            x: margenX + 6,
            y: cursorY + 3,
            size: 2.2,
            color: rgb(0.01, 0.52, 0.78)
          });
        }
        pagina.drawText(l, {
          x: margenX + 16,
          y: cursorY,
          size: 10,
          font: fontRegular,
          color: rgb(0.12, 0.16, 0.22)
        });
        cursorY -= 15;
      });
      cursorY -= 4;
    } else {
      const lineas = envolverTexto(sanitizarParaPdfLib(b.texto), 75);
      verificarSaltoPagina((lineas.length * 15) + 6);

      for (const l of lineas) {
        pagina.drawText(l, {
          x: margenX,
          y: cursorY,
          size: 10,
          font: fontRegular,
          color: rgb(0.12, 0.16, 0.22)
        });
        cursorY -= 15;
      }
      cursorY -= 6;
    }
  }

  // Pie de página final
  pagina.drawText(`Página ${numeroPagina}`, {
    x: width - margenX - 60,
    y: 30,
    size: 9,
    font: fontRegular,
    color: rgb(0.5, 0.55, 0.6)
  });

  const bytes = await pdfDoc.save({ useObjectStreams: true });
  await fs.promises.writeFile(rutaDestino, bytes);

  return {
    rutaArchivo: rutaDestino,
    nombreArchivo
  };
}

/**
 * Fallback de alta fidelidad con pdf-lib para PowerPoint cuando no hay navegadores en el sistema.
 * Genera diapositivas en A4 apaisado (Landscape 841.89 x 595.28 pt) con tarjetas, badges,
 * títulos en negrita de alta jerarquía, divisores y viñetas dibujadas vectorialmente.
 */
async function generarPdfPresentacionDesdeDiapositivas({ diapositivas, rutaDestino, nombreArchivo }) {
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontNormal = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const total = diapositivas.length || 1;

  for (let i = 0; i < diapositivas.length; i++) {
    const s = diapositivas[i];
    // A4 Landscape estándar
    const page = pdfDoc.addPage([841.89, 595.28]);
    const { width, height } = page.getSize();

    // 1. Fondo elegante oscuro (Tema Dark Zinc / Slate)
    page.drawRectangle({
      x: 0,
      y: 0,
      width,
      height,
      color: rgb(0.06, 0.07, 0.10) // #0F172A
    });

    // 2. Tarjeta contenedora de la diapositiva
    const cardMargin = 32;
    page.drawRectangle({
      x: cardMargin,
      y: cardMargin,
      width: width - (cardMargin * 2),
      height: height - (cardMargin * 2),
      color: rgb(0.09, 0.11, 0.16), // #171E2E
      borderColor: rgb(0.20, 0.25, 0.35),
      borderWidth: 1
    });

    // 3. Badge superior
    const badgeText = `DIAPOSITIVA ${s.numero || (i + 1)} DE ${total}`;
    page.drawText(badgeText, {
      x: cardMargin + 32,
      y: height - cardMargin - 45,
      size: 11,
      font: fontBold,
      color: rgb(0.22, 0.74, 0.97) // #38BDF8
    });

    // 4. Título de la diapositiva con ajuste de línea si es largo
    const tituloLimpio = sanitizarParaPdfLib(s.titulo || `Diapositiva ${i + 1}`);
    const lineasTitulo = envolverTexto(tituloLimpio, 52);
    let curY = height - cardMargin - 78;

    for (const lt of lineasTitulo.slice(0, 2)) {
      page.drawText(lt, {
        x: cardMargin + 32,
        y: curY,
        size: 20,
        font: fontBold,
        color: rgb(1, 1, 1)
      });
      curY -= 26;
    }

    // 5. Divisor decorativo
    page.drawLine({
      start: { x: cardMargin + 32, y: curY - 2 },
      end: { x: cardMargin + 160, y: curY - 2 },
      color: rgb(0.22, 0.74, 0.97),
      thickness: 3
    });

    curY -= 32;

    // 6. Lista de puntos y viñetas
    const puntos = Array.isArray(s.puntos) && s.puntos.length > 0
      ? s.puntos
      : ['Contenido de la presentación'];

    for (const p of puntos.slice(0, 7)) {
      const textoLimpio = sanitizarParaPdfLib(decodificarEntidadesHtml(p));
      const lineasPunto = envolverTexto(textoLimpio, 72);

      // Viñeta circular decorativa
      page.drawCircle({
        x: cardMargin + 44,
        y: curY + 4,
        size: 4,
        color: rgb(0.22, 0.74, 0.97)
      });

      for (let idx = 0; idx < lineasPunto.length; idx++) {
        page.drawText(lineasPunto[idx], {
          x: cardMargin + 62,
          y: curY,
          size: 13,
          font: fontNormal,
          color: rgb(0.89, 0.91, 0.94) // #E2E8F0
        });
        curY -= 20;
      }
      curY -= 10;
    }

    // 7. Pie de página
    page.drawText('EncoderGoti Presentation Suite', {
      x: cardMargin + 32,
      y: cardMargin + 22,
      size: 9.5,
      font: fontNormal,
      color: rgb(0.40, 0.45, 0.55)
    });

    page.drawText(`Diapositiva ${s.numero || (i + 1)}`, {
      x: width - cardMargin - 110,
      y: cardMargin + 22,
      size: 9.5,
      font: fontNormal,
      color: rgb(0.40, 0.45, 0.55)
    });
  }

  const bytes = await pdfDoc.save({ useObjectStreams: true });
  await fs.promises.writeFile(rutaDestino, bytes);

  return {
    rutaArchivo: rutaDestino,
    nombreArchivo
  };
}

/**
 * Convierte documentos Word (.docx, .doc) a PDF con maquetación completa
 */
export async function convertirWordAPdf(rutaDocx) {
  const extension = path.extname(rutaDocx).toLowerCase();
  const dirSalida = path.dirname(rutaDocx);
  const nombreBase = path.basename(rutaDocx, extension);
  const rutaFinalPdf = path.join(dirSalida, `${nombreBase}_converted.pdf`);

  // 1. Motor Primario: LibreOffice Headless (si está instalado en el servidor o contenedor)
  const binarioLo = await obtenerBinarioLibreOffice();
  if (binarioLo) {
    try {
      const comandoLo = `"${binarioLo}" --headless --convert-to pdf --outdir "${dirSalida}" "${rutaDocx}"`;
      await execPromesa(comandoLo, { timeout: 60000 });
      const archivoGenerado = path.join(dirSalida, `${nombreBase}.pdf`);
      if (fs.existsSync(archivoGenerado) && fs.statSync(archivoGenerado).size > 0) {
        if (archivoGenerado !== rutaFinalPdf) {
          fs.renameSync(archivoGenerado, rutaFinalPdf);
        }
        return {
          rutaArchivo: rutaFinalPdf,
          nombreArchivo: `${nombreBase}_converted.pdf`
        };
      }
    } catch (errLo) {
      console.warn('[Word] LibreOffice no completó la conversión, pasando a motor alternativo:', errLo.message);
    }
  }

  // 2. Motor Secundario: Mammoth + Renderizador HTML Chromium
  let htmlCuerpo = '';
  let textoExtraido = '';

  try {
    const resultadoMammoth = await mammoth.convertToHtml({ path: rutaDocx });
    htmlCuerpo = resultadoMammoth.value;
    const raw = await mammoth.extractRawText({ path: rutaDocx }).catch(() => null);
    if (raw?.value) textoExtraido = raw.value;
  } catch (errMammoth) {
    console.warn(`[Word] Mammoth no pudo parsear como .docx directo (${errMammoth.message}), intentando extracción alternativa...`);
  }

  // Fallbacks para documentos sin formato HTML enriquecido
  if (!htmlCuerpo || htmlCuerpo.trim() === '') {
    try {
      const textoPuro = await mammoth.extractRawText({ path: rutaDocx });
      if (textoPuro?.value?.trim()) {
        textoExtraido = textoPuro.value;
        htmlCuerpo = textoPuro.value.split(/\r?\n/).filter(l => l.trim()).map(p => `<p>${escaparHtml(p)}</p>`).join('');
      }
    } catch (_) {}
  }

  if (!htmlCuerpo || htmlCuerpo.trim() === '') {
    htmlCuerpo = '<p>El documento procesado no contiene texto visible.</p>';
  }

  const htmlDocumento = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <title>${escaparHtml(nombreBase)}</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 22mm 20mm 22mm 20mm;
        }
        * { box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          font-size: 11pt;
          line-height: 1.6;
          color: #1e293b;
          background: #ffffff;
          margin: 0;
          padding: 0;
        }
        h1 { font-size: 22pt; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12pt; border-bottom: 2px solid #e2e8f0; padding-bottom: 6pt; }
        h2 { font-size: 16pt; font-weight: 600; color: #1e293b; margin-top: 16pt; margin-bottom: 8pt; }
        h3 { font-size: 13pt; font-weight: 600; color: #334155; margin-top: 12pt; margin-bottom: 6pt; }
        p { margin-top: 0; margin-bottom: 10pt; text-align: justify; word-wrap: break-word; }
        table { border-collapse: collapse; width: 100%; margin: 14pt 0; page-break-inside: avoid; }
        th, td { border: 1px solid #cbd5e1; padding: 7pt 10pt; text-align: left; font-size: 10pt; }
        th { background-color: #f8fafc; font-weight: 600; color: #0f172a; }
        img { max-width: 100%; height: auto; display: block; margin: 14pt auto; page-break-inside: avoid; border-radius: 4px; }
        ul, ol { margin-top: 0; margin-bottom: 10pt; padding-left: 22pt; }
        li { margin-bottom: 4pt; }
        blockquote { border-left: 4px solid #0284c7; margin: 12pt 0; padding: 8pt 16pt; color: #475569; background: #f8fafc; font-style: italic; }
        strong { font-weight: 600; color: #0f172a; }
        a { color: #0284c7; text-decoration: underline; }
      </style>
    </head>
    <body>
      ${htmlCuerpo}
    </body>
    </html>
  `;

  // Intentar renderizar con Chromium (Chrome, Edge o Puppeteer)
  const exitoNav = await renderizarHtmlConNavegador({
    html: htmlDocumento,
    rutaSalidaPdf: rutaFinalPdf,
    landscape: false
  });

  if (exitoNav) {
    return {
      rutaArchivo: rutaFinalPdf,
      nombreArchivo: `${nombreBase}_converted.pdf`
    };
  }

  // 3. Fallback de alta fidelidad con pdf-lib (estructura párrafos, títulos H1/H2/H3 y listas)
  console.log('[Word] Utilizando motor nativo estructurado de pdf-lib para Word');
  return await generarPdfWordEstructurado({
    html: htmlCuerpo,
    textoExtraido,
    rutaDestino: rutaFinalPdf,
    nombreArchivo: `${nombreBase}_converted.pdf`
  });
}

/**
 * Convierte presentaciones PowerPoint (.pptx, .ppt) a PDF de diapositivas horizontales
 */
export async function convertirPowerPointAPdf(rutaPptx) {
  const extension = path.extname(rutaPptx).toLowerCase();
  const dirSalida = path.dirname(rutaPptx);
  const nombreBase = path.basename(rutaPptx, extension);
  const rutaFinalPdf = path.join(dirSalida, `${nombreBase}_converted.pdf`);

  // 1. Motor Primario: LibreOffice Headless (si está instalado en el servidor o contenedor)
  const binarioLo = await obtenerBinarioLibreOffice();
  if (binarioLo) {
    try {
      const comandoLo = `"${binarioLo}" --headless --convert-to pdf --outdir "${dirSalida}" "${rutaPptx}"`;
      await execPromesa(comandoLo, { timeout: 60000 });
      const archivoGenerado = path.join(dirSalida, `${nombreBase}.pdf`);
      if (fs.existsSync(archivoGenerado) && fs.statSync(archivoGenerado).size > 0) {
        if (archivoGenerado !== rutaFinalPdf) {
          fs.renameSync(archivoGenerado, rutaFinalPdf);
        }
        return {
          rutaArchivo: rutaFinalPdf,
          nombreArchivo: `${nombreBase}_converted.pdf`
        };
      }
    } catch (errLo) {
      console.warn('[PowerPoint] LibreOffice falló, recurriendo a motor secundario:', errLo.message);
    }
  }

  // 2. Motor Secundario: Extracción OpenXML con JSZip + Renderizado de Diapositivas
  const diapositivasEstructuradas = [];

  try {
    const data = await fs.promises.readFile(rutaPptx);
    const zip = await JSZip.loadAsync(data);

    // Buscar archivos de diapositivas ppt/slides/slideX.xml ordenados numéricamente
    const slideFiles = Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)[0], 10);
        const numB = parseInt(b.match(/\d+/)[0], 10);
        return numA - numB;
      });

    const slides = slideFiles.length > 0
      ? slideFiles
      : Object.keys(zip.files).filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'));

    for (let idx = 0; idx < slides.length; idx++) {
      const slidePath = slides[idx];
      const xmlContenido = await zip.file(slidePath).async('string');

      // Extraer párrafos de texto <a:p>
      const parrafos = [];
      const pRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi;
      let matchP;

      while ((matchP = pRegex.exec(xmlContenido)) !== null) {
        const pInterno = matchP[1];
        const tRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi;
        const textos = [];
        let matchT;

        while ((matchT = tRegex.exec(pInterno)) !== null) {
          textos.push(matchT[1]);
        }

        const textoCompleto = decodificarEntidadesHtml(textos.join('').trim());
        if (textoCompleto) {
          parrafos.push(textoCompleto);
        }
      }

      const titulo = parrafos.length > 0 ? parrafos[0] : `Diapositiva ${idx + 1}`;
      const cuerpo = parrafos.slice(1);

      diapositivasEstructuradas.push({
        numero: idx + 1,
        total: slides.length,
        titulo,
        puntos: cuerpo
      });
    }
  } catch (errZip) {
    console.warn(`[PowerPoint] Error leyendo estructura PPTX: ${errZip.message}`);
  }

  // Fallback si no se encontraron diapositivas en el archivo
  if (diapositivasEstructuradas.length === 0) {
    diapositivasEstructuradas.push({
      numero: 1,
      total: 1,
      titulo: nombreBase,
      puntos: ['Presentación convertida a formato PDF.']
    });
  }

  // Generar HTML con maquetación Landscape A4 para cada diapositiva
  const slidesHtml = diapositivasEstructuradas.map((s) => {
    return `
      <div class="slide">
        <div class="slide-header">
          <div class="slide-badge">Diapositiva ${s.numero} de ${s.total}</div>
          <h2 class="slide-title">${escaparHtml(s.titulo)}</h2>
          <div class="slide-divider"></div>
        </div>
        <div class="slide-body">
          ${s.puntos.length > 0
            ? s.puntos.map(p => `
                <div class="slide-bullet">
                  <span class="bullet-dot">&#9679;</span>
                  <span class="bullet-text">${escaparHtml(p)}</span>
                </div>
              `).join('')
            : '<div class="slide-bullet"><span class="bullet-text" style="color:#94a3b8; font-style:italic;">(Diapositiva de presentación)</span></div>'
          }
        </div>
        <div class="slide-footer">
          <span>EncoderGoti Presentation Suite</span>
          <span>Diapositiva ${s.numero}</span>
        </div>
      </div>
    `;
  }).join('');

  const htmlCompleto = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <title>${escaparHtml(nombreBase)}</title>
      <style>
        @page {
          size: 297mm 210mm; /* A4 Landscape */
          margin: 0;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: 0;
          font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
          background: #0f172a;
          color: #f8fafc;
        }
        .slide {
          width: 297mm;
          height: 210mm;
          page-break-after: always;
          padding: 24mm 28mm 18mm 28mm;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          position: relative;
        }
        .slide-badge {
          display: inline-block;
          font-size: 11pt;
          font-weight: 700;
          color: #38bdf8;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          margin-bottom: 6px;
        }
        .slide-title {
          font-size: 22pt;
          font-weight: 700;
          color: #ffffff;
          margin: 0 0 10px 0;
          line-height: 1.3;
        }
        .slide-divider {
          height: 4px;
          width: 90px;
          background: #38bdf8;
          border-radius: 2px;
          margin-bottom: 16px;
        }
        .slide-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 12px;
          justify-content: center;
        }
        .slide-bullet {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          font-size: 14pt;
          line-height: 1.5;
          color: #e2e8f0;
        }
        .bullet-dot {
          color: #38bdf8;
          font-size: 14pt;
          line-height: 1.4;
        }
        .bullet-text {
          flex: 1;
        }
        .slide-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 10pt;
          color: #64748b;
          border-top: 1px solid rgba(255,255,255,0.1);
          padding-top: 8px;
        }
      </style>
    </head>
    <body>
      ${slidesHtml}
    </body>
    </html>
  `;

  // Intentar renderizar las diapositivas apaisadas con Chromium
  const exitoNav = await renderizarHtmlConNavegador({
    html: htmlCompleto,
    rutaSalidaPdf: rutaFinalPdf,
    landscape: true
  });

  if (exitoNav) {
    return {
      rutaArchivo: rutaFinalPdf,
      nombreArchivo: `${nombreBase}_converted.pdf`
    };
  }

  // 3. Fallback de alta fidelidad con pdf-lib (diapositivas visuales en A4 landscape con tarjetas)
  console.log('[PowerPoint] Utilizando motor nativo de diapositivas en A4 landscape con pdf-lib');
  return await generarPdfPresentacionDesdeDiapositivas({
    diapositivas: diapositivasEstructuradas,
    rutaDestino: rutaFinalPdf,
    nombreArchivo: `${nombreBase}_converted.pdf`
  });
}

/**
 * Convierte archivos Office (Word y PowerPoint) a PDF.
 */
export async function convertirOfficeAPdf(rutaArchivo) {
  const extension = path.extname(rutaArchivo).toLowerCase();

  if (extension === '.docx' || extension === '.doc') {
    return await convertirWordAPdf(rutaArchivo);
  }

  if (extension === '.pptx' || extension === '.ppt') {
    return await convertirPowerPointAPdf(rutaArchivo);
  }

  throw new Error(`Formato no soportado para conversión directa: ${extension}`);
}
