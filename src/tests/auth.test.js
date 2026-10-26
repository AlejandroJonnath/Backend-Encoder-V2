import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app.js';

describe('1. Pruebas de Autenticación y Rutas Protegidas', () => {

  it('Ruta pública /salud debe responder 200 sin autenticación', async () => {
    const res = await request(app).get('/salud');
    assert.equal(res.status, 200);
    assert.equal(res.body.estado, 'activo');
    assert.ok(res.body.fecha);
  });

  it('Ruta protegida /api/pdf/comprimir debe retornar 401 si no hay token Bearer', async () => {
    const res = await request(app)
      .post('/api/pdf/comprimir')
      .send();

    assert.equal(res.status, 401);
    assert.equal(res.body.exito, false);
    assert.equal(res.body.codigoEstado, 401);
    assert.ok(res.body.mensaje.includes('Acceso no autorizado'));
  });

  it('Ruta protegida /api/ia/resumir debe retornar 401 si se envía un token malformado o vacío', async () => {
    const res = await request(app)
      .post('/api/ia/resumir')
      .set('Authorization', 'Bearer ')
      .send();

    assert.equal(res.status, 401);
    assert.equal(res.body.exito, false);
  });

  it('Ruta protegida /api/pdf/firmar debe retornar 401 con token inválido', async () => {
    const res = await request(app)
      .post('/api/pdf/firmar')
      .set('Authorization', 'Bearer token_falso_invalido_12345')
      .send();

    assert.equal(res.status, 401);
    assert.equal(res.body.exito, false);
  });

});
