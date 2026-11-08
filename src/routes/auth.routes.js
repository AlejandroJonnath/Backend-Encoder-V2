import { Router } from 'express';
import {
  rollbackRegistroController,
  registrarConsentimientoController,
  solicitarRecuperacionController,
  restablecerContrasenaController,
} from '../controllers/auth.controller.js';
import { verificarAutenticacion } from '../middlewares/auth.middleware.js';

const router = Router();

// Endpoint para rollback inmediato cuando el usuario rechaza las políticas y términos
router.post('/rollback-registration', verificarAutenticacion, rollbackRegistroController);

// Endpoint para registrar el consentimiento legal aceptado
router.post('/consentimiento', verificarAutenticacion, registrarConsentimientoController);

// ── Recuperación de contraseña por OTP / EmailJS (rutas públicas, sin JWT) ──
router.post('/solicitar-recuperacion', solicitarRecuperacionController);
router.post('/restablecer-contrasena', restablecerContrasenaController);

export default router;

