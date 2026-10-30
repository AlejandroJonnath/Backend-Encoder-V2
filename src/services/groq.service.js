import fs from 'fs';
import pdfParse from 'pdf-parse';
import { groq, MODELO_GROQ_POR_DEFECTO } from '../config/groq.js';
import { CONFIGURACION } from '../config/constantes.js';

// Modelos ordenados por prioridad y capacidad de tokens por minuto (OTPM)
const MODELOS_FALLBACK = Array.from(new Set([
  MODELO_GROQ_POR_DEFECTO,
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant'
])).filter(Boolean);

/**
 * Ejecuta una llamada a Groq con tolerancia a fallos y rotación automática de modelos
 * si el modelo configurado (ej. Qwen) excede el límite estricto de OTPM (1000 tokens/min).
 */
async function invocarGroqConFallback({ messages, temperature = 0.2, maxTokens = 850 }) {
  let ultimoError = null;

  for (let i = 0; i < MODELOS_FALLBACK.length; i++) {
    const modeloActual = MODELOS_FALLBACK[i];
    try {
      // Ajustar max_tokens si el modelo es Qwen en capa gratuita (límite OTPM de 1000)
      const tokensAjustados = (modeloActual.includes('qwen') && maxTokens > 850)
        ? 850
        : maxTokens;

      const respuesta = await groq.chat.completions.create({
        model: modeloActual,
        messages,
        temperature,
        max_tokens: tokensAjustados
      });

      return {
        contenido: respuesta.choices[0]?.message?.content?.trim(),
        modeloUtilizado: modeloActual,
        tokensUsados: respuesta.usage
      };
    } catch (err) {
      ultimoError = err;
      const esErrorLimite = err.status === 429 ||
        err.message?.includes('rate_limit') ||
        err.message?.includes('tokens') ||
        err.message?.includes('OTPM') ||
        err.message?.includes('Limit 1000');

      if (esErrorLimite && i < MODELOS_FALLBACK.length - 1) {
        console.warn(`[Groq AI] Modelo ${modeloActual} alcanzó límite de tasa/tokens. Alternando a ${MODELOS_FALLBACK[i + 1]}...`);
        continue;
      }
      throw err;
    }
  }

  throw ultimoError || new Error('No se pudo procesar la solicitud con los modelos disponibles.');
}

/**
 * Extrae texto de un archivo PDF
 */
export async function extraerTextoDePdf(rutaPdf) {
  const dataBuffer = await fs.promises.readFile(rutaPdf);
  const data = await pdfParse(dataBuffer);
  return {
    texto: data.text,
    totalPaginas: data.numpages,
    info: data.info
  };
}

/**
 * Genera un resumen dinámico, estructurado y de alto impacto con Groq AI
 */
export async function generarResumenPdf({ rutaPdf, textoDirecto = null }) {
  let textoDocumento = textoDirecto;
  if (!textoDocumento && rutaPdf) {
    const extraccion = await extraerTextoDePdf(rutaPdf);
    textoDocumento = extraccion.texto;
  }

  if (!textoDocumento || textoDocumento.trim().length === 0) {
    throw new Error('No se pudo extraer texto legible del documento para resumir.');
  }

  // Si el texto es masivo, recortar al contexto de tokens más relevante
  const textoProcesar = textoDocumento.substring(0, 15000);

  const promptSistema = `
Eres un analista experto con comprensión lectora de alto nivel. Tu objetivo es entender a fondo el documento y redactar un resumen impecable, claro, conciso y de alto valor informativo.

DIRECTRICES DEL RESUMEN:
1. Encabezado: Titula el inicio únicamente como "# Resumen" (NUNCA uses "Resumen Ejecutivo" ni "Síntesis Ejecutiva").
2. Claridad y Concisión: Explica directamente qué es el documento, su propósito medular y su contexto en 1 o 2 párrafos concisos.
3. Puntos y Hallazgos Clave: Presenta los datos, ideas centrales, cifras o acuerdos esenciales en viñetas claras con subtítulos en negrita.
4. Conclusiones o Acciones: Cierra con las conclusiones finales o pasos a seguir si el texto los contiene.

REGLAS DE ORO:
- Sé directo, inteligente y conciso. Cero texto de relleno o introducciones como "A continuación presento".
- Preserva datos clave, porcentajes, nombres, fechas y terminología técnica exacta.
`;

  const { contenido, modeloUtilizado, tokensUsados } = await invocarGroqConFallback({
    messages: [
      { role: 'system', content: promptSistema },
      { role: 'user', content: `Resume de forma clara y concisa el siguiente documento:\n\n${textoProcesar}` }
    ],
    temperature: 0.25,
    maxTokens: 800
  });

  return {
    resumen: contenido,
    modeloUtilizado,
    tokensUsados
  };
}

/**
 * Traduce el documento PDF con máxima fidelidad entre idioma nativo/origen e idioma destino
 */
export async function traducirDocumentoPdf({ rutaPdf, idiomaOrigen = 'Detección automática', idiomaDestino, textoDirecto = null }) {
  if (!CONFIGURACION.IDIOMAS_TRADUCCION_PERMITIDOS.includes(idiomaDestino)) {
    throw new Error(`Idioma destino no permitido. Solo se aceptan: ${CONFIGURACION.IDIOMAS_TRADUCCION_PERMITIDOS.join(', ')}`);
  }

  let textoDocumento = textoDirecto;
  if (!textoDocumento && rutaPdf) {
    const extraccion = await extraerTextoDePdf(rutaPdf);
    textoDocumento = extraccion.texto;
  }

  if (!textoDocumento || textoDocumento.trim().length === 0) {
    throw new Error('No se pudo extraer texto legible del documento para traducir.');
  }

  const textoProcesar = textoDocumento.substring(0, 12000);

  const promptSistema = `
Eres un traductor profesional y diplomático de alta precisión lingüística. 
Tu misión es traducir el documento del idioma nativo/origen ("${idiomaOrigen}") al idioma destino ("${idiomaDestino}").

REGLAS DE MÁXIMA EXACTITUD:
1. Fidelidad absoluta: Traduce exactamente lo que dice el texto original, preservando el significado, el tono, las intenciones y el registro formal.
2. Cero ambigüedad: Ten en cuenta el idioma nativo de origen ("${idiomaOrigen}") para interpretar giros idiomáticos o modismos correctamente hacia el "${idiomaDestino}".
3. Cero añadiduras ni omisiones: No inventes, no omitas cláusulas ni agregues explicaciones externas.
4. Preservación técnica y numérica: Conserva fechas, números, códigos, acrónimos y nombres propios con rigurosa precisión.
5. Salida limpia: Responde ÚNICAMENTE con el texto traducido. Está terminantemente prohibido agregar comentarios como "Aquí está la traducción:".
`;

  const { contenido, modeloUtilizado, tokensUsados } = await invocarGroqConFallback({
    messages: [
      { role: 'system', content: promptSistema },
      { role: 'user', content: `Traduce textualmente del ${idiomaOrigen} al ${idiomaDestino}:\n\n${textoProcesar}` }
    ],
    temperature: 0.1,
    maxTokens: 1500
  });

  return {
    traduccion: contenido,
    idiomaOrigen,
    idiomaDestino,
    modeloUtilizado,
    tokensUsados
  };
}
