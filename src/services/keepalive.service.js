import { CONFIGURACION } from '../config/constantes.js';
import { supabaseAdmin } from '../config/supabase.js';

let intervaloRender = null;
let intervaloSupabase = null;

/**
 * 1. Ping ultra ligero a Supabase para evitar que pause el proyecto por inactividad de 7 días.
 * Ejecuta una consulta HEAD (sin transferencia de filas ni consumo de memoria).
 */
export async function mantenerSupabaseDespierto() {
  if (!CONFIGURACION.SUPABASE.URL || !CONFIGURACION.SUPABASE.CLAVE_SERVICIO) {
    return false;
  }

  try {
    // Consulta HEAD ultraligera: no transfiere filas, solo verifica conexión con el motor Postgres
    const { error } = await supabaseAdmin
      .from('operaciones_documentos')
      .select('id', { count: 'exact', head: true });

    if (!error) {
      console.log(`[KeepAlive] Supabase ping exitoso (${new Date().toLocaleTimeString('es-EC')}) - Inactividad reiniciada.`);
      return true;
    } else {
      // Fallback a getSession si la tabla aún no tiene filas o permisos
      await supabaseAdmin.auth.getSession();
      console.log(`[KeepAlive] Supabase auth ping exitoso (${new Date().toLocaleTimeString('es-EC')}).`);
      return true;
    }
  } catch (err) {
    console.warn('[KeepAlive] Advertencia en ping de Supabase:', err.message);
    return false;
  }
}

/**
 * 2. Ping ultra ligero a Render para evitar la suspensión por inactividad tras 15 minutos.
 * Utiliza RENDER_EXTERNAL_URL proporcionado automáticamente por Render o la URL pública configurada.
 */
export async function mantenerRenderDespierto() {
  const urlPublica = process.env.RENDER_EXTERNAL_URL ||
    process.env.URL_BACKEND_PUBLICO ||
    process.env.URL_RENDER;

  if (!urlPublica) {
    return false;
  }

  const endpointSalud = `${urlPublica.replace(/\/+$/, '')}/salud`;

  try {
    const controlador = new AbortController();
    const timeout = setTimeout(() => controlador.abort(), 10000);

    const respuesta = await fetch(endpointSalud, {
      method: 'GET',
      headers: { 'User-Agent': 'EncoderGoti-KeepAlive/1.0' },
      signal: controlador.signal
    });

    clearTimeout(timeout);

    if (respuesta.ok) {
      console.log(`[KeepAlive] Render ping exitoso a ${endpointSalud} (${new Date().toLocaleTimeString('es-EC')}) - Servicio activo.`);
      return true;
    }
  } catch (err) {
    console.warn('[KeepAlive] Advertencia en ping de Render:', err.message);
  }

  return false;
}

/**
 * Inicializa los temporizadores periódicos en segundo plano:
 * - Render: Cada 13 minutos (límite de suspensión es 15 min)
 * - Supabase: Cada 12 horas (límite de pausa es 7 días)
 */
export function iniciarServicioKeepAlive() {
  // Limpieza defensiva de intervalos previos
  detenerServicioKeepAlive();

  console.log('[KeepAlive] Servicio de mantenimiento activo iniciado.');

  // Ejecución inmediata al arrancar el servidor
  mantenerSupabaseDespierto().catch(() => {});
  mantenerRenderDespierto().catch(() => {});

  // 1. Temporizador Render: cada 13 minutos (780,000 ms)
  intervaloRender = setInterval(() => {
    mantenerRenderDespierto().catch(() => {});
  }, 13 * 60 * 1000);

  if (intervaloRender.unref) {
    intervaloRender.unref();
  }

  // 2. Temporizador Supabase: cada 12 horas (43,200,000 ms)
  intervaloSupabase = setInterval(() => {
    mantenerSupabaseDespierto().catch(() => {});
  }, 12 * 60 * 60 * 1000);

  if (intervaloSupabase.unref) {
    intervaloSupabase.unref();
  }
}

/**
 * Detiene los intervalos periódicos (para testing o apagado elegante del servidor)
 */
export function detenerServicioKeepAlive() {
  if (intervaloRender) {
    clearInterval(intervaloRender);
    intervaloRender = null;
  }
  if (intervaloSupabase) {
    clearInterval(intervaloSupabase);
    intervaloSupabase = null;
  }
}

