import { supabaseAdmin } from '../config/supabase.js';
import { groq, MODELO_GROQ_POR_DEFECTO } from '../config/groq.js';
import { CONFIGURACION } from '../config/constantes.js';

async function verificarConexiones() {

  console.log('Déjame verificar si conecta con SUPABASE Y GROQ AI...');

  // 1. Probar conexión a Supabase (tablas)
  console.log('1. Déjame verficar las tablas de Supabase...');

  try {

    const { data: perfiles, error: errorPerfiles } = await supabaseAdmin.from('profiles').select('count', { count: 'exact', head: true });
    if (errorPerfiles) {

      console.error(' No puedo acceder a la tabla de "profiles":', errorPerfiles.message);

    } else {

      console.log('Vi que existe y se puede acceder a la tabla "profiles" :) ');

    }

    const { error: errorDocs } = await supabaseAdmin.from('documents').select('count', { count: 'exact', head: true });
    if (errorDocs) {

      console.error(' No encontré la tabla "documents":', errorDocs.message);

    } else {

      console.log(' Vi que existe y se puede acceder a la tabla "documents" :) ');

    }

    const { error: errorAi } = await supabaseAdmin.from('ai_tasks').select('count', { count: 'exact', head: true });
    if (errorAi) {

      console.error(' No pude acceder a la tabla "ai_tasks":', errorAi.message);

    } else {

      console.log('Vi que existe y se puede acceder a la tabla "ai_tasks".');

    }

  } catch (err) {
    console.error('Pasó un error con Supabase :', err.message);
  }

  // 2. Probar Bucket de Storage en Supabase
  console.log('\n2. Voy a verificar el Bucket de Storage en Supabase...');

  try {

    const { data: buckets, error: errorBuckets } = await supabaseAdmin.storage.listBuckets();
    if (errorBuckets) {

      console.error(' Error listando buckets:', errorBuckets.message);

    } else {

      const existeBucket = buckets.some(b => b.name === CONFIGURACION.SUPABASE.BUCKET_DOCUMENTOS);

      if (existeBucket) {

        console.log(` Bucket "${CONFIGURACION.SUPABASE.BUCKET_DOCUMENTOS}" encontrado correctamente.`);

      } else {

        console.warn(` Bucket "${CONFIGURACION.SUPABASE.BUCKET_DOCUMENTOS}" NO encontrado en Supabase Storage.`);
        console.log(' Este bucket tiene límite de 2GB.');

      }
    }

  } catch (err) {
    console.error(' Excepción conectando a Supabase Storage:', err.message);
  }

  // 3. Probar Groq AI
  console.log('\n3. Verificando conexión y modelos de chat en Groq AI...');

  try {
    const listaModelos = await groq.models.list();
    // Filtrar modelos diseñados para chat/completions (descartar whisper y prompt-guard)
    const modelosChat = listaModelos.data.map(m => m.id).filter(id => !id.includes('whisper') && !id.includes('guard'));

    console.log('Modelos de generación de texto disponibles:');
    modelosChat.forEach(m => console.log(`   - ${m}`));

    // Probar candidatos de alta capacidad que no requieren aceptación previa de términos
    const candidatos = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'allam-2-7b'].filter(m => modelosChat.includes(m));

    let modeloExitoso = null;
    let respuestaExitosa = null;

    for (const candidato of candidatos) {

      process.stdout.write(`Probando inferencia con "${candidato}"... `);

      try {

        const respuesta = await groq.chat.completions.create({
          model: candidato, messages: [

            { role: 'system', content: 'Eres un asistente técnico.' },

            { role: 'user', content: 'Responde únicamente con la palabra: CONECTADO' }

          ], max_tokens: 10
        });

        const texto = respuesta.choices[0]?.message?.content?.trim();
        if (texto) {
          console.log(`¡ÉXITO! Respuesta: "${texto}"`);
          modeloExitoso = candidato;
          respuestaExitosa = texto;
          break;
        }
      } catch (err) {
        console.log(` (${err.status || err.message})`);
      }
    }

    if (modeloExitoso) {
      console.log(`\n Modelo seleccionado y validado para tu proyecto: "${modeloExitoso}"`);
    } else {
      console.warn(' Ninguno de los modelos candidatos directos pudo inferir.');
    }
  } catch (err) {
    console.error(' Error conectando con Groq AI:', err.message);
  }


  console.log('Acabe con la prueba jiji :)');

}

verificarConexiones();
