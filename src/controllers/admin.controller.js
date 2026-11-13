import os from 'os';
import fs from 'fs';
import { supabaseAdmin } from '../config/supabase.js';
import { CONFIGURACION } from '../config/constantes.js';
import { responderExito } from '../utils/response.js';
import { ticketsRespaldoLocal } from './support.controller.js';

// Registro circular en memoria de errores para monitorización y alertas
const historialErrores = [];
const LIMITE_HISTORIAL_ERRORES = 100;

/**
 * Registra un error en el monitor de telemetría de fallos.
 * @param {Object} infoError
 */
export function registrarErrorMonitor({ ruta, metodo, status, mensaje, stack, usuarioId }) {
  const registro = {
    id: Date.now(),
    fecha: new Date().toISOString(),
    ruta,
    metodo,
    status: status || 500,
    mensaje: mensaje || 'Error desconocido',
    stack: process.env.NODE_ENV === 'production' ? undefined : stack,
    usuarioId: usuarioId || null
  };

  historialErrores.unshift(registro);
  if (historialErrores.length > LIMITE_HISTORIAL_ERRORES) {
    historialErrores.pop();
  }

  // Disparador de alerta si se detectan múltiples errores 500 seguidos en los últimos 5 minutos
  const hace5Min = Date.now() - 5 * 60 * 1000;
  const erroresRecientes500 = historialErrores.filter(e => e.status >= 500 && e.id >= hace5Min);
  if (erroresRecientes500.length >= 3) {
    console.error(`\x1b[41m\x1b[37m[ALERTA CRÍTICA]\x1b[0m Se han registrado ${erroresRecientes500.length} errores HTTP 500 en los últimos 5 minutos! Revisa la estabilidad del servicio.`);
  }
}

/**
 * Estadísticas necesarias para que el administrador entienda qué aplicación o herramienta se usa más y cuál no.
 */
