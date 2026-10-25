import fs from 'fs';
import path from 'path';
import forge from 'node-forge';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { P12Signer } from '@signpdf/signer-p12';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SignPdf } from '@signpdf/signpdf';

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
  const p12Buffer = fs.readFileSync(rutaP12);
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
  const pdfBytes = fs.readFileSync(rutaPdf);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const paginas = pdfDoc.getPages();
  const indicePagina = Math.max(0, Math.min((posicion.pagina || 1) - 1, paginas.length - 1));
  const paginaObjetivo = paginas[indicePagina];

  const fontNormal = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const rectX = posicion.x || 50;
  const rectY = posicion.y || 50;
  const rectAncho = posicion.ancho || 220;
  const rectAlto = posicion.alto || 80;

  // ── Fondo exterior con sombra suave (rectángulo ligeramente mayor)
  paginaObjetivo.drawRectangle({
    x: rectX - 1,
    y: rectY - 1,
    width: rectAncho + 2,
    height: rectAlto + 2,
    color: rgb(0.80, 0.88, 0.98),
    borderWidth: 0,
  });

  // ── Fondo principal blanco
  paginaObjetivo.drawRectangle({
    x: rectX,
    y: rectY,
    width: rectAncho,
    height: rectAlto,
    color: rgb(0.97, 0.98, 1.0),
    borderColor: rgb(0.08, 0.28, 0.60),
    borderWidth: 1.8,
  });

  // ── Banda de color superior (azul FirmaEC)
  paginaObjetivo.drawRectangle({
    x: rectX,
    y: rectY + rectAlto - 16,
    width: rectAncho,
    height: 16,
    color: rgb(0.08, 0.28, 0.60),
    borderWidth: 0,
  });

  // ── Título en la banda superior
  paginaObjetivo.drawText('FIRMADO DIGITALMENTE', {
    x: rectX + 6,
    y: rectY + rectAlto - 12,
    size: 7.5,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  // ── Ícono de verificación [OK]
  paginaObjetivo.drawText('[OK]', {
    x: rectX + rectAncho - 24,
    y: rectY + rectAlto - 13,
    size: 7,
    font: fontBold,
    color: rgb(0.15, 0.75, 0.30),
  });

  // ── Nombre del firmante (limitado a 34 chars)
  const nombreCorto = nombreTitular.length > 34 ? nombreTitular.substring(0, 33) + '…' : nombreTitular;
  paginaObjetivo.drawText(nombreCorto, {
    x: rectX + 6,
    y: rectY + rectAlto - 28,
    size: 8.5,
    font: fontBold,
    color: rgb(0.05, 0.15, 0.40),
  });

  // ── CI / RUC si está disponible
  if (cedulaTitular) {
    paginaObjetivo.drawText(`CI/RUC: ${cedulaTitular}`, {
      x: rectX + 6,
      y: rectY + rectAlto - 40,
      size: 7,
      font: fontNormal,
      color: rgb(0.25, 0.25, 0.35),
    });
  }

  // ── Fecha de firma
  paginaObjetivo.drawText(`Fecha: ${fechaStr}`, {
    x: rectX + 6,
    y: rectY + rectAlto - (cedulaTitular ? 52 : 42),
    size: 6.8,
    font: fontNormal,
    color: rgb(0.25, 0.25, 0.35),
  });

  // ── Razón
  const razonCorta = razon.length > 32 ? razon.substring(0, 31) + '…' : razon;
  paginaObjetivo.drawText(`Razón: ${razonCorta}`, {
    x: rectX + 6,
    y: rectY + rectAlto - (cedulaTitular ? 63 : 53),
    size: 6.5,
    font: fontNormal,
    color: rgb(0.25, 0.25, 0.35),
  });

  // ── Línea separadora inferior
  paginaObjetivo.drawLine({
    start: { x: rectX + 4, y: rectY + 10 },
    end: { x: rectX + rectAncho - 4, y: rectY + 10 },
    color: rgb(0.08, 0.28, 0.60),
    thickness: 0.5,
    opacity: 0.4,
  });

  // ── Emisor / validación
  const emisorCorto = entidadEmisora.length > 40 ? entidadEmisora.substring(0, 39) + '…' : entidadEmisora;
  paginaObjetivo.drawText(emisorCorto, {
    x: rectX + 6,
    y: rectY + 4,
    size: 5.5,
    font: fontNormal,
    color: rgb(0.15, 0.45, 0.20),
  });

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

  fs.writeFileSync(rutaFinalFirmado, pdfFirmadoBuffer);

  return {
    rutaArchivo: rutaFinalFirmado,
    nombreArchivo: `${nombreBase}_signed.pdf`,
    titular: nombreTitular,
    fecha: fechaStr
  };
}
