const express = require('express');
const router = express.Router();
const voiceController = require('../controllers/voice.controller');
const { verifyToken, optionalAuth } = require('../middlewares/auth.middleware');
const multer = require('multer');
const path = require('path');

// Nhận file vào RAM; việc lưu lên R2 hay đĩa local do controller + storage.service quyết định
const allowedExtensions = new Set(['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.webm']);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => {
        if (!allowedExtensions.has(path.extname(file.originalname).toLowerCase())) {
            return callback(new Error('Định dạng audio không được hỗ trợ'));
        }
        callback(null, true);
    }
});

function receiveAudio(req, res, next) {
    upload.single('audio_file')(req, res, (error) => {
        if (!error) return next();
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        res.status(status).json({ error: error.message });
    });
}

// CRUD Routes cho Giọng đọc mẫu
// GET dùng optionalAuth: khách thấy giọng global, user đăng nhập thấy thêm giọng riêng
router.get('/', optionalAuth, voiceController.getAllVoices);
router.post('/', verifyToken, receiveAudio, voiceController.createVoice);
router.get('/presets/:provider/:voiceId/preview',verifyToken,async(req,res)=>{
    try {res.sendFile(await require('../services/voice_demo.service').sample(req.params.provider,req.params.voiceId));}
    catch(error){res.status(error.status||503).json({error:error.status?error.message:'Không tải được giọng nghe mẫu. Hãy thử lại.'});}
});
router.get('/:id/preview',verifyToken,voiceController.preview);
router.put('/:id', verifyToken, voiceController.updateVoice);
router.delete('/:id', verifyToken, voiceController.deleteVoice);

module.exports = router;
