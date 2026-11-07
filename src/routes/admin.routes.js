import { Router } from 'express';
import {
  obtenerEstadisticasUsoController,
  listarReportesAdminController,
  actualizarReporteAdminController,
  obtenerMonitoreoSaludController
} from '../controllers/admin.controller.js';

const router = Router();

// Estadísticas de herramientas más usadas y menos usadas
router.get('/estadisticas', obtenerEstadisticasUsoController);

// Verificación y listado de reportes de incidencias
router.get('/reportes', listarReportesAdminController);
router.patch('/reportes/:id', actualizarReporteAdminController);

// Monitorización de errores, caídas y salud del sistema
router.get('/monitoreo', obtenerMonitoreoSaludController);

export default router;

