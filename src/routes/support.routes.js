import { Router } from 'express';
import { crearTicketSoporteController, obtenerMisTicketsController } from '../controllers/support.controller.js';

const router = Router();

// Crear una incidencia en modo reporte
router.post('/tickets', crearTicketSoporteController);

// Consultar incidencias creadas por el usuario autenticado
router.get('/my-tickets', obtenerMisTicketsController);

export default router;

