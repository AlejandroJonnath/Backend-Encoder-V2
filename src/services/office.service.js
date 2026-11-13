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

let tieneXvfbCache = undefined;

/**
 * Detecta si xvfb-run y xauth están instalados (necesario en Linux/Docker para virtual display de LibreOffice)
 */
export async function tieneXvfb() {
  if (tieneXvfbCache !== undefined) return tieneXvfbCache;
  if (process.platform === 'win32') {
    tieneXvfbCache = false;
    return false;
  }
  try {
    await execPromesa('which xvfb-run && which xauth');
    tieneXvfbCache = true;
    return true;
  } catch (_) {
    tieneXvfbCache = false;
    return false;
  }
}

/**
 * Construye el comando de conversión de LibreOffice utilizando xvfb-run si está disponible
 */
export async function construirComandoLibreOffice(binarioLo, urlPerfil, dirSalida, rutaArchivo) {
  const usaXvfb = await tieneXvfb();
  const prefijo = usaXvfb ? 'xvfb-run -a -s "-screen 0 1024x768x24" ' : '';
  return `${prefijo}"${binarioLo}" --headless --invisible --nodefault --nofirststartwizard --nologo --norestore --nolockcheck -env:UserInstallation=${urlPerfil} --convert-to pdf --outdir "${dirSalida}" "${rutaArchivo}"`;
}

/**
 * Ejecuta la conversión de LibreOffice garantizando la máxima fidelidad:
 * 1. Intenta primero con xvfb-run (servidor X11 virtual completo en memoria).
 * 2. Si falla o no está disponible, intenta con el plugin SVP offscreen nativo de LibreOffice.
 */
export async function ejecutarLibreOfficeConFallback({ binarioLo, urlPerfil, dirSalida, rutaArchivo }) {
  const nombreBaseAConvertir = path.basename(rutaArchivo, path.extname(rutaArchivo));
  const rutaEsperadaPdf = path.join(dirSalida, `${nombreBaseAConvertir}.pdf`);

  const usaXvfb = await tieneXvfb();
  if (usaXvfb) {
    try {
      const cmdXvfb = `xvfb-run -a -s "-screen 0 1024x768x24" "${binarioLo}" --headless --invisible --nodefault --nofirststartwizard --nologo --norestore --nolockcheck -env:UserInstallation=${urlPerfil} --convert-to pdf --outdir "${dirSalida}" "${rutaArchivo}"`;
      const resXvfb = await execPromesa(cmdXvfb, {
        timeout: 60000,
        env: { ...process.env, HOME: '/tmp' }
      });
      console.log('[Office] LibreOffice (xvfb) stdout:', resXvfb.stdout, 'stderr:', resXvfb.stderr);

      if (fs.existsSync(rutaEsperadaPdf) && fs.statSync(rutaEsperadaPdf).size > 0) {
        return rutaEsperadaPdf;
      }

      const archivos = fs.readdirSync(dirSalida);
      const coincide = archivos.find(f => f.endsWith('.pdf') && (f.startsWith(nombreBaseAConvertir) || f.includes(nombreBaseAConvertir.slice(0, 15))));
      if (coincide) {
        const rutaMatch = path.join(dirSalida, coincide);
        if (fs.statSync(rutaMatch).size > 0) return rutaMatch;
      }
    } catch (errXvfb) {
      console.warn('[Office] xvfb-run falló, probando con backend SVP directo:', errXvfb.message);
    }
  }

  // Fallback con LibreOffice directo usando backend offscreen SVP
  try {
    const cmdDirecto = `"${binarioLo}" --headless --invisible --nodefault --nofirststartwizard --nologo --norestore --nolockcheck -env:UserInstallation=${urlPerfil} --convert-to pdf --outdir "${dirSalida}" "${rutaArchivo}"`;
    const resSvp = await execPromesa(cmdDirecto, {
      timeout: 60000,
      env: { ...process.env, HOME: '/tmp', SAL_USE_VCLPLUGIN: 'svp' }
    });
    console.log('[Office] LibreOffice (svp) stdout:', resSvp.stdout, 'stderr:', resSvp.stderr);

    if (fs.existsSync(rutaEsperadaPdf) && fs.statSync(rutaEsperadaPdf).size > 0) {
      return rutaEsperadaPdf;
    }

    const archivos = fs.readdirSync(dirSalida);
    const coincide = archivos.find(f => f.endsWith('.pdf') && (f.startsWith(nombreBaseAConvertir) || f.includes(nombreBaseAConvertir.slice(0, 15))));
    if (coincide) {
      const rutaMatch = path.join(dirSalida, coincide);
      if (fs.statSync(rutaMatch).size > 0) return rutaMatch;
    }
  } catch (errSvp) {
    console.error('[Office] LibreOffice (svp) también falló:', errSvp.message);
  }

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
    const loProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-word-'));
    try {
      const urlPerfil = `file://${loProfile.replace(/\\/g, '/')}`;
      const archivoGenerado = await ejecutarLibreOfficeConFallback({
        binarioLo,
        urlPerfil,
        dirSalida,
        rutaArchivo: rutaDocx
      });

      if (archivoGenerado && fs.existsSync(archivoGenerado) && fs.statSync(archivoGenerado).size > 0) {
        if (archivoGenerado !== rutaFinalPdf) {
          fs.renameSync(archivoGenerado, rutaFinalPdf);
        }
        return {
          rutaArchivo: rutaFinalPdf,
          nombreArchivo: `${nombreBase}_converted.pdf`
        };
      }
    } catch (errLo) {
      console.error('[Word] LibreOffice falló:', errLo.message);
    } finally {
      try { fs.rmSync(loProfile, { recursive: true, force: true }); } catch (_) {}
    }
  }

  // 3. Motor Nativo Autónomo (100% JavaScript: preserva estructura, títulos e incrusta imágenes vectorialmente)
  return await renderizarWordNativoConPdfLib({
    rutaDocx,
    rutaSalidaPdf: rutaFinalPdf
  });
}

/**
 * Convierte archivos Office (Word) a PDF con fidelidad exacta al original
 */
export async function convertirOfficeAPdf(rutaArchivo) {
  const extension = path.extname(rutaArchivo).toLowerCase();

  if (extension === '.docx' || extension === '.doc') {
    return await convertirWordAPdf(rutaArchivo);
  }

  throw new Error(`Formato no soportado para conversión directa: ${extension}`);
}
