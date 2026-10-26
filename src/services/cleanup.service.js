import fs from 'fs';
import path from 'path';
import { CONFIGURACION } from '../config/constantes.js';

let intervaloId = null;

/**
 * Elimina un archivo individual de forma segura y silenciosa.
 * @param {string} ruta - Ruta absoluta del archivo
 * @returns {boolean} - true si se eliminó, false si no existía o falló
 */
export function eliminarArchivoSeguro(ruta) {
  if (!ruta) return false;
  try {
    if (fs.existsSync(ruta)) {
      const stats = fs.statSync(ruta);
      if (stats.isFile()) {
        fs.unlinkSync(ruta);
        return true;
      }
    }
  } catch (err) {
    console.error(`[Cleanup] Error eliminando archivo temporal "${path.basename(ruta)}":`, err.message);
  }
  return false;
}

/**
 * Elimina un directorio y todo su contenido de forma recursiva.
 * @param {string} rutaDirectorio - Ruta absoluta del directorio
 * @returns {boolean} - true si se eliminó, false en caso contrario
 */
export function eliminarDirectorioSeguro(rutaDirectorio) {
  if (!rutaDirectorio) return false;
  try {
    if (fs.existsSync(rutaDirectorio)) {
      const stats = fs.statSync(rutaDirectorio);
      if (stats.isDirectory()) {
        fs.rmSync(rutaDirectorio, { recursive: true, force: true });
        return true;
      }
    }
  } catch (err) {
    console.error(`[Cleanup] Error eliminando directorio temporal "${path.basename(rutaDirectorio)}":`, err.message);
  }
  return false;
}

/**
 * Escanea el directorio temporal y elimina archivos o carpetas huérfanas
 * cuya fecha de modificación supere el TTL configurado.
 * @param {Object} [opciones]
 * @param {number} [opciones.ttlMinutos] - Tiempo de vida máximo en minutos
 * @returns {number} - Cantidad de elementos eliminados
 */
export function limpiarArchivosExpirados({ ttlMinutos = CONFIGURACION.ARCHIVOS.TTL_MINUTOS } = {}) {
  const dirTemp = CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL;
  if (!fs.existsSync(dirTemp)) {
    return 0;
  }

  const ahora = Date.now();
  const limiteMs = ttlMinutos * 60 * 1000;
  let eliminados = 0;

  try {
    const entradas = fs.readdirSync(dirTemp);

    for (const entrada of entradas) {
      // Proteger archivo .gitkeep
      if (entrada === '.gitkeep') continue;

      const rutaCompleta = path.join(dirTemp, entrada);

      try {
        const stats = fs.statSync(rutaCompleta);
        const edadMs = ahora - stats.mtimeMs;

        if (edadMs > limiteMs) {
          if (stats.isDirectory()) {
            fs.rmSync(rutaCompleta, { recursive: true, force: true });
            eliminados++;
          } else {
            fs.unlinkSync(rutaCompleta);
            eliminados++;
          }
        }
      } catch (errElemento) {
        // En caso de que otro proceso haya borrado el archivo en paralelo
        continue;
      }
    }

    if (eliminados > 0) {
      console.log(`[Cleanup] Recolector de basura: Se eliminaron ${eliminados} archivos/carpetas temporales expirados (> ${ttlMinutos} min).`);
    }
  } catch (err) {
    console.error('[Cleanup] Error durante el barrido de archivos temporales:', err.message);
  }

  return eliminados;
}

/**
 * Inicia el cron / intervalo periódico de limpieza en segundo plano.
 * @param {number} intervaloMs - Frecuencia del barrido en milisegundos (por defecto 15 minutos)
 */
export function iniciarLimpiadorPeriodico(intervaloMs = 15 * 60 * 1000) {
  if (intervaloId) {
    clearInterval(intervaloId);
  }

  // Limpieza inicial al arrancar el servidor
  limpiarArchivosExpirados();

  // Programar barridos recurrentes
  intervaloId = setInterval(() => {
    limpiarArchivosExpirados();
  }, intervaloMs);

  if (intervaloId.unref) {
    intervaloId.unref(); // No impedir el apagado limpio del proceso de Node
  }

  console.log(`[Cleanup] Servicio de limpieza automática de temp_uploads activo (frecuencia: ${Math.round(intervaloMs / 60000)} min, TTL: ${CONFIGURACION.ARCHIVOS.TTL_MINUTOS} min).`);
}

/**
 * Detiene el intervalo periódico (para testing o apagado elegante).
 */
export function detenerLimpiadorPeriodico() {
  if (intervaloId) {
    clearInterval(intervaloId);
    intervaloId = null;
  }
}
