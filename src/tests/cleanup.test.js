import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { CONFIGURACION } from '../config/constantes.js';
import {
  eliminarArchivoSeguro,
  eliminarDirectorioSeguro,
  limpiarArchivosExpirados
} from '../services/cleanup.service.js';

describe('2. Pruebas de Limpieza y Ciclo de Vida de temp_uploads', () => {

  it('eliminarArchivoSeguro debe eliminar archivo existente sin arrojar error', () => {
    const rutaPrueba = path.join(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, `test_${Date.now()}.tmp`);
    fs.writeFileSync(rutaPrueba, 'contenido de prueba');
    assert.ok(fs.existsSync(rutaPrueba));

    const resultado = eliminarArchivoSeguro(rutaPrueba);
    assert.equal(resultado, true);
    assert.equal(fs.existsSync(rutaPrueba), false);
  });

  it('eliminarArchivoSeguro no debe fallar si el archivo no existe', () => {
    const rutaInexistente = path.join(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, 'archivo_fantasma.tmp');
    const resultado = eliminarArchivoSeguro(rutaInexistente);
    assert.equal(resultado, false);
  });

  it('eliminarDirectorioSeguro debe purgar carpetas de sesiones recursivamente', () => {
    const dirPrueba = path.join(CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL, `unir_sesion_test_${Date.now()}`);
    fs.mkdirSync(dirPrueba, { recursive: true });
    fs.writeFileSync(path.join(dirPrueba, 'subdoc.pdf'), 'dummy pdf');

    assert.ok(fs.existsSync(dirPrueba));
    const resultado = eliminarDirectorioSeguro(dirPrueba);
    assert.equal(resultado, true);
    assert.equal(fs.existsSync(dirPrueba), false);
  });

  it('limpiarArchivosExpirados debe eliminar elementos que superen el TTL pero preservar .gitkeep', async () => {
    const dirTemp = CONFIGURACION.ARCHIVOS.RUTA_TEMPORAL;
    const archivoViejo = path.join(dirTemp, `expirado_${Date.now()}.tmp`);
    fs.writeFileSync(archivoViejo, 'datos viejos');

    // Forzar mtime al pasado (hace 2 horas)
    const haceDosHoras = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(archivoViejo, haceDosHoras, haceDosHoras);

    // Asegurar que .gitkeep existe
    const gitkeep = path.join(dirTemp, '.gitkeep');
    if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, '');

    // limpiarArchivosExpirados es async: se debe await para esperar el resultado
    const eliminados = await limpiarArchivosExpirados({ ttlMinutos: 30 });
    assert.ok(eliminados >= 1, `Se esperaba >= 1 eliminado, pero se eliminaron ${eliminados}`);
    assert.equal(fs.existsSync(archivoViejo), false, 'El archivo expirado debe haberse eliminado');
    assert.equal(fs.existsSync(gitkeep), true, '.gitkeep debe permanecer intacto');
  });

});
