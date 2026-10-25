import { Router } from 'express';
import { subirArchivos } from '../middlewares/upload.middleware.js';
import { verificarAutenticacion } from '../middlewares/auth.middleware.js';
import {
  subirCertificadoP12Controller,
  firmarPdfController,
  comprimirPdfController,
  unirPdfsController,
  subirPdfParaUnirController,
  ejecutarUnirSesionController,
  agregarNotaPdfController,
  inspeccionarExcelController,
  procesarExcelAPdfController,
  convertirWordController,
  convertirPowerPointController,
  convertirTxtController,
  convertirImagenController,
  descargarArchivoController,
  resumirPdfIaController,
  traducirPdfIaController
} from '../controllers/operaciones.controller.js';

const router = Router();

// Ruta pública de descarga directa de archivos generados
router.get('/descargar/:nombreArchivo', descargarArchivoController);

// Aplicar middleware de autenticación a las operaciones
router.use(verificarAutenticacion);

// 1. Firma Electrónica con .p12 (FirmaEC) - Soporta pdf + p12 (archivo, token o base64)
router.post(
  '/pdf/subir-p12',
  subirArchivos.single('p12'),
  subirCertificadoP12Controller
);

router.post(
  '/pdf/firmar',
  subirArchivos.fields([
    { name: 'pdf', maxCount: 1 },
    { name: 'p12', maxCount: 1 }
  ]),
  firmarPdfController
);

// 2. Compresión de PDF (Hasta 2GB)
router.post(
  '/pdf/comprimir',
  subirArchivos.single('pdf'),
  comprimirPdfController
);

// 3. Unir múltiples PDFs
router.post(
  '/pdf/unir',
  subirArchivos.array('pdfs', 30),
  unirPdfsController
);

router.post(
  '/pdf/sesion-unir/subir',
  subirArchivos.single('pdf'),
  subirPdfParaUnirController
);

router.post(
  '/pdf/sesion-unir/procesar',
  ejecutarUnirSesionController
);

// 4. Agregar notas a PDF
router.post(
  '/pdf/agregar-nota',
  subirArchivos.single('pdf'),
  agregarNotaPdfController
);

// 5. Inspección y conversión de Excel por hojas
router.post(
  '/excel/inspeccionar',
  subirArchivos.single('excel'),
  inspeccionarExcelController
);

router.post(
  '/excel/procesar-pdf',
  procesarExcelAPdfController
);

// 6. Herramientas de conversión separadas
router.post(
  '/convertir/word',
  subirArchivos.single('archivo'),
  convertirWordController
);

router.post(
  '/convertir/powerpoint',
  subirArchivos.single('archivo'),
  convertirPowerPointController
);

router.post(
  '/convertir/txt',
  subirArchivos.single('archivo'),
  convertirTxtController
);

router.post(
  '/convertir/imagen',
  subirArchivos.single('archivo'),
  convertirImagenController
);

// 7. Inteligencia Artificial (Groq)
router.post(
  '/ia/resumir',
  subirArchivos.single('pdf'),
  resumirPdfIaController
);

router.post(
  '/ia/traducir',
  subirArchivos.single('pdf'),
  traducirPdfIaController
);

export default router;
