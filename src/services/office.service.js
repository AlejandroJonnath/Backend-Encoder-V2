import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import puppeteer from 'puppeteer';
import { exec } from 'child_process';
import util from 'util';

const execPromesa = util.promisify(exec);

let binarioLibreOfficeCache = undefined;

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
    try {
      await execPromesa(`"${bin}" --version`);
      binarioLibreOfficeCache = bin;
      return bin;
    } catch (_) {}
  }

  binarioLibreOfficeCache = null;
  return null;
}

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
 * Convierte imágenes (JPG, PNG, JPEG) a PDF
 */
export async function convertirImagenAPdf(rutaImagen) {
  const extension = path.extname(rutaImagen).toLowerCase();
  const dirSalida = path.dirname(rutaImagen);
  const nombreBase = path.basename(rutaImagen, extension);
  const rutaFinalPdf = path.join(dirSalida, `${nombreBase}_converted.pdf`);

  // Obtener metadatos y buffer en una sola pasada (evita doble decode de la imagen)
  const { data: imagenBuffer, info: metadata } = await sharp(rutaImagen)
    .toBuffer({ resolveWithObject: true });

  const pdfDoc = await PDFDocument.create();
  let imagenIncrustada;

  if (extension === '.png') {
    imagenIncrustada = await pdfDoc.embedPng(imagenBuffer);
  } else {
    imagenIncrustada = await pdfDoc.embedJpg(imagenBuffer);
  }

  // Ajustar página al tamaño de la imagen con escala proporcional
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
 * Convierte archivos de texto plano (.txt) a PDF con paginación
 */
export async function convertirTextoPlanoAPdf(rutaTexto) {
  const contenido = await fs.promises.readFile(rutaTexto, 'utf-8');
  const dirSalida = path.dirname(rutaTexto);
  const nombreBase = path.basename(rutaTexto, path.extname(rutaTexto));
  const rutaFinalPdf = path.join(dirSalida, `${nombreBase}_converted.pdf`);

  const pdfDoc = await PDFDocument.create();
  const fontCourier = await pdfDoc.embedFont(StandardFonts.Courier);

  const lineasTotales = contenido.split(/\r?\n/);
  const lineasPorPagina = 55;

  for (let i = 0; i < lineasTotales.length; i += lineasPorPagina) {
    const pagina = pdfDoc.addPage([595.28, 841.89]);
    const { height } = pagina.getSize();
    const lineas = lineasTotales.slice(i, i + lineasPorPagina);

    lineas.forEach((linea, index) => {
      pagina.drawText(linea.substring(0, 85), {
        x: 45,
        y: height - 50 - (index * 13),
        size: 9,
        font: fontCourier,
        color: rgb(0.1, 0.1, 0.1),
      });
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
 * Generador de PDF de respaldo 100% puro con pdf-lib (cero dependencias de navegador)
 */
async function generarPdfDesdeTextoPlano({ texto, rutaDestino, nombreArchivo }) {
  const pdfDoc = await PDFDocument.create();
  const fontHelvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const lineasTotales = (texto || '').split(/\r?\n/).filter(l => l.trim() !== '');
  const lineasPorPagina = 45;

  if (lineasTotales.length === 0) {
    lineasTotales.push('Documento procesado sin texto visible.');
  }

  for (let i = 0; i < lineasTotales.length; i += lineasPorPagina) {
    const pagina = pdfDoc.addPage([595.28, 841.89]);
    const { height } = pagina.getSize();
    const lineas = lineasTotales.slice(i, i + lineasPorPagina);

    lineas.forEach((linea, index) => {
      // Limpiar caracteres no imprimibles que puedan causar conflicto en pdf-lib
      const limpia = linea.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').substring(0, 85);
      pagina.drawText(limpia, {
        x: 45,
        y: height - 50 - (index * 16),
        size: 10,
        font: fontHelvetica,
        color: rgb(0.12, 0.16, 0.22),
      });
    });
  }

  const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
  await fs.promises.writeFile(rutaDestino, pdfBytes);
  return {
    rutaArchivo: rutaDestino,
    nombreArchivo
  };
}

/**
 * Convierte documentos Word (.docx, .doc) a PDF de forma nativa y tolerante a fallos
 */
export async function convertirWordAPdf(rutaDocx) {
  const extension = path.extname(rutaDocx).toLowerCase();
  const dirSalida = path.dirname(rutaDocx);
  const nombreBase = path.basename(rutaDocx, extension);
  const rutaFinalPdf = path.join(dirSalida, `${nombreBase}_converted.pdf`);

  // 1. Motor Primario: LibreOffice Headless (estándar de producción instalado en el contenedor Render)
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

  // 2. Motor Secundario: Mammoth + Puppeteer HTML a PDF
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

  // Fallback si no generó contenido HTML estructurado
  if (!htmlCuerpo || htmlCuerpo.trim() === '') {
    try {
      const textoPuro = await mammoth.extractRawText({ path: rutaDocx });
      if (textoPuro && textoPuro.value && textoPuro.value.trim()) {
        textoExtraido = textoPuro.value;
        htmlCuerpo = textoPuro.value.split(/\r?\n/).filter(l => l.trim()).map(p => `<p>${escaparHtml(p)}</p>`).join('');
      }
    } catch (_) {}
  }

  // Fallback extremo para .doc binario clásico
  if (!htmlCuerpo || htmlCuerpo.trim() === '') {
    try {
      const buffer = await fs.promises.readFile(rutaDocx);
      const contenidoStr = buffer.toString('latin1');
      const coincidencias = contenidoStr.match(/[\x20-\x7E\xC0-\xFF]{4,}/g) || [];
      const textoLimpio = coincidencias.filter(s => !s.startsWith('Microsoft') && !s.includes('Root Entry')).join(' ');
      if (textoLimpio.trim()) {
        textoExtraido = textoLimpio;
        htmlCuerpo = `<p>${escaparHtml(textoLimpio)}</p>`;
      }
    } catch (_) {}
  }

  if (!htmlCuerpo || htmlCuerpo.trim() === '') {
    htmlCuerpo = '<p>El documento no contiene texto visible o está vacío.</p>';
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

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const page = await browser.newPage();
    await page.setContent(htmlDocumento, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.pdf({
      path: rutaFinalPdf,
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' }
    });

    return {
      rutaArchivo: rutaFinalPdf,
      nombreArchivo: `${nombreBase}_converted.pdf`
    };
  } catch (errPuppeteer) {
    console.warn('[Word] Puppeteer no disponible o falló:', errPuppeteer.message);
    // 3. Motor Terciario de Respaldo: Generación directa con pdf-lib (100% infalible)
    return await generarPdfDesdeTextoPlano({
      texto: textoExtraido || htmlCuerpo.replace(/<[^>]+>/g, '\n'),
      rutaDestino: rutaFinalPdf,
      nombreArchivo: `${nombreBase}_converted.pdf`
    });
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Convierte presentaciones PowerPoint (.pptx, .ppt) a PDF de forma nativa y tolerante a fallos
 */
export async function convertirPowerPointAPdf(rutaPptx) {
  const extension = path.extname(rutaPptx).toLowerCase();
  const dirSalida = path.dirname(rutaPptx);
  const nombreBase = path.basename(rutaPptx, extension);
  const rutaFinalPdf = path.join(dirSalida, `${nombreBase}_converted.pdf`);

  // 1. Motor Primario: LibreOffice Headless (estándar de producción instalado en el contenedor Render)
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

  let diapositivasHtml = [];

  try {
    const data = await fs.promises.readFile(rutaPptx);
    const zip = await JSZip.loadAsync(data);

    // Buscar archivos de slides ppt/slides/slideX.xml
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

      // Extraer párrafos <a:p>
      const parrafos = [];
      const pRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi;
      let matchP;
      while ((matchP = pRegex.exec(xmlContenido)) !== null) {
        const pInterno = matchP[1];
        const tRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi;
        let textos = [];
        let matchT;
        while ((matchT = tRegex.exec(pInterno)) !== null) {
          textos.push(matchT[1]);
        }
        const textoCompleto = textos.join('').trim();
        if (textoCompleto) {
          parrafos.push(textoCompleto);
        }
      }

      const titulo = parrafos.length > 0 ? parrafos[0] : `Diapositiva ${idx + 1}`;
      const cuerpo = parrafos.slice(1);

      diapositivasHtml.push(`
        <div class="slide">
          <div class="slide-header">
            <div class="slide-badge">Diapositiva ${idx + 1} de ${slides.length}</div>
            <h2 class="slide-title">${escaparHtml(titulo)}</h2>
            <div class="slide-divider"></div>
          </div>
          <div class="slide-body">
            ${cuerpo.length > 0 
              ? cuerpo.map(p => `<div class="slide-bullet"><span class="bullet-dot">&#9679;</span><span class="bullet-text">${escaparHtml(p)}</span></div>`).join('')
              : '<div class="slide-bullet"><span class="bullet-text" style="color:#94a3b8; font-style:italic;">(Diapositiva de presentación)</span></div>'
            }
          </div>
          <div class="slide-footer">
            <span>EncoderGoti Pro</span>
            <span>Diapositiva ${idx + 1}</span>
          </div>
        </div>
      `);
    }
  } catch (errZip) {
    console.warn(`[PowerPoint] Error leyendo estructura PPTX: ${errZip.message}`);
  }

  // Fallback si no se pudieron extraer diapositivas
  if (diapositivasHtml.length === 0) {
    diapositivasHtml.push(`
      <div class="slide">
        <div class="slide-header">
          <div class="slide-badge">Documento PowerPoint</div>
          <h2 class="slide-title">${escaparHtml(nombreBase)}</h2>
          <div class="slide-divider"></div>
        </div>
        <div class="slide-body">
          <div class="slide-bullet"><span class="bullet-text">Presentación convertida a formato PDF.</span></div>
        </div>
        <div class="slide-footer">
          <span>EncoderGoti</span>
          <span>Página 1</span>
        </div>
      </div>
    `);
  }

  const htmlCompleto = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <title>${escaparHtml(nombreBase)}</title>
      <style>
        @page {
          size: 297mm 210mm; /* A4 Horizontal Landscape */
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
          padding: 26mm 30mm 20mm 30mm;
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
          margin: 0 0 12px 0;
          line-height: 1.3;
        }
        .slide-divider {
          height: 4px;
          width: 80px;
          background: #38bdf8;
          border-radius: 2px;
          margin-bottom: 18px;
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
          padding-top: 10px;
        }
      </style>
    </head>
    <body>
      ${diapositivasHtml.join('')}
    </body>
    </html>
  `;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const page = await browser.newPage();
    await page.setContent(htmlCompleto, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.pdf({
      path: rutaFinalPdf,
      width: '297mm',
      height: '210mm',
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 }
    });

    return {
      rutaArchivo: rutaFinalPdf,
      nombreArchivo: `${nombreBase}_converted.pdf`
    };
  } catch (errPuppeteer) {
    console.warn('[PowerPoint] Puppeteer no disponible o falló:', errPuppeteer.message);
    const textoDiapositivas = diapositivasHtml.map((d, i) => `--- Diapositiva ${i + 1} ---\n${d.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`).join('\n\n');
    return await generarPdfDesdeTextoPlano({
      texto: textoDiapositivas,
      rutaDestino: rutaFinalPdf,
      nombreArchivo: `${nombreBase}_converted.pdf`
    });
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Convierte archivos Office (Word y PowerPoint) a PDF.
 * Utiliza motores nativos en Node.js (Mammoth, JSZip, Puppeteer)
 * sin requerir LibreOffice ni dependencias externas en el sistema.
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

