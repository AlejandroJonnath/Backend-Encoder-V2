/**
 * Validador de entorno (Fail-Fast)
 * Asegura que las credenciales y rutas esenciales existan antes de que el servidor acepte tráfico.
 */
export function validarVariablesEntorno() {
  const requeridas = [
    { clave: 'SUPABASE_URL', descripcion: 'URL del proyecto Supabase' },
    { clave: 'SUPABASE_CLAVE_SERVICIO', descripcion: 'Clave service_role de Supabase para operaciones administrativas' },
    { clave: 'GROQ_CLAVE_API', descripcion: 'Clave API de Groq para servicios de IA' }
  ];

  const faltantes = [];

  for (const item of requeridas) {
    const valor = process.env[item.clave];
    if (!valor || valor.trim() === '' || valor.includes('tu_clave') || valor.includes('tu-proyecto')) {
      faltantes.push(`${item.clave} (${item.descripcion})`);
    }
  }

  if (faltantes.length > 0) {
    console.error('\n❌ ERROR CRÍTICO DE CONFIGURACIÓN DE ENTORNO:');
    console.error('Las siguientes variables de entorno obligatorias no están configuradas correctamente:');
    faltantes.forEach(f => console.error(`   - ${f}`));
    console.error('\nPor favor verifica tu archivo .env basándote en .env.example antes de iniciar el servidor.\n');
    
    // Si estamos en producción, abortar el arranque de inmediato
    if (process.env.NODE_ENV === 'production' || process.env.ENTORNO === 'produccion') {
      process.exit(1);
    }
  }
}
