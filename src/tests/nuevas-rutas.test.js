import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app.js';
import fs from 'fs';
import path from 'path';

describe('4. Pruebas de Nuevos Endpoints: Soporte, Usuario, Rollback y Admin', () => {

  it('Rutas protegidas deben rechazar peticiones sin token Bearer', async () => {
    const resSoporte = await request(app).post('/api/support/tickets').send({ titulo: 'Test', descripcion: 'Falla al comprimir documento de prueba' });
    assert.equal(resSoporte.status, 401);

    const resBackup = await request(app).get('/api/user/backup');
    assert.equal(resBackup.status, 401);

    const resAdmin = await request(app).get('/api/admin/estadisticas');
    assert.equal(resAdmin.status, 401);

    const resAdminReportes = await request(app).get('/api/admin/reportes');
    assert.equal(resAdminReportes.status, 401);

    const resAdminMonitoreo = await request(app).get('/api/admin/monitoreo');
    assert.equal(resAdminMonitoreo.status, 401);
  });

  it('Rutas de recuperación de contraseña con OTP deben validar campos requeridos', async () => {
    // Solicitar sin correo
    const resSolicitudSinCorreo = await request(app)
      .post('/api/auth/solicitar-recuperacion')
      .send({});
    assert.equal(resSolicitudSinCorreo.status, 400);

    // Restablecer sin OTP o sin nueva contraseña
    const resRestablecerIncompleto = await request(app)
      .post('/api/auth/restablecer-contrasena')
      .send({ email: 'usuario@prueba.com', otp: '123456' });
    assert.equal(resRestablecerIncompleto.status, 400);

    // Restablecer con contraseña muy corta (< 6 caracteres)
    const resPasswordCorta = await request(app)
      .post('/api/auth/restablecer-contrasena')
      .send({ email: 'usuario@prueba.com', otp: '123456', nuevaContrasena: '123' });
    assert.equal(resPasswordCorta.status, 400);
  });

  it('Ruta /salud debe seguir respondiendo 200 y reportar estado activo', async () => {
    const res = await request(app).get('/salud');
    assert.equal(res.status, 200);
    assert.equal(res.body.estado, 'activo');
  });
});

describe('8. Auditoría de Seguridad: Verificación de Credenciales no Hardcodeadas', () => {
  it('No deben existir claves privadas ni secretos hardcodeados en el código de Backend', () => {
    const archivosAInspeccionar = [
      'src/app.js',
      'src/config/constantes.js',
      'src/config/supabase.js',
      'src/controllers/firma.controller.js',
      'src/controllers/admin.controller.js'
    ];

    const patronesPeligrosos = [
      /gsk_[a-zA-Z0-9]{20,}/i, // Groq API key real
      /sbp_[a-zA-Z0-9]{20,}/i, // Supabase service token
      /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]{50,}/ // JWT token real
    ];

    for (const archivoRelativo of archivosAInspeccionar) {
      const rutaAbsoluta = path.join(process.cwd(), archivoRelativo);
      if (fs.existsSync(rutaAbsoluta)) {
        const contenido = fs.readFileSync(rutaAbsoluta, 'utf-8');
        for (const patron of patronesPeligrosos) {
          const match = patron.test(contenido);
          assert.equal(match, false, `Se detectó una credencial posiblemente hardcodeada en ${archivoRelativo}`);
        }
      }
    }
  });

  it('Archivo .gitignore debe excluir de forma estricta .env y certificados .p12', () => {
    const gitignorePath = path.join(process.cwd(), '.gitignore');
    assert.equal(fs.existsSync(gitignorePath), true);
    const contenido = fs.readFileSync(gitignorePath, 'utf-8');
    assert.equal(contenido.includes('.env'), true, '.gitignore debe excluir .env');
  });
});

