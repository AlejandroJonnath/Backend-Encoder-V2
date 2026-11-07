import { Router } from 'express';
import { rollbackRegistroController, registrarConsentimientoController } from '../controllers/auth.controller.js';

const router = Router();

// Endpoint para rollback inmediato cuando el usuario rechaza las políticas y términos
router.post('/rollback-registration', rollbackRegistroController);

// Endpoint para registrar el consentimiento legal aceptado
router.post('/consentimiento', registrarConsentimientoController);

export default router;

