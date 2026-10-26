import { supabaseAdmin } from '../config/supabase.js';
import { CONFIGURACION } from '../config/constantes.js';

/**
 * Middleware estricto para validar el token JWT de sesión de Supabase.
 */
export async function verificarAutenticacion(req, res, next) {
  try {
    const cabeceraAuth = req.headers.authorization;

    if (!cabeceraAuth || !cabeceraAuth.startsWith('Bearer ')) {
      // Permitir bypass anónimo ÚNICAMENTE si está activado explícitamente en variables de entorno (para pruebas locales)
      if (CONFIGURACION.SEGURIDAD.PERMITIR_ACCESO_ANONIMO) {
        req.usuario = {
          id: '00000000-0000-0000-0000-000000000000',
          email: 'anonimo@pdfoperations.com',
          user_metadata: { first_name: 'Usuario Anónimo' }
        };
        return next();
      }

      return res.status(401).json({
        exito: false,
        codigoEstado: 401,
        mensaje: 'Acceso no autorizado: Debes iniciar sesión para realizar esta operación.'
      });
    }

    const token = cabeceraAuth.split(' ')[1];
    if (!token || token.trim() === '') {
      return res.status(401).json({
        exito: false,
        codigoEstado: 401,
        mensaje: 'Token de autenticación no proporcionado o inválido.'
      });
    }

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        exito: false,
        codigoEstado: 401,
        mensaje: 'Tu sesión ha expirado o no es válida. Por favor, inicia sesión nuevamente.'
      });
    }

    req.usuario = user;
    next();
  } catch (err) {
    console.error('[Auth] Error validando autenticación en middleware:', err.message);
    res.status(500).json({
      exito: false,
      codigoEstado: 500,
      mensaje: 'Error interno verificando la autenticación del usuario.'
    });
  }
}
