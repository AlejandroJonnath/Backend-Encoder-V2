/**
 * Clase estándar para errores operacionales y HTTP de la aplicación.
 */
export class AppError extends Error {
  /**
   * @param {string} mensaje - Mensaje legible para el usuario
   * @param {number} [codigoEstado=400] - Código de estado HTTP (400, 401, 403, 404, 500)
   * @param {Object} [detalles=null] - Información complementaria opcional
   */
  constructor(mensaje, codigoEstado = 400, detalles = null) {
    super(mensaje);
    this.name = 'AppError';
    this.codigoEstado = codigoEstado;
    this.esOperacional = true;
    this.detalles = detalles;
    Error.captureStackTrace(this, this.constructor);
  }
}
