const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

router.post('/register', authController.register);
router.post('/login', authController.login);

router.get('/users', authController.getAllUsers);
router.put('/users/:id/status', authController.updateUserStatus);
router.put('/users/:id/role', authController.updateUserRole);

module.exports = router;
