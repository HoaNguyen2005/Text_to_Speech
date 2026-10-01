const express = require('express');
const router = express.Router();
const voiceController = require('../controllers/voice.controller');
const { verifyToken, optionalAuth } = require('../middlewares/auth.middleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Cấu hình Multer lưu file vào ổ cứng
// __dirname = .../backend/app/routes → đi lên 2 cấp = backend/
const uploadPath = path.join(__dirname, '../../public/audio/samples');
if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Đặt tên file = voice_id + đuôi mở rộng gốc
        const ext = path.extname(file.originalname) || '.wav';
        const voiceId = req.body.voice_id || `voice_${Date.now()}`;
        cb(null, `${voiceId}${ext}`);
    }
});
const upload = multer({ storage: storage });

// CRUD Routes cho Giọng đọc mẫu
// GET dùng optionalAuth: khách thấy giọng global, user đăng nhập thấy thêm giọng riêng
router.get('/', optionalAuth, voiceController.getAllVoices);
router.post('/', verifyToken, upload.single('audio_file'), voiceController.createVoice);
router.put('/:id', verifyToken, voiceController.updateVoice);
router.delete('/:id', verifyToken, voiceController.deleteVoice);

module.exports = router;
