const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verifyToken, adminOnly } = require('../middlewares/auth.middleware');

router.get('/me', verifyToken, authController.me);
router.patch('/me',verifyToken,authController.updateProfile);

router.get('/users', verifyToken, adminOnly, authController.getAllUsers);
router.put('/users/:id/status', verifyToken, adminOnly, authController.updateUserStatus);
router.put('/users/:id/role', verifyToken, adminOnly, authController.updateUserRole);

module.exports = router;
