import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIGURACION } from '../config/constantes.js';

/**
 * Genera un token JWT firmado para la API de iLovePDF según la documentación oficial
 */
function generarTokenJwtILovePdf(publicKey, secretKey) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    jti: publicKey,
    iss: 'api.ilovepdf.com',
    iat: Math.floor(Date.now() / 1000)
  };

  const base64Url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const encodedHeader = base64Url(header);
  const encodedPayload = base64Url(payload);

  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Convierte cualquier documento Office (Word, PowerPoint, Excel) a PDF
 * utilizando la API oficial de iLovePDF con 100% de fidelidad tipográfica,
 * imágenes, tablas y maquetación idéntica a Microsoft Office.
 *
 * @param {Object} params
 * @param {string} params.rutaArchivo - Ruta absoluta del archivo local en disco
 * @param {string} [params.rutaSalidaPdf] - Ruta de destino para el PDF generado
 * @returns {Promise<{ rutaArchivo: string, nombreArchivo: string }>}
 */
export async function convertirConILovePdf({ rutaArchivo, rutaSalidaPdf = null }) {
  const publicKey = CONFIGURACION.ILOVEPDF?.PUBLIC_KEY || process.env.ILOVEPDF_PUBLIC_KEY;
  const secretKey = CONFIGURACION.ILOVEPDF?.SECRET_KEY || process.env.ILOVEPDF_SECRET_KEY;

  if (!publicKey || !secretKey) {
    throw new Error('Credenciales de iLovePDF API no configuradas (ILOVEPDF_PUBLIC_KEY o ILOVEPDF_SECRET_KEY faltante).');
  }

  const dirSalida = path.dirname(rutaArchivo);
  const nombreOriginal = path.basename(rutaArchivo);
  const extension = path.extname(rutaArchivo);
  const nombreBase = path.basename(rutaArchivo, extension);
  const rutaDestinoPdf = rutaSalidaPdf || path.join(dirSalida, `${nombreBase}_converted.pdf`);

  const token = generarTokenJwtILovePdf(publicKey, secretKey);

  // 1. Start: Inicializar la tarea de conversión officepdf
  const startRes = await fetch('https://api.ilovepdf.com/v1/start/officepdf', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!startRes.ok) {
    const errorBody = await startRes.text().catch(() => '');
    throw new Error(`iLovePDF Start falló (${startRes.status}): ${errorBody}`);
  }

  const { server, task } = await startRes.json();
  if (!server || !task) {
    throw new Error('iLovePDF no devolvió servidor o identificador de tarea válido.');
  }

  // 2. Upload: Subir el archivo al servidor regional asignado
  const fileBuffer = await fs.promises.readFile(rutaArchivo);
  const blob = new Blob([fileBuffer]);
  const formData = new FormData();
  formData.append('task', task);
  formData.append('file', blob, nombreOriginal);

  const uploadRes = await fetch(`https://${server}/v1/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  if (!uploadRes.ok) {
    const errorUpload = await uploadRes.text().catch(() => '');
    throw new Error(`iLovePDF Upload falló (${uploadRes.status}): ${errorUpload}`);
  }

  const { server_filename: serverFilename } = await uploadRes.json();
  if (!serverFilename) {
    throw new Error('iLovePDF no confirmó la recepción del archivo subido.');
  }

  // 3. Process: Ejecutar la conversión de Office a PDF
  const processRes = await fetch(`https://${server}/v1/process`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      task,
      tool: 'officepdf',
      files: [
        {
          server_filename: serverFilename,
          filename: nombreOriginal
        }
      ]
    })
  });

  if (!processRes.ok) {
    const errorProcess = await processRes.text().catch(() => '');
    throw new Error(`iLovePDF Process falló (${processRes.status}): ${errorProcess}`);
  }

  // 4. Download: Descargar el archivo PDF final
  const downloadRes = await fetch(`https://${server}/v1/download/${task}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!downloadRes.ok) {
    const errorDownload = await downloadRes.text().catch(() => '');
    throw new Error(`iLovePDF Download falló (${downloadRes.status}): ${errorDownload}`);
  }

  const arrayBuffer = await downloadRes.arrayBuffer();
  await fs.promises.writeFile(rutaDestinoPdf, Buffer.from(arrayBuffer));

  if (!fs.existsSync(rutaDestinoPdf) || fs.statSync(rutaDestinoPdf).size === 0) {
    throw new Error('El PDF resultante de iLovePDF está vacío o no se guardó correctamente.');
  }

  return {
    rutaArchivo: rutaDestinoPdf,
    nombreArchivo: `${nombreBase}_converted.pdf`
  };
}

