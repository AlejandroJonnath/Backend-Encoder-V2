import { createClient } from '@supabase/supabase-js';
import { CONFIGURACION } from './constantes.js';

if (!CONFIGURACION.SUPABASE.URL || !CONFIGURACION.SUPABASE.CLAVE_SERVICIO) {
  console.warn('ADVERTENCIA: SUPABASE_URL o SUPABASE_CLAVE_SERVICIO no están definidas en el archivo .env');
}

// Cliente con permisos de administración (Service Role) para el backend
export const supabaseAdmin = createClient(
  CONFIGURACION.SUPABASE.URL,
  CONFIGURACION.SUPABASE.CLAVE_SERVICIO,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Cliente con permisos anónimos (si fuera necesario simular peticiones con RLS)
export const supabaseAnonimo = createClient(
  CONFIGURACION.SUPABASE.URL,
  CONFIGURACION.SUPABASE.CLAVE_ANONIMA
);
