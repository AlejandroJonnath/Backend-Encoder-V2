import fs from 'fs';
import path from 'path';
import forge from 'node-forge';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { P12Signer } from '@signpdf/signer-p12';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import QRCode from 'qrcode';

/**
 * Servicio de firma electrónica PAdES con certificado .p12
 * Cumple con los estándares requeridos por FirmaEC (Ecuador):
 * - Formato PDF AcroForm con campo /Sig
 * - SubFiltro adbe.pkcs7.detached
 * - Digest SHA-256
 * - ByteRange calculado correctamente
 * - Estampa visual profesional estilo FirmaEC
 */
export async function firmarDocumentoPdf({
  rutaPdf,
  rutaP12,
  contrasenaP12,
  posicion = { x: 50, y: 50, pagina: 1, ancho: 220, alto: 80 },
  razon = 'Firma Electrónica Documental'
}) {
  // ─────────────────────────────────────────────────────────────
  // 1. Validar y leer el certificado P12
  // ─────────────────────────────────────────────────────────────
  const p12Buffer = await fs.promises.readFile(rutaP12);
  if (!p12Buffer || p12Buffer.length < 50) {
    throw new Error('El archivo del certificado .p12 está incompleto o no se pudo leer correctamente.');
  }

  // Extraer datos del titular antes de la firma para la estampa visual
  const p12Der = forge.util.createBuffer(p12Buffer.toString('binary'));
  let p12Asn1;
  try {
    p12Asn1 = forge.asn1.fromDer(p12Der);
  } catch (errAsn) {
    throw new Error(`El archivo de certificado .p12 no tiene una estructura ASN.1 válida (${errAsn.message}). Verifica que el archivo no esté corrupto.`);
  }

  let p12Parsed;
  try {
    p12Parsed = forge.pkcs12.pkcs12FromAsn1(p12Asn1, contrasenaP12);
  } catch (err) {
    throw new Error('La contraseña del certificado .p12 es incorrecta o el archivo está dañado.');
  }

  // Extraer nombre del titular (CN)
  let nombreTitular = 'Titular de Firma';
  let cedulaTitular = '';
  let entidadEmisora = 'Entidad Certificadora';

  for (const safeContent of p12Parsed.safeContents) {
    for (const safeBag of safeContent.safeBags) {
      if (safeBag.cert) {
        const attrs = safeBag.cert.subject.attributes;
        const cn = attrs.find(a => a.name === 'commonName' || a.shortName === 'CN')?.value || '';
        const serialNum = attrs.find(a => a.shortName === 'serialNumber' || a.name === 'serialNumber')?.value || '';
        const issuerCN = safeBag.cert.issuer.attributes.find(a => a.shortName === 'CN' || a.name === 'commonName')?.value || '';
        
        if (cn) nombreTitular = cn;
        if (serialNum) cedulaTitular = serialNum;
        if (issuerCN) entidadEmisora = issuerCN;
        break;
      }
    }
    if (nombreTitular !== 'Titular de Firma') break;
  }

  const fechaFirma = new Date();
  const fechaStr = fechaFirma.toLocaleString('es-EC', {
    timeZone: 'America/Guayaquil',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Cargar PDF y dibujar la estampa visual profesional (estilo FirmaEC)
  // ─────────────────────────────────────────────────────────────
  const pdfBytes = await fs.promises.readFile(rutaPdf);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const paginas = pdfDoc.getPages();
  const indicePagina = Math.max(0, Math.min((posicion.pagina || 1) - 1, paginas.length - 1));
  const paginaObjetivo = paginas[indicePagina];

  const fontNormal = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const rectX = posicion.x || 50;
  const rectY = posicion.y || 50;
  // Dimensiones estándar compactas y finas (encaja exactamente en casillas de firma oficiales)
  const rectAncho = 130;
  const rectAlto = 40;

  // ── Generar Código QR Oficial de Validación (Alta definición para escaneo rápido)
  const textoQr = [
    `FIRMADO POR: ${nombreTitular}`,
    cedulaTitular ? `CI: ${cedulaTitular}` : null,
    `FECHA: ${fechaStr}`,
    `VALIDACION: www.firmadigital.gob.ec`
  ].filter(Boolean).join('\n');

  const qrBuffer = await QRCode.toBuffer(textoQr, {
    type: 'png',
    margin: 0,
    width: 200,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#09090B', // Dark Zinc
      light: '#ffffff'
    }
  });

  const qrImage = await pdfDoc.embedPng(qrBuffer);

  // ── 1. Contenedor base: blanco puro con hairline border fino (0.5 pt)
  paginaObjetivo.drawRectangle({
    x: rectX,
    y: rectY,
    width: rectAncho,
    height: rectAlto,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.89, 0.89, 0.91), // Zinc-200 (#E4E4E7)
    borderWidth: 0.5,
  });

  // ── 2. Código QR ampliado (34x34 pt) centrado verticalmente para óptima legibilidad
  const qrSize = 34;
  const qrX = rectX + 3.5;
  const qrY = rectY + (rectAlto - qrSize) / 2;

  paginaObjetivo.drawImage(qrImage, {
    x: qrX,
    y: qrY,
    width: qrSize,
    height: qrSize,
  });

  // ── 3. Divisor vertical fino (0.5 pt) entre QR y metadatos (Shadcn style)
  const sepX = qrX + qrSize + 3.5;
  paginaObjetivo.drawLine({
    start: { x: sepX, y: rectY + 3 },
    end: { x: sepX, y: rectY + rectAlto - 3 },
    color: rgb(0.89, 0.89, 0.91), // Zinc-200 (#E4E4E7)
    thickness: 0.5,
  });

  // ── 4. Columna de Metadatos con ajuste automático multilínea para nombres largos
  const textX = sepX + 4;
  const maxWidth = rectAncho - (textX - rectX) - 3;

  function dividirEnLineas(texto, font, size, maxW) {
    const palabras = (texto || '').trim().split(/\s+/);
    const resultado = [];
    let lineaActual = '';
    for (const palabra of palabras) {
      const intento = lineaActual ? `${lineaActual} ${palabra}` : palabra;
      if (font.widthOfTextAtSize(intento, size) <= maxW) {
        lineaActual = intento;
      } else {
        if (lineaActual) resultado.push(lineaActual);
        lineaActual = palabra;
      }
    }
    if (lineaActual) resultado.push(lineaActual);
    return resultado;
  }

  function obtenerLineasNombre(texto, font) {
    let size = 5.8;
    let lineas = dividirEnLineas(texto, font, size, maxWidth);
    if (lineas.length > 2) {
      size = 5.0;
      lineas = dividirEnLineas(texto, font, size, maxWidth);
    }
    if (lineas.length > 2) {
      size = 4.4;
      lineas = dividirEnLineas(texto, font, size, maxWidth);
    }
    return { lineas, size };
  }

  const { lineas: lineasNombre, size: lineSize } = obtenerLineasNombre(nombreTitular, fontBold);

  // Fila 1: Título "Firmado electrónicamente" (Acento Sky Blue de EncoderGoti)
  paginaObjetivo.drawText('Firmado electrónicamente', {
    x: textX,
    y: rectY + rectAlto - 8.5,
    size: 4.6,
    font: fontNormal,
    color: rgb(0.01, 0.52, 0.78), // #0284C7
  });

  // Fila 2: Nombre del titular (Multilínea para nombres y apellidos completos)
  if (lineasNombre.length > 1) {
    paginaObjetivo.drawText(lineasNombre[0], {
      x: textX,
      y: rectY + rectAlto - 16.5,
      size: lineSize,
      font: fontBold,
      color: rgb(0.04, 0.04, 0.05), // #09090B
    });
    paginaObjetivo.drawText(lineasNombre[1], {
      x: textX,
      y: rectY + rectAlto - 24.0,
      size: lineSize,
      font: fontBold,
      color: rgb(0.04, 0.04, 0.05), // #09090B
    });
    paginaObjetivo.drawText(cedulaTitular ? `CI: ${cedulaTitular}` : 'Firma Válida', {
      x: textX,
      y: rectY + rectAlto - 32.5,
      size: 4.8,
      font: fontNormal,
      color: rgb(0.44, 0.44, 0.48), // #71717A
    });
  } else {
    paginaObjetivo.drawText(lineasNombre[0] || nombreTitular, {
      x: textX,
      y: rectY + rectAlto - 19.0,
      size: 6.2,
      font: fontBold,
      color: rgb(0.04, 0.04, 0.05), // #09090B
    });
    paginaObjetivo.drawText(cedulaTitular ? `CI: ${cedulaTitular}` : 'Firma Válida', {
      x: textX,
      y: rectY + rectAlto - 29.0,
      size: 5.0,
      font: fontNormal,
      color: rgb(0.44, 0.44, 0.48), // #71717A
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Agregar placeholder AcroForm para firma PKCS#7 detached
  //    (ByteRange + /Contents vacío) — esto es lo que FirmaEC valida
  // ─────────────────────────────────────────────────────────────
  await pdflibAddPlaceholder({
    pdfDoc,
    reason: razon,
    contactInfo: nombreTitular,
    name: nombreTitular,
    location: 'Ecuador',
    signatureLength: 16384,  // espacio suficiente para PKCS#7 con cadena de certificados
  });

  // Serializar el PDF con la estampa y el placeholder
  const pdfConPlaceholderBytes = await pdfDoc.save({ useObjectStreams: false });

  // ─────────────────────────────────────────────────────────────
  // 4. Firmar criptográficamente el PDF con la clave del .p12
  // ─────────────────────────────────────────────────────────────
  const signer = new P12Signer(p12Buffer, { passphrase: contrasenaP12 });
  const signPdfInstance = new SignPdf();

  let pdfFirmadoBuffer;
  try {
    pdfFirmadoBuffer = await signPdfInstance.sign(Buffer.from(pdfConPlaceholderBytes), signer);
  } catch (errSign) {
    throw new Error(`Error al incrustar la firma criptográfica: ${errSign.message}`);
  }

  // ─────────────────────────────────────────────────────────────
  // 5. Guardar el PDF firmado en disco
  // ─────────────────────────────────────────────────────────────
  const dirSalida = path.dirname(rutaPdf);
  const nombreBase = path.basename(rutaPdf, path.extname(rutaPdf)).replace(/_signed$/, '');
  const rutaFinalFirmado = path.join(dirSalida, `${nombreBase}_signed.pdf`);

  await fs.promises.writeFile(rutaFinalFirmado, pdfFirmadoBuffer);

  return {
    rutaArchivo: rutaFinalFirmado,
    nombreArchivo: `${nombreBase}_signed.pdf`,
    titular: nombreTitular,
    fecha: fechaStr
  };
}