export async function obtenerEstadisticasUsoController(req, res, next) {
  try {
    let docs = [];

    // 1. Intentar consultar tabla documents de Supabase
    try {
      const { data, error } = await supabaseAdmin.from('documents').select('operation, created_at, original_size_bytes, result_size_bytes');
      if (!error && data) {
        docs = data;
      }
    } catch (_) {}

    // Desglose de operaciones
    const operaciones = {
      sign: 0,
      compress: 0,
      convert_word: 0,
      convert_excel: 0,
      convert_image: 0,
      convert_txt: 0,
      merge: 0,
      addnote: 0,
      ai_summary: 0,
      ai_translate: 0
    };

    // Mapeo amigable de nombres
    const nombresHerramientas = {
      sign: 'Firma Digital PAdES / FirmaEC',
      compress: 'Compresión Inteligente PDF',
      convert_word: 'Conversión Word a PDF',
      convert_excel: 'Conversión Excel a PDF',
      convert_image: 'Conversión Imagen a PDF',
      convert_txt: 'Conversión Texto a PDF',
      merge: 'Unir / Combinar PDFs',
      addnote: 'Agregar Notas al PDF',
      ai_summary: 'Resumen con IA (Groq)',
      ai_translate: 'Traducción con IA (Groq)'
    };

    // Si hay datos en BD los contabilizamos
    docs.forEach(d => {
      const op = d.operation;
      if (operaciones[op] !== undefined) {
        operaciones[op]++;
      } else if (op === 'convert') {
        operaciones.convert_word++;
      }
    });

    // Ordenar herramientas por frecuencia de uso (de mayor a menor)
    const rankingHerramientas = Object.entries(operaciones)
      .map(([clave, total]) => ({
        id: clave,
        nombre: nombresHerramientas[clave] || clave,
        totalUsos: total
      }))
      .sort((a, b) => b.totalUsos - a.totalUsos);

    const masUsada = rankingHerramientas[0];
    const menosUsada = rankingHerramientas[rankingHerramientas.length - 1];

    // Estadísticas de soporte
    let totalTickets = ticketsRespaldoLocal.length;
    let ticketsAbiertos = ticketsRespaldoLocal.filter(t => t.status === 'abierto').length;

    try {
      const { count } = await supabaseAdmin.from('support_tickets').select('*', { count: 'exact', head: true });
      if (typeof count === 'number') totalTickets = count;
      const { count: countAbiertos } = await supabaseAdmin.from('support_tickets').select('*', { count: 'exact', head: true }).eq('status', 'abierto');
      if (typeof countAbiertos === 'number') ticketsAbiertos = countAbiertos;
    } catch (_) {}

    return responderExito(res, {
      resumen: {
        totalOperaciones: docs.length,
        herramientaMasUsada: masUsada,
        herramientaMenosUsada: menosUsada,
        totalTicketsReportados: totalTickets,
        ticketsPendientes: ticketsAbiertos
      },
      rankingHerramientas,
      distribucionOperaciones: operaciones,
      fechaConsulta: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Listar reportes de soporte para que los administradores los revisen.
 */
export async function listarReportesAdminController(req, res, next) {
  try {
    const { estado, severidad } = req.query || {};

    let reportes = [];
    try {
      let query = supabaseAdmin.from('support_tickets').select('*').order('created_at', { ascending: false });
      if (estado) query = query.eq('status', estado);
      if (severidad) query = query.eq('severity', severidad);

      const { data, error } = await query;
      if (!error && data) {
        reportes = data;
      }
    } catch (_) {}

    if (reportes.length === 0) {
      reportes = ticketsRespaldoLocal;
      if (estado) reportes = reportes.filter(r => r.status === estado);
      if (severidad) reportes = reportes.filter(r => r.severity === severidad);
    }

    return responderExito(res, {
      reportes,
      total: reportes.length
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Actualizar el estado y notas de respuesta de un reporte.
 */
export async function actualizarReporteAdminController(req, res, next) {
  try {
    const { id } = req.params;
    const { status, estado, adminResponse } = req.body || {};

    let estadoFinal = estado || status || 'Pendiente';
    if (estadoFinal === 'abierto') estadoFinal = 'Pendiente';
    if (estadoFinal === 'en_revision') estadoFinal = 'En proceso';
    if (estadoFinal === 'resuelto') estadoFinal = 'Solucionado';

    const actualizacion = {
      status: estadoFinal,
      admin_response: adminResponse || null,
      updated_at: new Date().toISOString()
    };

    if (estadoFinal === 'Solucionado' || estadoFinal === 'resuelto') {
      actualizacion.resolved_at = new Date().toISOString();
    }

    try {
      await supabaseAdmin.from('support_tickets').update(actualizacion).eq('id', id);
    } catch (_) {}

    // Actualizar también en respaldo local si aplica
    const tLocal = ticketsRespaldoLocal.find(t => t.id === id);
    if (tLocal) {
      Object.assign(tLocal, actualizacion);
    }

    return responderExito(res, {
      mensaje: `Reporte clasificado correctamente como "${estadoFinal}".`,
      ticketActualizado: actualizacion
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Monitorización de errores, caídas y salud del sistema post-lanzamiento.
 */
export async function obtenerMonitoreoSaludController(req, res, next) {
  try {
    const memoriaTotalMb = Math.round(os.totalmem() / 1024 / 1024);
    const memoriaLibreMb = Math.round(os.freemem() / 1024 / 1024);
    const memoriaProcesoMb = Math.round(process.memoryUsage().rss / 1024 / 1024);

    let archivosTemporalesCount = 0;
    try {
      if (fs.existsSync(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL)) {
        archivosTemporalesCount = fs.readdirSync(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL).length;
      }
    } catch (_) {}

    // Verificar latencia y conectividad con Supabase
    let supabaseOk = false;
    let latenciaSupabaseMs = null;
    const inicioSupabase = Date.now();
    try {
      const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
      latenciaSupabaseMs = Date.now() - inicioSupabase;
      supabaseOk = !error;
    } catch (_) {}

    // Resumen de errores recientes
    const hace1Hora = Date.now() - 60 * 60 * 1000;
    const erroresUltimaHora = historialErrores.filter(e => e.id >= hace1Hora);
    const caidasCriticas = erroresUltimaHora.filter(e => e.status >= 500);

    return responderExito(res, {
      estadoSistema: caidasCriticas.length > 5 ? 'degradado' : 'saludable',
      uptimeSegundos: Math.round(process.uptime()),
      metricasServidor: {
        memoriaTotalMb,
        memoriaLibreMb,
        memoriaProcesoMb,
        archivosTemporalesEnDisco: archivosTemporalesCount,
        limiteArchivoBytes: CONFIGURACION.ARCHIVOS.LIMITE_BYTES
      },
      conectividad: {
        supabase: { conectado: supabaseOk, latenciaMs: latenciaSupabaseMs },
        groqModelo: CONFIGURACION.GROQ.MODELO
      },
      monitorErrores: {
        erroresUltimaHora: erroresUltimaHora.length,
        caidasCriticas5xx: caidasCriticas.length,
        ultimosErrores: historialErrores.slice(0, 10)
      },
      fecha: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
}

