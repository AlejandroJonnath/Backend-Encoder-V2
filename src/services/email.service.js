import { CONFIGURACION } from '../config/constantes.js';

/**
 * Envía un correo de recuperación de contraseña con un código OTP de 6 dígitos
 * usando la API REST de EmailJS (el private key nunca sale al cliente móvil).
 *
 * @param {string} destinatario  - Correo destino del usuario
 * @param {string} otpCodigo     - Código numérico de 6 dígitos
 * @returns {Promise<void>}
 */
export async function enviarCorreoRecuperacion(destinatario, otpCodigo) {
  const { SERVICE_ID, TEMPLATE_ID, PUBLIC_KEY, PRIVATE_KEY, API_URL } = CONFIGURACION.EMAILJS;

  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY || !PRIVATE_KEY) {
    throw new Error('Configuración de EmailJS incompleta. Revisa las variables de entorno.');
  }

  const payload = {
    service_id: SERVICE_ID,
    template_id: TEMPLATE_ID,
    user_id: PUBLIC_KEY,
    accessToken: PRIVATE_KEY,
    template_params: {
      to_email: destinatario,
      otp_code: otpCodigo,
      expire_time: `${CONFIGURACION.RECUPERACION.OTP_EXPIRA_MINUTOS} minutos`,
      app_name: 'EncoderGoti',
    },
  };

  const respuesta = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://dashboard.emailjs.com',
    },
    body: JSON.stringify(payload),
  });

  if (!respuesta.ok) {
    const cuerpo = await respuesta.text();
    throw new Error(`EmailJS respondió con error ${respuesta.status}: ${cuerpo}`);
  }
}

