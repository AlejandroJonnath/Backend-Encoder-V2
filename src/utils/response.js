import path from 'path';

/**
 * Responde con un archivo físico o un JSON estructurado con la URL de descarga,
 * garantizando 100% de compatibilidad con Expo FileSystem y navegadores web.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} rutaArchivo - Ruta física en disco del archivo procesado
 * @param {string} nombreArchivoDescarga - Nombre sugerido al descargar
 * @param {Object} [extras={}] - Propiedades adicionales para la respuesta JSON
 */
export function responderArchivoOJson(req, res, rutaArchivo, nombreArchivoDescarga, extras = {}) {
  const host = req.get('host') || 'localhost:3000';
  const protocolo = req.protocol || 'http';
  const nombreFisico = path.basename(rutaArchivo);
  const descargaUrl = `${protocolo}://${host}/api/descargar/${nombreFisico}?nombre=${encodeURIComponent(nombreArchivoDescarga)}`;

  const quiereJson = req.headers['x-retorno-json'] === 'true' ||
    req.headers['accept']?.includes('application/json');

  if (quiereJson) {
    return res.json({
      exito: true,
      nombreArchivo: nombreArchivoDescarga,
      descargaUrl,
      ...extras
    });
  }

  return res.download(rutaArchivo, nombreArchivoDescarga);
}

/**
 * Respuesta JSON exitosa unificada.
 * @param {import('express').Response} res
 * @param {Object} datos - Carga útil de la respuesta
 * @param {number} [codigoEstado=200]
 */
export function responderExito(res, datos = {}, codigoEstado = 200) {
  return res.status(codigoEstado).json({
    exito: true,
    ...datos
  });
}
