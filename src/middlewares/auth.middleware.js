import { supabaseAdmin } from '../config/supabase.js';

export async function verificarAutenticacion(req, res, next) {
  try {
    const cabeceraAuth = req.headers.authorization;
    if (!cabeceraAuth || !cabeceraAuth.startsWith('Bearer ')) {
      // Si se desea permitir operaciones de prueba locales sin token:
      req.usuario = { id: '00000000-0000-0000-0000-000000000000', email: 'anonimo@pdfoperations.com' };
      return next();
    }

    const token = cabeceraAuth.split(' ')[1];
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        exito: false,
        mensaje: 'Sesión no válida o expirada. Por favor inicia sesión nuevamente.'
      });
    }

    req.usuario = user;
    next();
  } catch (err) {
    console.error('Error en middleware de autenticación:', err.message);
    res.status(500).json({
      exito: false,
      mensaje: 'Error interno validando autenticación.'
    });
  }
}
