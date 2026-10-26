import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { AppError } from './appError.js';

// Extensiones estrictamente prohibidas para descarga directa por seguridad
const EXTENSIONES_PROHIBIDAS_DESCARGA = [
  '.p12', '.pfx', '.pem', '.key', '.crt', '.cer',
  '.env', '.config', '.json', '.js', '.mjs', '.sh',
  '.bat', '.exe', '.cmd', '.ps1'
];

/**
 * Genera un nombre de archivo único, seguro e impredecible en disco
 * @param {string} nombreOriginal
 * @returns {string}
 */
export function generarNombreArchivoSeguro(nombreOriginal = 'archivo.bin') {
  const extension = path.extname(nombreOriginal).toLowerCase().slice(0, 10);
  const extensionSegura = extension.replace(/[^a-z0-9.]/g, '') || '.tmp';
  const uuid = crypto.randomUUID();
  return `${Date.now()}_${uuid}${extensionSegura}`;
}

/**
 * Resuelve y valida una ruta de archivo para descargas seguras,
 * mitigando Directory Traversal (LFI) y protegiendo certificados y secretos.
 *
 * @param {string} nombreArchivo
 * @param {string} rutaBasePermitida
 * @returns {string} - Ruta absoluta segura
 */
export function sanearRutaDescarga(nombreArchivo, rutaBasePermitida) {
  if (!nombreArchivo || typeof nombreArchivo !== 'string') {
    throw new AppError('Nombre de archivo inválido.', 400);
  }

  // Prevenir inyección de rutas (LFI / Path Traversal)
  const nombreLimpio = path.basename(nombreArchivo);
  if (nombreLimpio !== nombreArchivo || nombreArchivo.includes('..') || nombreArchivo.includes('/') || nombreArchivo.includes('\\')) {
    throw new AppError('Acceso denegado: Ruta de archivo no permitida.', 403);
  }

  // Bloquear archivos ocultos y extensiones sensibles (ej. certificados o código)
  const extension = path.extname(nombreLimpio).toLowerCase();
  if (nombreLimpio.startsWith('.') || EXTENSIONES_PROHIBIDAS_DESCARGA.includes(extension)) {
    throw new AppError('Acceso denegado: Tipo de archivo restringido.', 403);
  }

  const rutaAbsoluta = path.resolve(rutaBasePermitida, nombreLimpio);
  const rutaBaseNormalizada = path.resolve(rutaBasePermitida);

  // Garantizar que la ruta resuelta está estrictamente dentro del directorio base
  if (!rutaAbsoluta.startsWith(rutaBaseNormalizada)) {
    throw new AppError('Acceso denegado: Intento de escape de directorio detectado.', 403);
  }

  return rutaAbsoluta;
}

/**
 * Verifica si un archivo cumple con las extensiones y tipos esperados
 * Permisivo con application/octet-stream si la extensión coincide (por compatibilidad con Expo Android).
 */
export function esFormatoValido(archivo, extensionesValidas = [], mimetypesValidos = []) {
  if (!archivo) return false;

  const ext = path.extname(archivo.originalname || archivo.filename || '').toLowerCase();
  const mime = (archivo.mimetype || '').toLowerCase();
  const esOctetStream = mime === 'application/octet-stream';

  const extensionCoincide = extensionesValidas.map(e => e.toLowerCase()).includes(ext);
  const mimeCoincide = mimetypesValidos.some(m => mime.includes(m.toLowerCase()));

  return extensionCoincide || mimeCoincide || (esOctetStream && extensionCoincide);
}
