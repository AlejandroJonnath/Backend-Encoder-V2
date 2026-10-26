import { Router } from 'express';
import { subirArchivos } from '../middlewares/upload.middleware.js';
import {
  comprimirPdfController,
  unirPdfsController,
  subirPdfParaUnirController,
  ejecutarUnirSesionController,
  agregarNotaPdfController
} from '../controllers/pdf.controller.js';

const router = Router();

// Compresión de PDF (hasta 2GB)
router.post(
  '/comprimir',
  subirArchivos.single('pdf'),
  comprimirPdfController
);

// Unión directa por array de PDFs
router.post(
  '/unir',
  subirArchivos.array('pdfs', 30),
  unirPdfsController
);

// Unión por sesión secuencial
router.post(
  '/sesion-unir/subir',
  subirArchivos.single('pdf'),
  subirPdfParaUnirController
);

router.post(
  '/sesion-unir/procesar',
  ejecutarUnirSesionController
);

// Agregar notas vectoriales al PDF
router.post(
  '/agregar-nota',
  subirArchivos.single('pdf'),
  agregarNotaPdfController
);

export default router;
