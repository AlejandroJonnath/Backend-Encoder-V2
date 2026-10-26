import { Router } from 'express';
import { subirArchivos } from '../middlewares/upload.middleware.js';
import { subirCertificadoP12Controller, firmarPdfController } from '../controllers/firma.controller.js';

const router = Router();

// Subir certificado .p12 temporal
router.post('/subir-p12', subirArchivos.single('p12'), subirCertificadoP12Controller);
// Firmar digitalmente con PAdES / FirmaEC
router.post('/firmar', subirArchivos.fields([{ name: 'pdf', maxCount: 1 }, { name: 'p12', maxCount: 1 }]), firmarPdfController);

export default router;
