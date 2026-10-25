import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

export const CONFIGURACION = {
  PUERTO: process.env.PUERTO || 3000,
  ENTORNO: process.env.ENTORNO || 'desarrollo',
  URL_FRONTEND: process.env.URL_FRONTEND || 'http://localhost:8081',

  SUPABASE: {
    URL: process.env.SUPABASE_URL,
    CLAVE_ANONIMA: process.env.SUPABASE_CLAVE_ANONIMA,
    CLAVE_SERVICIO: process.env.SUPABASE_CLAVE_SERVICIO,
    BUCKET_DOCUMENTOS: process.env.SUPABASE_BUCKET_DOCUMENTOS || 'pdf_vault',
  },

  GROQ: {
    CLAVE_API: process.env.GROQ_CLAVE_API,
    MODELO: process.env.GROQ_MODELO || 'llama-3.3-70b-versatile',
  },

  ARCHIVOS: {
    RUTA_TEMPORAL: path.resolve(process.env.RUTA_ARCHIVOS_TEMPORALES || './temp_uploads'),
    LIMITE_TAMANIO_BYTES: parseInt(process.env.LIMITE_TAMANIO_ARCHIVO_BYTES || '2147483648', 10), // 2GB
  },

  IDIOMAS_TRADUCCION_PERMITIDOS: [
    'Español',
    'Inglés',
    'Francés',
    'Alemán',
    'Chino Mandarín'
  ],

  TIPOS_OPERACION: {
    CONVERTIR: 'convert',
    FIRMAR: 'sign',
    COMPRIMIR: 'compress',
    UNIR: 'merge',
    AGREGAR_NOTA: 'addnote',
    IA_RESUMEN: 'ai_summary',
    IA_TRADUCIR: 'ai_translate'
  }
};
