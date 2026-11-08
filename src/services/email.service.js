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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!respuesta.ok) {
    const cuerpo = await respuesta.text();
    throw new Error(`EmailJS respondió con error ${respuesta.status}: ${cuerpo}`);
  }
}

