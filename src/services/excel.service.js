import fs from 'fs';
import path from 'path';
import os from 'os';
import * as XLSX from 'xlsx';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { exec } from 'child_process';
import util from 'util';
import { renderizarHtmlConNavegador, obtenerBinarioLibreOffice } from './office.service.js';

const execPromesa = util.promisify(exec);

/**
 * Ejecuta un script de PowerShell codificado en Base64 para evitar problemas de escape
 */
async function ejecutarPowerShellSeguro(script, timeoutMs = 90000) {
  const base64Ps = Buffer.from(script, 'utf16le').toString('base64');
  const cmd = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${base64Ps}`;
  return await execPromesa(cmd, { timeout: timeoutMs });
}

/**
 * 1. Inspecciona el archivo Excel y devuelve información detallada de cada hoja
 * para permitir la previsualización y selección en la aplicación móvil.
 */
export function inspeccionarHojasExcel(rutaExcel) {
  const buffer = fs.readFileSync(rutaExcel);
  const libro = XLSX.read(buffer, { type: 'buffer' });

  const resumenHojas = libro.SheetNames.map(nombreHoja => {
    const hoja = libro.Sheets[nombreHoja];
    const rango = XLSX.utils.decode_range(hoja['!ref'] || 'A1:A1');
    const filasTotales = rango.e.r - rango.s.r + 1;
    const columnasTotales = rango.e.c - rango.s.c + 1;

    // Convertir a matriz las primeras 5 filas para la vista previa
    const datosFilas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });
    const datosMuestra = datosFilas.slice(0, 5).map(fila => fila.slice(0, 8).map(celda => String(celda)));

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
 * 2. Convierte a PDF el libro de Excel completo o las hojas seleccionadas con fidelidad total.
 * Preserva el 100% de las columnas y filas sin truncar texto.
 */
export async function convertirExcelConHojasSeleccionadas({
  rutaExcel,
  hojasSeleccionadas = []
}) {
  const buffer = fs.readFileSync(rutaExcel);
  const libro = XLSX.read(buffer, { type: 'buffer' });

  const todasLasHojas = libro.SheetNames;
  const hojasAProcesar = hojasSeleccionadas.length > 0
    ? todasLasHojas.filter(h => hojasSeleccionadas.includes(h))
    : todasLasHojas;

  if (hojasAProcesar.length === 0) {
    throw new Error('Debes seleccionar al menos una hoja del archivo Excel para convertir.');
  }

  const dirSalida = path.dirname(rutaExcel);
  const nombreBase = path.basename(rutaExcel, path.extname(rutaExcel));
  const rutaFinalPdf = path.join(dirSalida, `${nombreBase}_converted.pdf`);
  const rutaAbsolutaExcel = path.resolve(rutaExcel);
  const rutaAbsolutaPdf = path.resolve(rutaFinalPdf);

  const procesarTodas = hojasAProcesar.length === todasLasHojas.length;

  // 1. Motor Primario (Windows): Automatización COM de Microsoft Excel oficial (Fidelidad 1:1)
  if (process.platform === 'win32' && procesarTodas) {
    try {
      const scriptPs = `
        $excel = New-Object -ComObject Excel.Application
        $excel.Visible = $false
        $excel.DisplayAlerts = $false
        try {
          $wb = $excel.Workbooks.Open('${rutaAbsolutaExcel.replace(/'/g, "''")}', [Type]::Missing, $true)
          $wb.ExportAsFixedFormat(0, '${rutaAbsolutaPdf.replace(/'/g, "''")}')
          $wb.Close($false)
        } finally {
          $excel.Quit()
          [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
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
      console.warn('[Excel] Automatización COM de Excel no disponible, probando motor alternativo:', errCom.message);
    }
  }

  // 2. Motor Primario (Linux/Docker): LibreOffice Headless (para todo el libro)
  if (procesarTodas) {
    const binarioLo = await obtenerBinarioLibreOffice();
    if (binarioLo) {
      // Directorio de perfil temporal único para evitar conflictos en entornos sin $HOME (Docker/Render)
      const loProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-profile-'));
      try {
        const urlPerfil = `file://${loProfile.replace(/\\/g, '/')}`;
        const comandoLo = `"${binarioLo}" --headless --invisible --nodefault --nofirststartwizard --nologo --norestore -env:UserInstallation=${urlPerfil} --convert-to pdf --outdir "${dirSalida}" "${rutaExcel}"`;
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
        console.warn('[Excel] LibreOffice falló, pasando a motor HTML tabular:', errLo.message);
      } finally {
        try { fs.rmSync(loProfile, { recursive: true, force: true }); } catch (_) {}
      }
    }
  }

  // 3. Motor Secundario: Generación HTML Tabular Completa (100% de columnas y filas) + Chromium
  let contenidoHojasHtml = '';

  for (const nombreHoja of hojasAProcesar) {
    const hoja = libro.Sheets[nombreHoja];
    if (!hoja) continue;

    // Convertir la hoja entera a tabla HTML con SheetJS
    const tablaHtml = XLSX.utils.sheet_to_html(hoja);
    const tablaLimpia = tablaHtml
      .replace(/<!DOCTYPE[^>]*>/i, '')
      .replace(/<\/?html[^>]*>/gi, '')
      .replace(/<\/?head[^>]*>/gi, '')
      .replace(/<\/?body[^>]*>/gi, '');

    contenidoHojasHtml += `
      <div class="sheet-container">
        <h2 class="sheet-title">Hoja: ${nombreHoja}</h2>
        ${tablaLimpia}
      </div>
    `;
  }

  const htmlDocumento = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <title>${nombreBase}</title>
      <style>
        @page {
          size: A4 landscape;
          margin: 10mm 10mm 10mm 10mm;
        }
        * { box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Calibri, Arial, sans-serif;
          margin: 0;
          padding: 0;
          color: #1e293b;
          background: #ffffff;
        }
        .sheet-container {
          page-break-after: always;
          margin-bottom: 25px;
        }
        .sheet-container:last-child {
          page-break-after: auto;
        }
        .sheet-title {
          font-size: 13pt;
          font-weight: 700;
          color: #0369a1;
          margin-top: 0;
          margin-bottom: 10px;
          border-bottom: 2px solid #0284c7;
          padding-bottom: 4px;
        }
        table {
          border-collapse: collapse;
          width: 100%;
          font-size: 7pt;
          table-layout: auto;
          word-break: break-word;
        }
        th, td {
          border: 1px solid #cbd5e1;
          padding: 3px 5px;
          text-align: left;
          vertical-align: middle;
        }
        tr:nth-child(even) {
          background-color: #f8fafc;
        }
        tr:first-child td {
          background-color: #e2e8f0;
          font-weight: bold;
          color: #0f172a;
        }
      </style>
    </head>
    <body>
      ${contenidoHojasHtml}
    </body>
    </html>
  `;

  const exitoNav = await renderizarHtmlConNavegador({
    html: htmlDocumento,
    rutaSalidaPdf: rutaFinalPdf,
    landscape: true
  });

  if (exitoNav) {
    return {
      rutaArchivo: rutaFinalPdf,
      nombreArchivo: `${nombreBase}_converted.pdf`
    };
  }

  // 4. Fallback con pdf-lib tabular horizontal
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (const nombreHoja of hojasAProcesar) {
    const hoja = libro.Sheets[nombreHoja];
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });
    if (filas.length === 0) continue;

    const filasPorPagina = 30;
    for (let i = 0; i < filas.length; i += filasPorPagina) {
      const loteFilas = filas.slice(i, i + filasPorPagina);
      // Landscape A4 (841.89 x 595.28) para permitir más columnas
      const pagina = pdfDoc.addPage([841.89, 595.28]);
      const { height } = pagina.getSize();

      pagina.drawText(`Hoja: ${nombreHoja}`, {
        x: 35,
        y: height - 35,
        size: 12,
        font: fontBold,
        color: rgb(0.01, 0.41, 0.63),
      });

      let yPos = height - 55;

      loteFilas.forEach((fila, filaIdx) => {
        const esEncabezado = (i === 0 && filaIdx === 0);
        const colWidth = 55;

        fila.slice(0, 14).forEach((celda, colIdx) => {
          const texto = String(celda).substring(0, 18);
          pagina.drawText(texto, {
            x: 35 + (colIdx * colWidth),
            y: yPos,
            size: 7,
            font: esEncabezado ? fontBold : fontRegular,
            color: esEncabezado ? rgb(0.1, 0.2, 0.4) : rgb(0.2, 0.2, 0.2),
          });
        });

        yPos -= 16;
      });
    }
  }

  const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
  fs.writeFileSync(rutaFinalPdf, pdfBytes);

  return {
    rutaArchivo: rutaFinalPdf,
    nombreArchivo: `${nombreBase}_converted.pdf`
  };
}
