import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import app from '../app.js';
import { CONFIGURACION } from '../config/constantes.js';
import { sanearRutaDescarga, esFormatoValido } from '../utils/fileSecurity.js';
import { AppError } from '../utils/appError.js';

describe('3. Pruebas de Seguridad de Archivos y Descargas', () => {

  it('sanearRutaDescarga debe rechazar intentos de Path Traversal (..)', () => {
    assert.throws(
      () => sanearRutaDescarga('../../../archivo_sensible.txt', CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL),
      (err) => err instanceof AppError && err.codigoEstado === 403
    );
  });

  it('sanearRutaDescarga debe prohibir estrictamente la descarga de certificados .p12 y .pfx', () => {
    assert.throws(
      () => sanearRutaDescarga('mi_certificado.p12', CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL),
      (err) => err instanceof AppError && err.codigoEstado === 403
    );

    assert.throws(
      () => sanearRutaDescarga('firma.pfx', CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL),
      (err) => err instanceof AppError && err.codigoEstado === 403
    );
  });

  it('sanearRutaDescarga debe prohibir la descarga de archivos .env y ocultos', () => {
    assert.throws(
      () => sanearRutaDescarga('.env', CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL),
      (err) => err instanceof AppError && err.codigoEstado === 403
    );
  });

  it('Endpoint /api/descargar/:nombre debe retornar 403 al solicitar un archivo .p12', async () => {
    const res = await request(app).get('/api/descargar/certificado_prueba.p12');
    assert.equal(res.status, 403);
    assert.equal(res.body.exito, false);
    assert.ok(res.body.mensaje.includes('Tipo de archivo restringido') || res.body.mensaje.includes('no permitida'));
  });

  it('Endpoint /api/descargar/:nombre debe retornar 404 al solicitar un PDF legítimo que no existe', async () => {
    const res = await request(app).get('/api/descargar/resultado_inexistente_9999.pdf');
    assert.equal(res.status, 404);
    assert.equal(res.body.exito, false);
  });

  it('esFormatoValido debe validar extensiones correctas y descartar formatos erróneos', () => {
    const archivoValido = { originalname: 'documento.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    const archivoInvalido = { originalname: 'script.exe', mimetype: 'application/x-msdownload' };

    assert.equal(esFormatoValido(archivoValido, ['.docx', '.doc'], ['wordprocessingml']), true);
    assert.equal(esFormatoValido(archivoInvalido, ['.pdf'], ['application/pdf']), false);
  });

});
