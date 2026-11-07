import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/appError.js';
import { responderExito } from '../utils/response.js';
import crypto from 'crypto';

// Almacén en memoria volátil de respaldo para tickets de soporte
const ticketsRespaldoLocal = [];

/**
 * Crea un ticket de incidencia en modo reporte.
 */
export async function crearTicketSoporteController(req, res, next) {
  try {
    const usuario = req.usuario;
    const {
      categoria = 'otro',
      severidad = 'media',
      titulo,
      descripcion,
      deviceInfo = {}
    } = req.body || {};

    if (!titulo || typeof titulo !== 'string' || titulo.trim().length < 3) {
      throw new AppError('El título del reporte es obligatorio y debe tener al menos 3 caracteres.', 400);
    }

    if (!descripcion || typeof descripcion !== 'string' || descripcion.trim().length < 10) {
      throw new AppError('La descripción del reporte debe tener al menos 10 caracteres explicando el problema.', 400);
    }

    const ticketId = crypto.randomUUID();
    const numeroTicket = Math.floor(100000 + Math.random() * 900000);
    const ahora = new Date().toISOString();

    const nuevoTicket = {
      id: ticketId,
      ticket_number: numeroTicket,
      user_id: usuario?.id || null,
      user_email: usuario?.email || 'anonimo@soporte.com',
      category: categoria,
      severity: severidad,
      title: titulo.trim(),
      description: descripcion.trim(),
      device_info: deviceInfo,
      status: 'abierto',
      admin_response: null,
      created_at: ahora,
      updated_at: ahora
    };

    let persistidoEnBd = false;

    // Intentar persistir en Supabase public.support_tickets
    try {
      const { data, error } = await supabaseAdmin
        .from('support_tickets')
        .insert([nuevoTicket])
        .select()
        .single();

      if (!error && data) {
        persistidoEnBd = true;
      } else {
        console.warn('[Soporte] Aviso al insertar en support_tickets de Supabase:', error?.message);
      }
    } catch (dbErr) {
      console.warn('[Soporte] Error de conexión con tabla support_tickets:', dbErr.message);
    }

    // Guardar en respaldo local si no se pudo en BD
    ticketsRespaldoLocal.unshift(nuevoTicket);

    console.log(`[Soporte] Nuevo ticket #${numeroTicket} [${severidad.toUpperCase()}] "${titulo.substring(0, 30)}..." creado por ${usuario?.email}`);

    return responderExito(res, {
      mensaje: 'Tu reporte de incidencia ha sido recibido correctamente por nuestro equipo de soporte.',
      ticket: {
        id: ticketId,
        numero: numeroTicket,
        titulo: nuevoTicket.title,
        categoria: nuevoTicket.category,
        severidad: nuevoTicket.severity,
        estado: nuevoTicket.status,
        fecha: ahora,
        persistidoEnBd
      }
    }, 201);
  } catch (err) {
    next(err);
  }
}

/**
 * Obtiene los tickets de soporte reportados por el usuario autenticado.
 */
export async function obtenerMisTicketsController(req, res, next) {
  try {
    const usuarioId = req.usuario?.id;
    if (!usuarioId) {
      throw new AppError('Usuario no autenticado.', 401);
    }

    let tickets = [];

    try {
      const { data, error } = await supabaseAdmin
        .from('support_tickets')
        .select('*')
        .eq('user_id', usuarioId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        tickets = data;
      }
    } catch (dbErr) {
      console.warn('[Soporte] Usando tickets de respaldo local:', dbErr.message);
    }

    if (tickets.length === 0) {
      tickets = ticketsRespaldoLocal.filter(t => t.user_id === usuarioId);
    }

    return responderExito(res, {
      tickets,
      total: tickets.length
    });
  } catch (err) {
    next(err);
  }
}

export { ticketsRespaldoLocal };

