import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { CONFIGURACION } from './config/constantes.js';
import { validarVariablesEntorno } from './config/env.validator.js';
import { iniciarLimpiadorPeriodico, detenerLimpiadorPeriodico } from './services/cleanup.service.js';
import { iniciarServicioKeepAlive, detenerServicioKeepAlive } from './services/keepalive.service.js';
import { obtenerBinarioGhostscript } from './services/compress.service.js';
import { obtenerBinarioLibreOffice, obtenerBinarioNavegador } from './services/office.service.js';
import { manejarErroresGlobales } from './middlewares/error.middleware.js';
import rutasApi from './routes/api.routes.js';
import { fileURLToPath } from 'url';
import util from 'util';
import { exec } from 'child_process';

const execPromesa = util.promisify(exec);

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

// 5. Ruta de estado del servidor y diagnóstico
app.get('/diagnostico', async (req, res) => {
  const resultados = {};
  const comandos = {
    whichLo: 'which libreoffice || which soffice || echo "no-lo"',
    whichXvfb: 'which xvfb-run || echo "no-xvfb"',
    loVersion: 'libreoffice --version 2>&1 || echo "lo-err"',
    testLoXvfb: 'echo "test" > /tmp/diag.txt && xvfb-run -a -s "-screen 0 1024x768x24" libreoffice --headless --convert-to pdf --outdir /tmp /tmp/diag.txt 2>&1 && ls -lh /tmp/diag.pdf 2>&1 || echo "lo-xvfb-err"',
    whichChrome: 'which chromium || which chromium-browser || which google-chrome || echo "no-chrome"',
    findLo: 'ls -l /usr/bin/libreoffice /usr/bin/soffice 2>&1 || echo "not-found"',
    findChrome: 'ls -l /usr/bin/chromium* 2>&1 || echo "not-found"',
    os: 'cat /etc/os-release 2>&1 || echo "no-os"',
    memory: 'free -m 2>&1 || echo "no-free"'
  };

  for (const [clave, cmd] of Object.entries(comandos)) {
    try {
      const { stdout, stderr } = await execPromesa(cmd, { timeout: 10000 });
      resultados[clave] = (stdout || stderr || '').trim();
    } catch (e) {
      resultados[clave] = `ERROR: ${e.message}`;
    }
  }

  res.json({
    fecha: new Date().toISOString(),
    plataforma: process.platform,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
      PATH: process.env.PATH
    },
    ...resultados
  });
});

app.get('/salud', async (req, res) => {
  const binarioGs = await obtenerBinarioGhostscript();
  const binarioLo = await obtenerBinarioLibreOffice();
  const binarioNav = await obtenerBinarioNavegador();

  res.json({
    estado: 'activo',
    servidor: 'API de Operaciones PDF & FirmaEC',
    modeloIa: CONFIGURACION.GROQ.MODELO,
    limiteArchivo: '2GB',
    ghostscript: binarioGs ? `activo (${binarioGs})` : 'no detectado',
    libreoffice: binarioLo ? `activo (${binarioLo})` : 'no detectado',
    navegadorRender: binarioNav ? `activo (${binarioNav})` : 'no detectado',
    motorConversion: binarioLo ? 'LibreOffice Headless (Fidelidad 100% Idéntica)' : 'Motor Nativo JavaScript',
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
  iniciarServicioKeepAlive();

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
    detenerServicioKeepAlive();
    servidor.close(() => {
      console.log('[Server] Servidor cerrado y procesos en segundo plano detenidos.');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => cerrarServidor('SIGTERM'));
  process.on('SIGINT', () => cerrarServidor('SIGINT'));
}

export default app;
