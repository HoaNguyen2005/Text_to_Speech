const express = require('express');
const router = express.Router();
const historyController = require('../controllers/history.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.get('/', verifyToken, historyController.getHistory);

module.exports = router;
