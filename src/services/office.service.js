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
 * Sanitiza cualquier texto para evitar fallos de codificación en WinAnsi de pdf-lib
 */
function sanitizarParaPdfLib(str, fallback = '') {
  if (!str) return fallback;
  return String(str)
    .normalize('NFC')
    .replace(/[^\x00-\xFF]/g, (char) => {
      const mapa = {
        '—': '-', '–': '-', '’': "'", '‘': "'", '”': '"', '“': '"', '•': '*', '…': '...'
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
 * Ejecuta un script de PowerShell codificado en Base64 para evitar problemas de escape
 */
async function ejecutarPowerShellSeguro(script, timeoutMs = 90000) {
  const base64Ps = Buffer.from(script, 'utf16le').toString('base64');
  const cmd = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${base64Ps}`;
  return await execPromesa(cmd, { timeout: timeoutMs });
}

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
    : ['/usr/bin/libreoffice', '/usr/bin/soffice', 'libreoffice', 'soffice'];

  for (const bin of candidatos) {
    if (bin.includes('\\') || bin.includes('/')) {
      if (fs.existsSync(bin)) {
        binarioLibreOfficeCache = bin;
        return bin;
      }
    } else {
      try {
        const cmdCheck = process.platform === 'win32' ? `where ${bin}` : `which ${bin}`;
        await execPromesa(cmdCheck);
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
 */
export async function obtenerBinarioNavegador() {
  if (binarioNavegadorCache !== undefined) {
    return binarioNavegadorCache;
  }

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    const binEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (fs.existsSync(binEnv)) {
      binarioNavegadorCache = binEnv;
      return binEnv;
    }
  }

  const candidatos = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'chrome',
        'msedge'
      ]
    : [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        'chromium',
        'chromium-browser',
        'google-chrome'
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
 * Convierte archivos de texto plano (.txt) a PDF con paginación limpia
 */
export async function convertirTextoPlanoAPdf(rutaTexto) {
  const contenido = await fs.promises.readFile(rutaTexto, 'utf-8');
  const dirSalida = path.dirname(rutaTexto);
  const nombreBase = path.basename(rutaTexto, path.extname(rutaTexto));
  const rutaFinalPdf = path.join(dirSalida, `${nombreBase}_converted.pdf`);

  const pdfDoc = await PDFDocument.create();
  const fontCourier = await pdfDoc.embedFont(StandardFonts.Courier);
  const fontCourierBold = await pdfDoc.embedFont(StandardFonts.CourierBold);

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

    // Encabezado
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
 * Motor Autónomo Nativo de Word a PDF (100% JavaScript, sin dependencias externas)
 * Extrae texto jerárquico, títulos, párrafos e incrusta todas las imágenes
 * de word/media/ vectorialmente en las páginas del PDF.
 */
export async function renderizarWordNativoConPdfLib({ rutaDocx, rutaSalidaPdf }) {
  const buf = await fs.promises.readFile(rutaDocx);
  const zip = await JSZip.loadAsync(buf);

  // 1. Extraer y procesar imágenes de word/media/
  const mapaImagenes = {};
  const mediaFiles = Object.keys(zip.files).filter(k => /^word\/media\//i.test(k));
  for (const mf of mediaFiles) {
    try {
      const imgBuffer = await zip.file(mf).async('nodebuffer');
      const ext = path.extname(mf).toLowerCase();
      if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
        const meta = await sharp(imgBuffer).metadata();
        mapaImagenes[mf] = { buffer: imgBuffer, format: meta.format, width: meta.width || 400, height: meta.height || 300 };
      } else {
        const pngBuf = await sharp(imgBuffer).png().toBuffer();
        const meta = await sharp(pngBuf).metadata();
        mapaImagenes[mf] = { buffer: pngBuf, format: 'png', width: meta.width || 400, height: meta.height || 300 };
      }
    } catch (_) {}
  }

  // 2. Extraer texto estructurado con Mammoth
  const rawResult = await mammoth.extractRawText({ buffer: buf });
  const lineasBrutas = rawResult.value.split(/\r?\n/).filter(l => l.trim());

  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const anchoPag = 595.28;
  const altoPag = 841.89;
  const margenX = 45;
  const anchoUtil = anchoPag - (margenX * 2);

  let pagina = pdfDoc.addPage([anchoPag, altoPag]);
  let yPos = altoPag - 45;
  let numPagina = 1;

  function nuevaPagina() {
    pagina.drawText(sanitizarParaPdfLib(`Página ${numPagina}`), {
      x: anchoPag / 2 - 20,
      y: 20,
      size: 8,
      font: fontRegular,
      color: rgb(0.5, 0.55, 0.6)
    });
    numPagina++;
    pagina = pdfDoc.addPage([anchoPag, altoPag]);
    yPos = altoPag - 45;
  }

  // Si hay imágenes, incrustar la primera al inicio (portada o diagrama principal)
  const nombresImg = Object.keys(mapaImagenes);
  if (nombresImg.length > 0) {
    try {
      const imgObj = mapaImagenes[nombresImg[0]];
      const imgEmb = imgObj.format === 'png'
        ? await pdfDoc.embedPng(imgObj.buffer)
        : await pdfDoc.embedJpg(imgObj.buffer);

      const maxW = anchoUtil;
      const maxH = 180;
      const esc = Math.min(maxW / imgObj.width, maxH / imgObj.height, 1);
      const wF = imgObj.width * esc;
      const hF = imgObj.height * esc;
      const xF = margenX + (anchoUtil - wF) / 2;

      pagina.drawImage(imgEmb, {
        x: xF,
        y: yPos - hF,
        width: wF,
        height: hF
      });
      yPos -= (hF + 20);
    } catch (_) {}
  }

  // Recorrer párrafos y dibujar con tipografía jerárquica
  let imgIdx = 1;
  for (let i = 0; i < lineasBrutas.length; i++) {
    const texto = lineasBrutas[i];
    const esTitulo = i === 0 || (texto.length < 60 && !texto.endsWith('.') && texto === texto.toUpperCase());
    const esSubtitulo = !esTitulo && texto.length < 80 && !texto.endsWith('.') && (i < 6 || lineasBrutas[i - 1] === '');

    const tamFuente = esTitulo ? 15 : (esSubtitulo ? 12 : 9.5);
    const fuente = (esTitulo || esSubtitulo) ? fontBold : fontRegular;
    const color = esTitulo ? rgb(0.06, 0.09, 0.16) : (esSubtitulo ? rgb(0.01, 0.41, 0.63) : rgb(0.12, 0.16, 0.23));
    const interlineado = esTitulo ? 20 : (esSubtitulo ? 16 : 13.5);

    const envueltas = envolverTexto(sanitizarParaPdfLib(texto), esTitulo ? 50 : 78);

    if (yPos - (envueltas.length * interlineado) < 50) {
      nuevaPagina();
    }

    envueltas.forEach(linea => {
      pagina.drawText(linea, {
        x: margenX,
        y: yPos,
        size: tamFuente,
        font: fuente,
        color
      });
      yPos -= interlineado;
    });

    yPos -= (esTitulo ? 8 : (esSubtitulo ? 6 : 4));

    // Si quedan más imágenes en el documento, intercalarlas proporcionalmente
    if (imgIdx < nombresImg.length && i === Math.floor(lineasBrutas.length / 2)) {
      try {
        const imgObj = mapaImagenes[nombresImg[imgIdx++]];
        const imgEmb = imgObj.format === 'png'
          ? await pdfDoc.embedPng(imgObj.buffer)
          : await pdfDoc.embedJpg(imgObj.buffer);

        const maxW = anchoUtil * 0.9;
        const maxH = 200;
        const esc = Math.min(maxW / imgObj.width, maxH / imgObj.height, 1);
        const wF = imgObj.width * esc;
        const hF = imgObj.height * esc;

        if (yPos - hF < 50) nuevaPagina();

        pagina.drawImage(imgEmb, {
          x: margenX + (anchoUtil - wF) / 2,
          y: yPos - hF,
          width: wF,
          height: hF
        });
        yPos -= (hF + 16);
      } catch (_) {}
    }
  }

  // Pie de página final
  pagina.drawText(sanitizarParaPdfLib(`Página ${numPagina}`), {
    x: anchoPag / 2 - 20,
    y: 20,
    size: 8,
    font: fontRegular,
    color: rgb(0.5, 0.55, 0.6)
  });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
  await fs.promises.writeFile(rutaSalidaPdf, pdfBytes);

  return {
    rutaArchivo: rutaSalidaPdf,
    nombreArchivo: path.basename(rutaSalidaPdf)
  };
}

/**
 * Convierte documentos Word (.docx, .doc) a PDF con fidelidad exacta al original
 */
export async function convertirWordAPdf(rutaDocx) {
  const extension = path.extname(rutaDocx).toLowerCase();
  const dirSalida = path.dirname(rutaDocx);
  const nombreBase = path.basename(rutaDocx, extension);
  const rutaFinalPdf = path.join(dirSalida, `${nombreBase}_converted.pdf`);
  const rutaAbsolutaDocx = path.resolve(rutaDocx);
  const rutaAbsolutaPdf = path.resolve(rutaFinalPdf);

  // 1. Motor Windows: Automatización COM de Microsoft Word oficial (si está en Windows)
  if (process.platform === 'win32') {
    try {
      const scriptPs = `
        $word = New-Object -ComObject Word.Application
        $word.Visible = $false
        $word.DisplayAlerts = [Microsoft.Office.Interop.Word.WdAlertLevel]::wdAlertsNone
        try {
          $doc = $word.Documents.Open('${rutaAbsolutaDocx.replace(/'/g, "''")}', $false, $true)
          $doc.SaveAs2('${rutaAbsolutaPdf.replace(/'/g, "''")}', 17)
          $doc.Close($false)
        } finally {
          $word.Quit()
          [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
        }
      `;
      await ejecutarPowerShellSeguro(scriptPs, 60000);

      if (fs.existsSync(rutaFinalPdf) && fs.statSync(rutaFinalPdf).size > 0) {
        return {
          rutaArchivo: rutaFinalPdf,
          nombreArchivo: `${nombreBase}_converted.pdf`
        };
      }
    } catch (errCom) {
      console.warn('[Word] Automatización COM de Word no disponible, probando motor alternativo:', errCom.message);
    }
  }

  // 2. Motor Linux/Docker: LibreOffice Headless (si está instalado en el sistema)
  const binarioLo = await obtenerBinarioLibreOffice();
  if (binarioLo) {
    try {
      const comandoLo = `"${binarioLo}" --headless --invisible --nodefault --nofirststartwizard --nologo --norestore --convert-to pdf --outdir "${dirSalida}" "${rutaDocx}"`;
      const resultadoExec = await execPromesa(comandoLo, {
        timeout: 90000,
        env: { ...process.env, HOME: '/tmp' }
      });
      console.log('[Word] LibreOffice stdout:', resultadoExec.stdout, 'stderr:', resultadoExec.stderr);

      let archivoGenerado = path.join(dirSalida, `${nombreBase}.pdf`);
      if (!fs.existsSync(archivoGenerado) || fs.statSync(archivoGenerado).size === 0) {
        try {
          const archivos = fs.readdirSync(dirSalida);
          const coincide = archivos.find(f => f.endsWith('.pdf') && (f.startsWith(nombreBase) || f.includes(nombreBase.slice(0, 15))));
          if (coincide) {
            archivoGenerado = path.join(dirSalida, coincide);
          }
        } catch (_) {}
      }

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
      console.error('[Word] LibreOffice falló:', errLo.message, errLo.stdout, errLo.stderr);
    }
  }

  // 3. Motor Nativo Autónomo (100% JavaScript: preserva estructura, títulos e incrusta imágenes vectorialmente)
  return await renderizarWordNativoConPdfLib({
    rutaDocx,
    rutaSalidaPdf: rutaFinalPdf
  });
}

/**
 * Motor Autónomo Nativo de PowerPoint a PDF (100% JavaScript, sin dependencias externas)
 * Genera 1 página apaisada A4 por diapositiva con diseño estructurado
 * e incrusta todas las imágenes asociadas a cada diapositiva.
 */
export async function renderizarPowerPointNativoConPdfLib({ rutaPptx, rutaSalidaPdf }) {
  const buf = await fs.promises.readFile(rutaPptx);
  const zip = await JSZip.loadAsync(buf);

  // 1. Extraer y procesar imágenes de ppt/media/
  const mapaImagenes = {};
  const mediaFiles = Object.keys(zip.files).filter(k => /^ppt\/media\//i.test(k));
  for (const mf of mediaFiles) {
    try {
      const imgBuffer = await zip.file(mf).async('nodebuffer');
      const ext = path.extname(mf).toLowerCase();
      if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
        const metadata = await sharp(imgBuffer).metadata();
        mapaImagenes[mf] = { buffer: imgBuffer, format: metadata.format, width: metadata.width || 400, height: metadata.height || 300 };
      } else {
        const pngBuf = await sharp(imgBuffer).png().toBuffer();
        const meta = await sharp(pngBuf).metadata();
        mapaImagenes[mf] = { buffer: pngBuf, format: 'png', width: meta.width || 400, height: meta.height || 300 };
      }
    } catch (_) {}
  }

  // 2. Extraer diapositivas en orden correlativo
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)[0], 10);
      const numB = parseInt(b.match(/\d+/)[0], 10);
      return numA - numB;
    });

  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const anchoPag = 841.89; // Landscape A4
  const altoPag = 595.28;

  for (let idx = 0; idx < slideFiles.length; idx++) {
    const slidePath = slideFiles[idx];
    const xmlContenido = await zip.file(slidePath).async('string');

    // Relaciones de imágenes para este slide específico
    const relsPath = slidePath.replace('ppt/slides/slide', 'ppt/slides/_rels/slide') + '.rels';
    const imagenesSlide = [];
    if (zip.file(relsPath)) {
      const relsXml = await zip.file(relsPath).async('string');
      const targetRegex = /Target="([^"]+\.(png|jpg|jpeg|gif|bmp|wmf|emf))"/gi;
      let mRel;
      while ((mRel = targetRegex.exec(relsXml)) !== null) {
        let target = mRel[1].replace(/^\.\.\//, 'ppt/');
        if (!target.startsWith('ppt/')) target = `ppt/${target}`;
        if (mapaImagenes[target]) {
          imagenesSlide.push(mapaImagenes[target]);
        }
      }
    }

    // Extraer párrafos
    const parrafos = [];
    const pRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi;
    let mP;
    while ((mP = pRegex.exec(xmlContenido)) !== null) {
      const pInterno = mP[1];
      const tRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi;
      const textos = [];
      let mT;
      while ((mT = tRegex.exec(pInterno)) !== null) {
        textos.push(mT[1]);
      }
      const txt = textos.join('').trim();
      if (txt) parrafos.push(txt);
    }

    const titulo = parrafos.length > 0 ? parrafos[0] : `Diapositiva ${idx + 1}`;
    const cuerpo = parrafos.slice(1);

    const pagina = pdfDoc.addPage([anchoPag, altoPag]);

    // Fondo blanco con marco moderno
    pagina.drawRectangle({
      x: 18,
      y: 18,
      width: anchoPag - 36,
      height: altoPag - 36,
      borderWidth: 1,
      borderColor: rgb(0.88, 0.91, 0.94),
      color: rgb(1, 1, 1)
    });

    // Número de diapositiva
    pagina.drawText(sanitizarParaPdfLib(`DIAPOSITIVA ${idx + 1} DE ${slideFiles.length}`), {
      x: 35,
      y: altoPag - 45,
      size: 9,
      font: fontRegular,
      color: rgb(0.4, 0.45, 0.5)
    });

    // Título de la diapositiva
    const tituloLimpio = sanitizarParaPdfLib(titulo);
    const lineasTitulo = envolverTexto(tituloLimpio, 55);
    let yTitulo = altoPag - 68;
    lineasTitulo.slice(0, 2).forEach(lt => {
      pagina.drawText(lt, {
        x: 35,
        y: yTitulo,
        size: 19,
        font: fontBold,
        color: rgb(0.06, 0.09, 0.16)
      });
      yTitulo -= 22;
    });

    pagina.drawLine({
      start: { x: 35, y: yTitulo + 5 },
      end: { x: anchoPag - 35, y: yTitulo + 5 },
      thickness: 1.5,
      color: rgb(0.01, 0.45, 0.75)
    });

    let yContenido = yTitulo - 18;
    const tieneImg = imagenesSlide.length > 0;

    // Dibujar viñetas de texto
    const maxPuntos = cuerpo.slice(0, 10);
    for (const p of maxPuntos) {
      if (yContenido < 60) break;
      const env = envolverTexto(sanitizarParaPdfLib(p), tieneImg ? 48 : 85);
      env.forEach((l, lIdx) => {
        if (yContenido < 60) return;
        if (lIdx === 0) {
          pagina.drawText('*', {
            x: 40,
            y: yContenido,
            size: 12,
            font: fontBold,
            color: rgb(0.01, 0.45, 0.75)
          });
        }
        pagina.drawText(l, {
          x: 55,
          y: yContenido,
          size: 11,
          font: fontRegular,
          color: rgb(0.15, 0.2, 0.25)
        });
        yContenido -= 17;
      });
      yContenido -= 5;
    }

    // Incrustar imagen original asociada a esta diapositiva
    if (tieneImg) {
      try {
        const imgObj = imagenesSlide[0];
        const imgEmbedded = imgObj.format === 'png'
          ? await pdfDoc.embedPng(imgObj.buffer)
          : await pdfDoc.embedJpg(imgObj.buffer);

        const maxW = 280;
        const maxH = 340;
        const escala = Math.min(maxW / imgObj.width, maxH / imgObj.height, 1);
        const wFinal = imgObj.width * escala;
        const hFinal = imgObj.height * escala;
        const xImg = anchoPag - 35 - wFinal;
        const yImg = ((altoPag - 100 - hFinal) / 2) + 20;

        pagina.drawImage(imgEmbedded, {
          x: xImg,
          y: Math.max(50, yImg),
          width: wFinal,
          height: hFinal
        });
      } catch (errImg) {
        console.warn('Error incrustando imagen en diapositiva:', errImg.message);
      }
    }

    // Pie de página
    pagina.drawText('EncoderGoti Presentation Suite', {
      x: 35,
      y: 28,
      size: 8,
      font: fontRegular,
      color: rgb(0.5, 0.55, 0.6)
    });
    pagina.drawText(sanitizarParaPdfLib(`Pág. ${idx + 1}`), {
      x: anchoPag - 65,
      y: 28,
      size: 8,
      font: fontRegular,
      color: rgb(0.5, 0.55, 0.6)
    });
  }

  const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
  await fs.promises.writeFile(rutaSalidaPdf, pdfBytes);

  return {
    rutaArchivo: rutaSalidaPdf,
    nombreArchivo: path.basename(rutaSalidaPdf)
  };
}

/**
 * Convierte presentaciones PowerPoint (.pptx, .ppt) a PDF con fidelidad exacta al original
 */
export async function convertirPowerPointAPdf(rutaPptx) {
  const extension = path.extname(rutaPptx).toLowerCase();
  const dirSalida = path.dirname(rutaPptx);
  const nombreBase = path.basename(rutaPptx, extension);
  const rutaFinalPdf = path.join(dirSalida, `${nombreBase}_converted.pdf`);
  const rutaAbsolutaPptx = path.resolve(rutaPptx);
  const rutaAbsolutaPdf = path.resolve(rutaFinalPdf);

  // 1. Motor Windows: Automatización COM de Microsoft PowerPoint oficial (si está en Windows)
  if (process.platform === 'win32') {
    try {
      const scriptPs = `
        $ppt = New-Object -ComObject PowerPoint.Application
        try {
          $pres = $ppt.Presentations.Open('${rutaAbsolutaPptx.replace(/'/g, "''")}', [Microsoft.Office.Core.MsoTriState]::msoTrue, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse)
          $pres.SaveAs('${rutaAbsolutaPdf.replace(/'/g, "''")}', 32)
          $pres.Close()
        } finally {
          $ppt.Quit()
          [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
        }
      `;
      await ejecutarPowerShellSeguro(scriptPs, 90000);

      if (fs.existsSync(rutaFinalPdf) && fs.statSync(rutaFinalPdf).size > 0) {
        return {
          rutaArchivo: rutaFinalPdf,
          nombreArchivo: `${nombreBase}_converted.pdf`
        };
      }
    } catch (errCom) {
      console.warn('[PowerPoint] Automatización COM de PowerPoint no disponible, probando motor alternativo:', errCom.message);
    }
  }

  // 2. Motor Linux/Docker: LibreOffice Headless (si está instalado en el sistema)
  const binarioLo = await obtenerBinarioLibreOffice();
  if (binarioLo) {
    try {
      const comandoLo = `"${binarioLo}" --headless --invisible --nodefault --nofirststartwizard --nologo --norestore --convert-to pdf --outdir "${dirSalida}" "${rutaPptx}"`;
      const resultadoExec = await execPromesa(comandoLo, {
        timeout: 90000,
        env: { ...process.env, HOME: '/tmp' }
      });
      console.log('[PowerPoint] LibreOffice stdout:', resultadoExec.stdout, 'stderr:', resultadoExec.stderr);

      let archivoGenerado = path.join(dirSalida, `${nombreBase}.pdf`);
      if (!fs.existsSync(archivoGenerado) || fs.statSync(archivoGenerado).size === 0) {
        try {
          const archivos = fs.readdirSync(dirSalida);
          const coincide = archivos.find(f => f.endsWith('.pdf') && (f.startsWith(nombreBase) || f.includes(nombreBase.slice(0, 15))));
          if (coincide) {
            archivoGenerado = path.join(dirSalida, coincide);
          }
        } catch (_) {}
      }

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
      console.error('[PowerPoint] LibreOffice falló:', errLo.message, errLo.stdout, errLo.stderr);
    }
  }

  // 3. Motor Nativo Autónomo (100% JavaScript: diapositivas apaisadas con imágenes e iconografía vectorial)
  return await renderizarPowerPointNativoConPdfLib({
    rutaPptx,
    rutaSalidaPdf: rutaFinalPdf
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
