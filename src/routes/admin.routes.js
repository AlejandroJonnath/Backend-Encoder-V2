import { Router } from 'express';
import {
  obtenerEstadisticasUsoController,
  listarReportesAdminController,
  actualizarReporteAdminController,
  obtenerMonitoreoSaludController
} from '../controllers/admin.controller.js';
import { verificarAutenticacion, verificarRolAdmin } from '../middlewares/auth.middleware.js';

const router = Router();

// Todas las rutas de administración requieren autenticación Y rol de administrador
router.use(verificarAutenticacion, verificarRolAdmin);

// Estadísticas de herramientas más usadas y menos usadas
router.get('/estadisticas', obtenerEstadisticasUsoController);

// Verificación y listado de reportes de incidencias
router.get('/reportes', listarReportesAdminController);
router.patch('/reportes/:id', actualizarReporteAdminController);

// Monitorización de errores, caídas y salud del sistema
router.get('/monitoreo', obtenerMonitoreoSaludController);

export default router;

