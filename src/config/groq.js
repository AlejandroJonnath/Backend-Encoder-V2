import Groq from 'groq-sdk';
import { CONFIGURACION } from './constantes.js';

if (!CONFIGURACION.GROQ.CLAVE_API) {
  console.warn('ADVERTENCIA: GROQ_CLAVE_API no está definida en el archivo .env');
}

export const groq = new Groq({
  apiKey: CONFIGURACION.GROQ.CLAVE_API
});

export const MODELO_GROQ_POR_DEFECTO = CONFIGURACION.GROQ.MODELO;
