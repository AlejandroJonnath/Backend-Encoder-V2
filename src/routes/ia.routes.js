import { Router } from 'express';
import { subirArchivos } from '../middlewares/upload.middleware.js';
import {
  resumirPdfIaController,
  traducirPdfIaController
} from '../controllers/ia.controller.js';

const router = Router();

// Resumen ejecutivo de PDF con Groq AI
router.post(
  '/resumir',
  subirArchivos.single('pdf'),
  resumirPdfIaController
);

// Traducción de contenido de PDF con Groq AI
router.post(
  '/traducir',
  subirArchivos.single('pdf'),
  traducirPdfIaController
);

export default router;
