import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { CONFIGURACION } from './config/constantes.js';
import { validarVariablesEntorno } from './config/env.validator.js';
import { iniciarLimpiadorPeriodico, detenerLimpiadorPeriodico } from './services/cleanup.service.js';
import { manejarErroresGlobales } from './middlewares/error.middleware.js';
import rutasApi from './routes/api.routes.js';
import { fileURLToPath } from 'url';

// 1. Validar entorno al iniciar
validarVariablesEntorno();

const app = express();

// Confiar en el reverse proxy (Render, Cloudflare, etc.) para detectar HTTPS correctamente
app.set('trust proxy', 1);

// 2. Asegurar que exista la carpeta temporal para streaming
if (!fs.existsSync(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL)) {

  fs.mkdirSync(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, { recursive: true });

}

// 3. Middlewares de seguridad y utilidad
app.use(helmet({

  crossOriginResourcePolicy: false,

}));

app.use(cors({
  origin: (process.env.NODE_ENV === 'production' && process.env.URL_FRONTEND)
    ? [process.env.URL_FRONTEND]
    : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  // Headers explícitos — nunca usar '*' en producción
  allowedHeaders: [
    'Content-Type', 'Authorization', 'Accept',
    'x-parametros', 'x-p12-base64', 'x-sesion-id',
    'x-token-p12', 'x-retorno-json'
  ]
}));

// Morgan con sanitización para evitar imprimir contraseñas o certificados en logs
// 'combined' en producción es compatible con Datadog, Loki, CloudWatch
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use(express.json({ limit: '50mb' }));

app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 4. Middleware para normalizar parámetros recibidos vía Query o Headers
// (evita el error nativo "parameters doesn't exist" en Expo uploadAsync)
app.use((req, res, next) => {

  if (req.headers['x-parametros']) {

    try {

      const extra = JSON.parse(req.headers['x-parametros']);

      req.body = { ...extra, ...req.body };

    } catch (_) { }
  }

  if (req.headers['x-p12-base64']) {

    req.body = req.body || {};

    req.body.p12Base64 = req.headers['x-p12-base64'];

  }

  if (req.query && Object.keys(req.query).length > 0) {

    const querySegura = { ...req.query };

    // Por seguridad, descartar contraseñas pasadas por URL
    delete querySegura.contrasena;

    req.body = { ...querySegura, ...req.body };
  }

  next();

});

// 5. Ruta de estado del servidor
app.get('/salud', (req, res) => {

  res.json({
    estado: 'activo',
    servidor: 'API de Operaciones PDF & FirmaEC',
    modeloIa: CONFIGURACION.GROQ.MODELO,
    limiteArchivo: '2GB',
    ttlTemporalesMin: CONFIGURACION.ARCHIVOS.TTL_MINUTOS,
    fecha: new Date().toISOString()
  });

});

// 6. Enrutar API principal
app.use('/api', rutasApi);
// 7. Manejador global centralizado de errores
app.use(manejarErroresGlobales);

// 8. Iniciar servidor HTTP y limpiador periódico únicamente cuando se ejecuta directamente (no en tests)
// fileURLToPath importado al inicio del archivo

const esModuloPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (esModuloPrincipal) {
  iniciarLimpiadorPeriodico();

  const servidor = app.listen(CONFIGURACION.PUERTO, () => {
    console.log(`\nSERVIDOR INICIADO EN PUERTO: ${CONFIGURACION.PUERTO}`);
    console.log(`URL Base: http://localhost:${CONFIGURACION.PUERTO}`);
    console.log(`Modelo Groq AI: ${CONFIGURACION.GROQ.MODELO}`);
    console.log(`Directorio Temporal: ${CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL}\n`);
  });

  // Apagado elegante (Graceful Shutdown)
  function cerrarServidor(senal) {
    console.log(`\n[Server] Señal ${senal} recibida. Cerrando servidor de forma limpia...`);
    detenerLimpiadorPeriodico();
    servidor.close(() => {
      console.log('[Server] Servidor cerrado y procesos en segundo plano detenidos.');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => cerrarServidor('SIGTERM'));
  process.on('SIGINT', () => cerrarServidor('SIGINT'));
}

export default app;
