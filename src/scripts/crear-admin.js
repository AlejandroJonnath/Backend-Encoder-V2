import { supabaseAdmin } from '../config/supabase.js';

async function crearAdmin() {
  const email = 'alejo.admin@hotmail.com';
  const password = 'adriel';

  console.log(`[Crear Admin] Verificando usuario ${email}...`);

  try {
    // 1. Intentar crear el usuario mediante la API oficial de administración de Supabase
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: 'Alejo',
        last_name: 'Admin',
        username: 'alejo_admin',
        role: 'admin',
        is_admin: true,
      },
      app_metadata: {
        provider: 'email',
        providers: ['email'],
        role: 'admin',
        is_admin: true,
      },
    });

    if (error) {
      console.error('[Crear Admin] Error de Supabase Auth:', error.message);
      if (error.message.includes('already') || error.message.includes('Database error')) {
        console.log('\n--> Si el usuario tiene datos corruptos de un INSERT manual previo, ejecuta esto en Supabase SQL Editor:');
        console.log(`DELETE FROM public.user_consents WHERE user_id IN (SELECT id FROM auth.users WHERE email = '${email}');`);
        console.log(`DELETE FROM public.profiles WHERE email = '${email}';`);
        console.log(`DELETE FROM auth.users WHERE email = '${email}';`);
        console.log('Y luego vuelve a ejecutar este script: node src/scripts/crear-admin.js\n');
      }
      return;
    }

    const usuarioId = data.user.id;
    console.log(`[Crear Admin] Usuario Auth creado con éxito. ID: ${usuarioId}`);

    // 2. Asegurar perfil de administrador en public.profiles
    const { error: errorPerfil } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: usuarioId,
        first_name: 'Alejo',
        last_name: 'Admin',
        username: 'alejo_admin',
        email,
        role: 'admin',
        is_admin: true,
        updated_at: new Date().toISOString(),
      });

    if (errorPerfil) {
      console.warn('[Crear Admin] Aviso en profiles:', errorPerfil.message);
    } else {
      console.log('[Crear Admin] Perfil de administrador configurado.');
    }

    // 3. Pre-aprobar términos y políticas para acceso inmediato
    await supabaseAdmin
      .from('user_consents')
      .upsert({
        user_id: usuarioId,
        policy_version: '1.0.0',
        terms_version: '1.0.0',
        accepted_at: new Date().toISOString(),
      }, { onConflict: 'user_id,policy_version' });

    console.log('[Crear Admin] Términos y políticas pre-aprobados.');
    console.log('\n ¡ADMIN CREADO CON ÉXITO!');
    console.log(` Correo: ${email}`);
    console.log(` Clave:  ${password}\n`);
  } catch (err) {
    console.error('[Crear Admin] Excepción:', err.message);
  }
}

crearAdmin();

