import { supabaseAdmin } from '../config/supabase.js';

/**
 * Registra una operación de documento en la base de datos Supabase
 */
export async function registrarOperacionDocumento({
  userId,
  nombreOriginal,
  nombreResultado,
  operacion,
  tamanioOriginal = 0,
  tamanioResultado = 0,
  rutaStorage = 'local',
  metadatos = {}
}) {
  try {
    if (!userId || userId === '00000000-0000-0000-0000-000000000000') {
      return null;
    }

    const { data, error } = await supabaseAdmin.from('documents').insert({
      user_id: userId,
      original_name: nombreOriginal,
      result_name: nombreResultado,
      operation: operacion,
      original_size_bytes: tamanioOriginal || 0,
      result_size_bytes: tamanioResultado || 0,
      storage_path: rutaStorage || 'local',
      metadata: metadatos
    }).select().single();

    if (error) {
      console.error('[Auditoría] Error registrando en Supabase "documents":', error.message);
    }
    return data;
  } catch (err) {
    console.error('[Auditoría] Excepción registrando documento:', err.message);
    return null;
  }
}

/**
 * Registra una tarea de Inteligencia Artificial en Supabase
 */
export async function registrarTareaIA({
  userId,
  taskType,
  targetLanguage = null,
  outputContent,
  promptTokens = 0,
  completionTokens = 0
}) {
  try {
    if (!userId || userId === '00000000-0000-0000-0000-000000000000') {
      return null;
    }

    const payload = {
      user_id: userId,
      task_type: taskType,
      output_content: outputContent,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens
    };

    if (targetLanguage) {
      payload.target_language = targetLanguage;
    }

    const { data, error } = await supabaseAdmin.from('ai_tasks').insert(payload).select().single();

    if (error) {
      console.error('[Auditoría] Error registrando en Supabase "ai_tasks":', error.message);
    }
    return data;
  } catch (err) {
    console.error('[Auditoría] Excepción registrando tarea de IA:', err.message);
    return null;
  }
}
