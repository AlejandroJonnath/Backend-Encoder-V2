import { Router } from 'express';
import { subirArchivos } from '../middlewares/upload.middleware.js';
import {
  inspeccionarExcelController,
  procesarExcelAPdfController,
  convertirWordController,
  convertirPowerPointController,
  convertirTxtController,
  convertirImagenController
} from '../controllers/conversion.controller.js';

const router = Router();

// Inspección y procesamiento de hojas de cálculo Excel
router.post(
  '/excel/inspeccionar',
  subirArchivos.single('excel'),
  inspeccionarExcelController
);

router.post(
  '/excel/procesar-pdf',
  procesarExcelAPdfController
);

// Conversiones de documentos a PDF
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

export default router;
