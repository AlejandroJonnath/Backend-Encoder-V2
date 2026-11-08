import { Router } from 'express';
import { verificarAutenticacion } from '../middlewares/auth.middleware.js';
import { descargarArchivoController } from '../controllers/descarga.controller.js';
import firmaRoutes from './firma.routes.js';
import pdfRoutes from './pdf.routes.js';
import conversionRoutes from './conversion.routes.js';
import iaRoutes from './ia.routes.js';
import authRoutes from './auth.routes.js';
import supportRoutes from './support.routes.js';
import userRoutes from './user.routes.js';
import adminRoutes from './admin.routes.js';

const router = Router();

// 1. RUTAS PÚBLICAS (Descarga de archivos y recuperación de contraseñas)
router.get('/descargar/:nombreArchivo', descargarArchivoController);
router.use('/auth', authRoutes);

// 2. MIDDLEWARE DE AUTENTICACIÓN PARA OPERACIONES PROTEGIDAS
router.use(verificarAutenticacion);

// 3. MÓDULOS DE RUTAS PROTEGIDAS
// Sistema de Soporte e Incidencias (Modo Reporte)
router.use('/support', supportRoutes);

// Gestión de Datos, Backups y Eliminación de Cuenta
router.use('/user', userRoutes);

// Panel de Administrador, Estadísticas y Monitorización
router.use('/admin', adminRoutes);

// Firma electrónica digital .p12 (FirmaEC)
router.use('/pdf', firmaRoutes);

// Operaciones generales con PDF (comprimir, unir, anotaciones)
router.use('/pdf', pdfRoutes);

// Conversiones de documentos (Word, Excel, PowerPoint, TXT, Imágenes)
router.use('/', conversionRoutes);

// Inteligencia Artificial (Groq)
router.use('/ia', iaRoutes);

export default router;
