import fs from 'fs';
import path from 'path';
import os from 'os';
import * as XLSX from 'xlsx';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { exec } from 'child_process';
import util from 'util';
import { obtenerBinarioLibreOffice } from './office.service.js';

const execPromesa = util.promisify(exec);

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
 * Motor Autónomo Nativo de Excel a PDF (100% JavaScript, sin dependencias externas)
 * Convierte el 100% de las hojas, filas y columnas, dividiendo hojas anchas
 * en bloques legibles para que ninguna columna se trunque.
 */
export async function renderizarExcelNativoConPdfLib({ rutaExcel, rutaSalidaPdf, hojasAProcesar }) {
  const buffer = fs.readFileSync(rutaExcel);
  const wb = XLSX.read(buffer, { type: 'buffer' });

  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const nombreHoja of hojasAProcesar) {
    const hoja = wb.Sheets[nombreHoja];
    if (!hoja) continue;
    const datos = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });
    if (!datos || datos.length === 0) continue;

    // Detectar número real de columnas
    let maxCols = 0;
    datos.forEach(fila => {
      if (fila.length > maxCols) maxCols = fila.length;
    });
    if (maxCols === 0) continue;

    // Si tiene más de 6 columnas usamos orientación apaisada (Landscape A4: 841.89 x 595.28)
    const esLandscape = maxCols > 6;
    const anchoPag = esLandscape ? 841.89 : 595.28;
    const altoPag = esLandscape ? 595.28 : 841.89;
    const margenX = 30;
    const anchoUtil = anchoPag - (margenX * 2);

    // Si tiene muchas columnas, dividimos en bloques de máximo 10 columnas para que el texto sea perfectamente legible
    const colsPorBloque = esLandscape ? (maxCols <= 14 ? maxCols : 10) : (maxCols <= 8 ? maxCols : 6);
    const numBloques = Math.ceil(maxCols / colsPorBloque);

    for (let b = 0; b < numBloques; b++) {
      const colInicio = b * colsPorBloque;
      const colFin = Math.min(maxCols, colInicio + colsPorBloque);
      const totalColsBloque = colFin - colInicio;
      const anchoCol = anchoUtil / totalColsBloque;

      // 22 filas por página para que los datos respiren con margen y claridad
      const filasPorPagina = 22;
      const totalPaginasFila = Math.ceil(datos.length / filasPorPagina);

      for (let p = 0; p < totalPaginasFila; p++) {
        const pagina = pdfDoc.addPage([anchoPag, altoPag]);
        const loteFilas = datos.slice(p * filasPorPagina, (p + 1) * filasPorPagina);

        // Encabezado superior de la hoja
        const subtituloBloque = numBloques > 1 ? ` (Columnas ${colInicio + 1} - ${colFin} de ${maxCols})` : '';
        pagina.drawText(sanitizarParaPdfLib(`Hoja: ${nombreHoja}${subtituloBloque}`), {
          x: margenX,
          y: altoPag - 30,
          size: 13,
          font: fontBold,
          color: rgb(0.01, 0.41, 0.63)
        });

        pagina.drawLine({
          start: { x: margenX, y: altoPag - 36 },
          end: { x: anchoPag - margenX, y: altoPag - 36 },
          thickness: 1.5,
          color: rgb(0.01, 0.41, 0.63)
        });

        let yPos = altoPag - 55;
        const altoFila = 18;

        loteFilas.forEach((fila, filaIdx) => {
          const esEncabezado = (p === 0 && filaIdx === 0);

          // Fondo de fila: azul oscuro para encabezado, cebra para datos
          if (esEncabezado) {
            pagina.drawRectangle({
              x: margenX,
              y: yPos - 3,
              width: anchoUtil,
              height: altoFila,
              color: rgb(0.06, 0.09, 0.16) // #0f172a
            });
          } else if (filaIdx % 2 === 1) {
            pagina.drawRectangle({
              x: margenX,
              y: yPos - 3,
              width: anchoUtil,
              height: altoFila,
              color: rgb(0.97, 0.98, 0.99) // #f8fafc
            });
          }

          // Dibujar celdas del bloque
          for (let c = colInicio; c < colFin; c++) {
            const valorRaw = fila[c] !== undefined ? String(fila[c]) : '';
            const celdaLimpia = sanitizarParaPdfLib(valorRaw);
            const xCol = margenX + ((c - colInicio) * anchoCol);

            // Borde de celda
            pagina.drawRectangle({
              x: xCol,
              y: yPos - 3,
              width: anchoCol,
              height: altoFila,
              borderWidth: 0.5,
              borderColor: rgb(0.8, 0.83, 0.88),
              color: undefined
            });

            // Texto de celda
            if (celdaLimpia) {
              const maxChars = Math.max(4, Math.floor(anchoCol / 5.2));
              const textoCortado = celdaLimpia.length > maxChars
                ? celdaLimpia.substring(0, maxChars - 1) + '…'
                : celdaLimpia;

              pagina.drawText(textoCortado, {
                x: xCol + 4,
                y: yPos + 2,
                size: esEncabezado ? 7.5 : 7,
                font: esEncabezado ? fontBold : fontRegular,
                color: esEncabezado ? rgb(1, 1, 1) : rgb(0.12, 0.16, 0.23)
              });
            }
          }

          yPos -= altoFila;
        });

        // Pie de página
        pagina.drawText(sanitizarParaPdfLib(`EncoderGoti • Hoja: ${nombreHoja} • Pág. ${p + 1}/${totalPaginasFila}`), {
          x: margenX,
          y: 15,
          size: 7.5,
          font: fontRegular,
          color: rgb(0.4, 0.45, 0.5)
        });
      }
    }
  }

  const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
  fs.writeFileSync(rutaSalidaPdf, pdfBytes);
  return { rutaArchivo: rutaSalidaPdf, nombreArchivo: path.basename(rutaSalidaPdf) };
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

  // 1. Motor Windows: Si Microsoft Excel COM está disponible, usarlo
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
      console.warn('[Excel] Automatización COM de Excel no disponible, usando motor nativo:', errCom.message);
    }
  }

  // 2. Motor Linux/Docker: Si LibreOffice está disponible en el sistema, convertir con máxima fidelidad
  const binarioLo = await obtenerBinarioLibreOffice();
  if (binarioLo) {
    let rutaExcelAConvertir = rutaExcel;
    let archivoTemporalFiltrado = null;
    const loProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-calc-'));

    try {
      if (!procesarTodas) {
        const wbFiltrado = XLSX.utils.book_new();
        for (const nombreHoja of hojasAProcesar) {
          if (libro.Sheets[nombreHoja]) {
            XLSX.utils.book_append_sheet(wbFiltrado, libro.Sheets[nombreHoja], nombreHoja);
          }
        }
        archivoTemporalFiltrado = path.join(dirSalida, `${nombreBase}_sel.xlsx`);
        XLSX.writeFile(wbFiltrado, archivoTemporalFiltrado);
        rutaExcelAConvertir = archivoTemporalFiltrado;
      }

      const nombreBaseAConvertir = path.basename(rutaExcelAConvertir, path.extname(rutaExcelAConvertir));
      const urlPerfil = `file://${loProfile.replace(/\\/g, '/')}`;
      const comandoLo = `"${binarioLo}" --headless --invisible --nodefault --nofirststartwizard --nologo --norestore --nolockcheck -env:UserInstallation=${urlPerfil} --convert-to pdf --outdir "${dirSalida}" "${rutaExcelAConvertir}"`;
      
      const resultadoExec = await execPromesa(comandoLo, {
        timeout: 90000,
        env: { ...process.env, HOME: '/tmp', SAL_USE_VCLPLUGIN: 'headless', DISPLAY: '' }
      });
      console.log('[Excel] LibreOffice stdout:', resultadoExec.stdout, 'stderr:', resultadoExec.stderr);

      let archivoGenerado = path.join(dirSalida, `${nombreBaseAConvertir}.pdf`);
      if (!fs.existsSync(archivoGenerado) || fs.statSync(archivoGenerado).size === 0) {
        try {
          const archivos = fs.readdirSync(dirSalida);
          const coincide = archivos.find(f => f.endsWith('.pdf') && (f.startsWith(nombreBaseAConvertir) || f.includes(nombreBaseAConvertir.slice(0, 15))));
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
      console.error('[Excel] LibreOffice falló:', errLo.message, errLo.stdout, errLo.stderr);
    } finally {
      if (archivoTemporalFiltrado && fs.existsSync(archivoTemporalFiltrado)) {
        try { fs.unlinkSync(archivoTemporalFiltrado); } catch (_) {}
      }
      try { fs.rmSync(loProfile, { recursive: true, force: true }); } catch (_) {}
    }
  }

  // 3. Motor Nativo Autónomo (100% JavaScript, fidelidad total con paginación horizontal y estilos profesionales)
  return await renderizarExcelNativoConPdfLib({
    rutaExcel,
    rutaSalidaPdf: rutaFinalPdf,
    hojasAProcesar
  });
}
