import { Router } from 'express';
import { eliminarCuentaController, exportarDatosUsuarioController } from '../controllers/user.controller.js';

const router = Router();

// Eliminar definitivamente la cuenta del usuario y sus datos asociados
router.delete('/account', eliminarCuentaController);

// Exportar copia de seguridad / backup de los datos personales del usuario
router.get('/backup', exportarDatosUsuarioController);

export default router;

