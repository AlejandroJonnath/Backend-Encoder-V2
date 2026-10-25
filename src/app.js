import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { CONFIGURACION } from './config/constantes.js';
import rutasApi from './routes/api.routes.js';

const app = express();

// Asegurar que exista la carpeta temporal para streaming
if (!fs.existsSync(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL)) {
  fs.mkdirSync(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, { recursive: true });
}

// Middlewares de seguridad y utilidad
app.use(helmet({
  crossOriginResourcePolicy: false,
}));
app.use(cors({
  origin: '*', // Permitir peticiones desde Expo Go / Web
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: '*'
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware para normalizar parámetros recibidos vía Query o Headers
// (evita el error nativo "parameters doesn't exist" en Expo uploadAsync)
app.use((req, res, next) => {
  if (req.headers['x-parametros']) {
    try {
      const extra = JSON.parse(req.headers['x-parametros']);
      req.body = { ...extra, ...req.body };
    } catch (_) {}
  }
  if (req.headers['x-p12-base64']) {
    req.body = req.body || {};
    req.body.p12Base64 = req.headers['x-p12-base64'];
  }
  if (req.query && Object.keys(req.query).length > 0) {
    req.body = { ...req.query, ...req.body };
  }

  next();
});

// Ruta de estado del servidor
app.get('/salud', (req, res) => {
  res.json({
    estado: 'activo',
    servidor: 'API de Operaciones PDF & FirmaEC',
    modeloIa: CONFIGURACION.GROQ.MODELO,
    limiteArchivo: '2GB',
    fecha: new Date().toISOString()
  });
});

// Enrutar API principal
app.use('/api', rutasApi);

// Manejador global de errores
app.use((err, req, res, next) => {
  console.error('Error no controlado en la aplicación:', err);
  res.status(err.status || 500).json({
    exito: false,
    mensaje: err.message || 'Ocurrió un error inesperado en el servidor.'
  });
});

// Iniciar servidor
app.listen(CONFIGURACION.PUERTO, () => {
  console.log(` SERVIDOR INICIADO EN PUERTO: ${CONFIGURACION.PUERTO}`);
  console.log(` URL Base: http://localhost:${CONFIGURACION.PUERTO}`);
  console.log(` Modelo Groq AI: ${CONFIGURACION.GROQ.MODELO}`);
  console.log(` Directorio Temporal: ${CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL}`);
});

export default app;
