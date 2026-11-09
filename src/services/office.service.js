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
import { CONFIGURACION } from '../config/constantes.js';
import { convertirConILovePdf } from './ilovepdf.service.js';

const execPromesa = util.promisify(exec);

let binarioLibreOfficeCache = undefined;
let binarioNavegadorCache = undefined;

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
 * para renderizado nativo headless sin dependencias de WebSocket.
 * En Docker/Render usa PUPPETEER_EXECUTABLE_PATH si está definido.
 */
export async function obtenerBinarioNavegador() {
  if (binarioNavegadorCache !== undefined) {
    return binarioNavegadorCache;
  }

  // Variable de entorno configurada en el Dockerfile para Render/Docker
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
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'chrome',
        'msedge'
      ]
    : [
        // Debian/Ubuntu (Render)
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        'chromium',
        'chromium-browser',
        'google-chrome',
        'google-chrome-stable'
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

    // 1. Binario Chromium directo del sistema
    const binarioNav = await obtenerBinarioNavegador();
    if (binarioNav) {
      const chromiumProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-prof-'));
      try {
        const flagLandscape = landscape ? '--print-to-pdf-landscape' : '';
        const flagHeadless = process.platform === 'win32' ? '--headless' : '--headless=new';
        const cmd = `"${binarioNav}" ${flagHeadless} --no-sandbox --disable-setuid-sandbox --disable-gpu --disable-dev-shm-usage --single-process --no-zygote --user-data-dir="${chromiumProfile}" ${flagLandscape} --print-to-pdf="${rutaSalidaPdf}" "${rutaHtmlTemp}"`;
        await execPromesa(cmd, {
          timeout: 45000,
          env: { ...process.env, HOME: '/tmp', DISPLAY: '' }
        });

        if (fs.existsSync(rutaSalidaPdf) && fs.statSync(rutaSalidaPdf).size > 0) {
          return true;
        }
      } catch (errCmd) {
        // Reintentar con --headless estándar si --headless=new no fue reconocido
        try {
          const flagLandscape = landscape ? '--print-to-pdf-landscape' : '';
          const cmdFallback = `"${binarioNav}" --headless --no-sandbox --disable-setuid-sandbox --disable-gpu --disable-dev-shm-usage --single-process --no-zygote --user-data-dir="${chromiumProfile}" ${flagLandscape} --print-to-pdf="${rutaSalidaPdf}" "${rutaHtmlTemp}"`;
          await execPromesa(cmdFallback, {
            timeout: 45000,
            env: { ...process.env, HOME: '/tmp', DISPLAY: '' }
          });
          if (fs.existsSync(rutaSalidaPdf) && fs.statSync(rutaSalidaPdf).size > 0) {
            return true;
          }
        } catch (_) {}
        console.warn('[HTML->PDF] Binario de navegador falló, probando Puppeteer:', errCmd.message);
      } finally {
        try { fs.rmSync(chromiumProfile, { recursive: true, force: true }); } catch (_) {}
      }
    }

    // 2. Puppeteer con perfil aislado único y modo single-process seguro para Render (512MB RAM)
    try {
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puppeteer-job-'));
      let browser;
      try {
        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
          || (process.platform !== 'win32' ? (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : undefined) : undefined);

        browser = await puppeteer.launch({
          headless: true,
          userDataDir,
          executablePath,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
            '--no-zygote'
          ]
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
            : { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' }
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
 * Genera un PDF estructurado a partir de un arreglo de líneas de texto limpio
 */
export async function generarPdfDesdeLineasTexto(lineasBrutas, rutaFinalPdf, nombreTitulo = 'DOCUMENTO') {
  const pdfDoc = await PDFDocument.create();
  const fontCourier = await pdfDoc.embedFont(StandardFonts.Courier);
  const fontCourierBold = await pdfDoc.embedFont(StandardFonts.CourierBold);

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
    pagina.drawText(sanitizarParaPdfLib(nombreTitulo.toUpperCase()), {
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
    nombreArchivo: path.basename(rutaFinalPdf)
  };
}

/**
 * Genera diapositivas apaisadas vectoriales directamente con pdf-lib (fallback PPTX infalible)
 */
export async function generarPdfDiapositivasPdfLib(diapositivas, rutaFinalPdf, nombreBase) {
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const s of diapositivas) {
    // A4 Landscape (841.89 x 595.28)
    const pagina = pdfDoc.addPage([841.89, 595.28]);
    const { width, height } = pagina.getSize();

    // Encabezado
    pagina.drawText(sanitizarParaPdfLib(`Diapositiva ${s.numero} de ${s.total}`), {
      x: 50,
      y: height - 45,
      size: 9,
      font: fontRegular,
      color: rgb(0.4, 0.45, 0.5)
    });

    const tituloLimpio = sanitizarParaPdfLib(s.titulo || `Diapositiva ${s.numero}`);
    pagina.drawText(tituloLimpio, {
      x: 50,
      y: height - 70,
      size: 18,
      font: fontBold,
      color: rgb(0.08, 0.12, 0.2)
    });

    pagina.drawLine({
      start: { x: 50, y: height - 85 },
      end: { x: width - 50, y: height - 85 },
      color: rgb(0.85, 0.88, 0.92),
      thickness: 1.2
    });

    // Puntos
    let yPos = height - 115;
    const maxPuntos = s.puntos ? s.puntos.slice(0, 15) : [];
    for (const p of maxPuntos) {
      if (yPos < 70) break;
      const textoLimpio = sanitizarParaPdfLib(p);
      const envueltas = envolverTexto(textoLimpio, 85);

      envueltas.forEach((linea, idxL) => {
        if (yPos < 70) return;
        if (idxL === 0) {
          pagina.drawText('•', {
            x: 55,
            y: yPos,
            size: 12,
            font: fontBold,
            color: rgb(0.01, 0.45, 0.75)
          });
        }
        pagina.drawText(linea, {
          x: 75,
          y: yPos,
          size: 11,
          font: fontRegular,
          color: rgb(0.15, 0.2, 0.25)
        });
        yPos -= 18;
      });
      yPos -= 6;
    }

    // Pie de página
    pagina.drawText('EncoderGoti', {
      x: 50,
      y: 30,
      size: 8,
      font: fontRegular,
      color: rgb(0.5, 0.55, 0.6)
    });
    pagina.drawText(`Página ${s.numero}`, {
      x: width - 90,
      y: 30,
      size: 8,
      font: fontRegular,
      color: rgb(0.5, 0.55, 0.6)
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
 * Convierte archivos de texto plano (.txt) a PDF con paginación, ajuste de línea y márgenes limpios
 */
export async function convertirTextoPlanoAPdf(rutaTexto) {
  const contenido = await fs.promises.readFile(rutaTexto, 'utf-8');
  const dirSalida = path.dirname(rutaTexto);
  const nombreBase = path.basename(rutaTexto, path.extname(rutaTexto));
  const rutaFinalPdf = path.join(dirSalida, `${nombreBase}_converted.pdf`);
  const lineasBrutas = contenido.split(/\r?\n/);
  return await generarPdfDesdeLineasTexto(lineasBrutas, rutaFinalPdf, nombreBase);
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

  // 0. Motor Supremo Cloud (iLovePDF API Oficial - Fidelidad 100% idéntica a Microsoft Office)
  if (CONFIGURACION.ILOVEPDF?.PUBLIC_KEY && CONFIGURACION.ILOVEPDF?.SECRET_KEY) {
    try {
      return await convertirConILovePdf({ rutaArchivo: rutaDocx, rutaSalidaPdf: rutaFinalPdf });
    } catch (errIlove) {
      console.warn('[Word] iLovePDF API falló o agotó cuota, probando motor alternativo:', errIlove.message);
    }
  }

  // 1. Motor Primario (Windows): Automatización COM de Microsoft Word oficial
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
      console.warn('[Word] Automatización COM de Word no disponible o bloqueada, probando motor alternativo:', errCom.message);
    }
  }

  // 2. Motor Primario (Linux/Docker): LibreOffice Headless
  const binarioLo = await obtenerBinarioLibreOffice();
  if (binarioLo) {
    // Directorio de perfil temporal único para evitar conflictos en entornos sin $HOME (Docker/Render)
    const loProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-profile-'));
    try {
      const urlPerfil = `file://${loProfile.replace(/\\/g, '/')}`;
      const comandoLo = `"${binarioLo}" --headless --invisible --nodefault --nofirststartwizard --nologo --norestore -env:UserInstallation=${urlPerfil} --convert-to pdf --outdir "${dirSalida}" "${rutaDocx}"`;
      await execPromesa(comandoLo, {
        timeout: 90000,
        env: { ...process.env, HOME: '/tmp', SAL_USE_VCLPLUGIN: 'gen', DISPLAY: '' }
      });

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
      console.warn('[Word] LibreOffice falló, recurriendo a Mammoth con extracción de imágenes:', errLo.message);
    } finally {
      try { fs.rmSync(loProfile, { recursive: true, force: true }); } catch (_) {}
    }
  }

  // 3. Motor Secundario: Mammoth con extracción nativa de imágenes incrustadas en Base64 + Chromium
  let htmlCuerpo = '';
  try {
    const resultadoMammoth = await mammoth.convertToHtml(
      { path: rutaDocx },
      {
        convertImage: mammoth.images.imgElement((image) => {
          return image.read('base64').then((imageBuffer) => {
            return {
              src: `data:${image.contentType};base64,${imageBuffer}`
            };
          });
        })
      }
    );
    htmlCuerpo = resultadoMammoth.value;
  } catch (errMammoth) {
    console.warn(`[Word] Mammoth falló al extraer HTML: ${errMammoth.message}`);
  }

  if (!htmlCuerpo || htmlCuerpo.trim() === '') {
    const raw = await mammoth.extractRawText({ path: rutaDocx }).catch(() => null);
    if (raw?.value) {
      htmlCuerpo = raw.value.split(/\r?\n/).filter(l => l.trim()).map(p => `<p>${escaparHtml(p)}</p>`).join('');
    } else {
      htmlCuerpo = '<p>El documento no contiene texto visible.</p>';
    }
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
          margin: 20mm 18mm 20mm 18mm;
        }
        * { box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Calibri, Arial, sans-serif;
          font-size: 11pt;
          line-height: 1.5;
          color: #1e293b;
          background: #ffffff;
          margin: 0;
          padding: 0;
        }
        h1, h2, h3, h4, h5, h6 { color: #0f172a; margin-top: 14pt; margin-bottom: 6pt; }
        p { margin-top: 0; margin-bottom: 8pt; text-align: justify; word-wrap: break-word; }
        table { border-collapse: collapse; width: 100%; margin: 12pt 0; page-break-inside: avoid; }
        th, td { border: 1px solid #94a3b8; padding: 6pt 8pt; text-align: left; font-size: 10pt; }
        th { background-color: #f1f5f9; font-weight: bold; }
        img { max-width: 100%; height: auto; display: block; margin: 12pt auto; page-break-inside: avoid; }
        ul, ol { margin-top: 0; margin-bottom: 8pt; padding-left: 20pt; }
        li { margin-bottom: 3pt; }
      </style>
    </head>
    <body>
      ${htmlCuerpo}
    </body>
    </html>
  `;

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

  // Fallback seguro con pdf-lib usando el texto estructurado extraído por Mammoth
  const raw = await mammoth.extractRawText({ path: rutaDocx }).catch(() => null);
  const lineasFallback = raw?.value
    ? raw.value.split(/\r?\n/).filter(l => l.trim())
    : ['El documento Word no contiene texto editable legible.'];
  return await generarPdfDesdeLineasTexto(lineasFallback, rutaFinalPdf, nombreBase);
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

  // 0. Motor Supremo Cloud (iLovePDF API Oficial - Fidelidad 100% idéntica a Microsoft Office)
  if (CONFIGURACION.ILOVEPDF?.PUBLIC_KEY && CONFIGURACION.ILOVEPDF?.SECRET_KEY) {
    try {
      return await convertirConILovePdf({ rutaArchivo: rutaPptx, rutaSalidaPdf: rutaFinalPdf });
    } catch (errIlove) {
      console.warn('[PowerPoint] iLovePDF API falló o agotó cuota, probando motor alternativo:', errIlove.message);
    }
  }

  // 1. Motor Primario (Windows): Automatización COM de Microsoft PowerPoint oficial
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
      console.warn('[PowerPoint] Automatización COM de PowerPoint no disponible o bloqueada, probando motor alternativo:', errCom.message);
    }
  }

  // 2. Motor Primario (Linux/Docker): LibreOffice Headless
  const binarioLo = await obtenerBinarioLibreOffice();
  if (binarioLo) {
    // Directorio de perfil temporal único para evitar conflictos en entornos sin $HOME (Docker/Render)
    const loProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-profile-'));
    try {
      const urlPerfil = `file://${loProfile.replace(/\\/g, '/')}`;
      const comandoLo = `"${binarioLo}" --headless --invisible --nodefault --nofirststartwizard --nologo --norestore -env:UserInstallation=${urlPerfil} --convert-to pdf --outdir "${dirSalida}" "${rutaPptx}"`;
      await execPromesa(comandoLo, {
        timeout: 90000,
        env: { ...process.env, HOME: '/tmp', SAL_USE_VCLPLUGIN: 'gen', DISPLAY: '' }
      });

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
      console.warn('[PowerPoint] LibreOffice falló, recurriendo a extracción OpenXML con JSZip:', errLo.message);
    } finally {
      try { fs.rmSync(loProfile, { recursive: true, force: true }); } catch (_) {}
    }
  }

  // 3. Motor Secundario: Extracción OpenXML con JSZip + Imágenes embebidas en Base64 + Chromium
  const diapositivasEstructuradas = [];

  try {
    const data = await fs.promises.readFile(rutaPptx);
    const zip = await JSZip.loadAsync(data);

    // Mapear todas las imágenes en base64
    const mapaImagenes = {};
    const mediaFiles = Object.keys(zip.files).filter(name => /^ppt\/media\//i.test(name));
    for (const mf of mediaFiles) {
      const extImg = path.extname(mf).toLowerCase().replace('.', '');
      const mimeImg = extImg === 'png' ? 'image/png' : (extImg === 'jpg' || extImg === 'jpeg' ? 'image/jpeg' : 'image/png');
      const b64 = await zip.file(mf).async('base64');
      mapaImagenes[mf] = `data:${mimeImg};base64,${b64}`;
    }

    const slideFiles = Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)[0], 10);
        const numB = parseInt(b.match(/\d+/)[0], 10);
        return numA - numB;
      });

    for (let idx = 0; idx < slideFiles.length; idx++) {
      const slidePath = slideFiles[idx];
      const xmlContenido = await zip.file(slidePath).async('string');

      // Buscar relaciones de imágenes para este slide
      const relsPath = slidePath.replace('ppt/slides/slide', 'ppt/slides/_rels/slide') + '.rels';
      const imagenesSlide = [];

      if (zip.file(relsPath)) {
        const relsXml = await zip.file(relsPath).async('string');
        const targetRegex = /Target="([^"]+\.(png|jpg|jpeg|gif|bmp))"/gi;
        let matchRel;
        while ((matchRel = targetRegex.exec(relsXml)) !== null) {
          let target = matchRel[1].replace(/^\.\.\//, 'ppt/');
          if (!target.startsWith('ppt/')) target = `ppt/${target}`;
          if (mapaImagenes[target]) {
            imagenesSlide.push(mapaImagenes[target]);
          }
        }
      }

      // Extraer párrafos <a:p>
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
        total: slideFiles.length,
        titulo,
        puntos: cuerpo,
        imagenes: imagenesSlide
      });
    }
  } catch (errZip) {
    console.warn(`[PowerPoint] Error leyendo estructura PPTX: ${errZip.message}`);
  }

  if (diapositivasEstructuradas.length === 0) {
    diapositivasEstructuradas.push({
      numero: 1,
      total: 1,
      titulo: nombreBase,
      puntos: ['Presentación convertida a formato PDF.'],
      imagenes: []
    });
  }

  // Generar HTML fiel con maquetación Landscape A4 para cada diapositiva
  const slidesHtml = diapositivasEstructuradas.map((s) => {
    return `
      <div class="slide">
        <div class="slide-header">
          <div class="slide-number">Diapositiva ${s.numero} de ${s.total}</div>
          <h2 class="slide-title">${escaparHtml(s.titulo)}</h2>
        </div>
        <div class="slide-body">
          <div class="slide-text">
            ${s.puntos.map(p => `
              <div class="bullet-item">
                <span class="bullet-symbol">•</span>
                <span class="bullet-content">${escaparHtml(p)}</span>
              </div>
            `).join('')}
          </div>
          ${s.imagenes && s.imagenes.length > 0
            ? `<div class="slide-media">
                ${s.imagenes.map(imgSrc => `<img src="${imgSrc}" class="slide-img" />`).join('')}
               </div>`
            : ''
          }
        </div>
        <div class="slide-footer">
          <span>EncoderGoti</span>
          <span>Página ${s.numero}</span>
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
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          background: #ffffff;
          color: #1e293b;
        }
        .slide {
          width: 297mm;
          height: 210mm;
          page-break-after: always;
          padding: 20mm 24mm 16mm 24mm;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          background: #ffffff;
          position: relative;
        }
        .slide-header {
          border-bottom: 2px solid #e2e8f0;
          padding-bottom: 8px;
          margin-bottom: 12px;
        }
        .slide-number {
          font-size: 10pt;
          color: #64748b;
          margin-bottom: 4px;
        }
        .slide-title {
          font-size: 22pt;
          font-weight: 700;
          color: #0f172a;
          margin: 0;
        }
        .slide-body {
          flex: 1;
          display: flex;
          gap: 20px;
          align-items: flex-start;
          overflow: hidden;
        }
        .slide-text {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .bullet-item {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 13pt;
          line-height: 1.4;
          color: #334155;
        }
        .bullet-symbol {
          font-size: 14pt;
          color: #0284c7;
        }
        .bullet-content {
          flex: 1;
        }
        .slide-media {
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-width: 40%;
          justify-content: center;
          align-items: center;
        }
        .slide-img {
          max-width: 100%;
          max-height: 120mm;
          object-fit: contain;
          border-radius: 4px;
        }
        .slide-footer {
          display: flex;
          justify-content: space-between;
          font-size: 9pt;
          color: #94a3b8;
          border-top: 1px solid #f1f5f9;
          padding-top: 6px;
        }
      </style>
    </head>
    <body>
      ${slidesHtml}
    </body>
    </html>
  `;

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

  // Fallback seguro de diapositivas limpias en A4 Landscape con pdf-lib
  return await generarPdfDiapositivasPdfLib(diapositivasEstructuradas, rutaFinalPdf, nombreBase);
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
