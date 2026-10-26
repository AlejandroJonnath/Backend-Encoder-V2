import { Router } from 'express';
import { verificarAutenticacion } from '../middlewares/auth.middleware.js';
import { descargarArchivoController } from '../controllers/descarga.controller.js';
import firmaRoutes from './firma.routes.js';
import pdfRoutes from './pdf.routes.js';
import conversionRoutes from './conversion.routes.js';
import iaRoutes from './ia.routes.js';

const router = Router();

// 1. RUTA PÚBLICA DE DESCARGA DIRECTA (Archivos generados)
router.get('/descargar/:nombreArchivo', descargarArchivoController);
// 2. MIDDLEWARE DE AUTENTICACIÓN PARA OPERACIONES PROTEGIDAS
router.use(verificarAutenticacion);
// 3. MÓDULOS DE RUTAS MODULARES
// Firma electrónica digital .p12 (FirmaEC)
router.use('/pdf', firmaRoutes);

// Operaciones generales con PDF (comprimir, unir, anotaciones)
router.use('/pdf', pdfRoutes);

// Conversiones de documentos (Word, Excel, PowerPoint, TXT, Imágenes)
router.use('/', conversionRoutes);

// Inteligencia Artificial (Groq)
router.use('/ia', iaRoutes);

export default router;
