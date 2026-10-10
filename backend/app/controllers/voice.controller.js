const Voice = require('../models/voice.model');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const storage = require('../services/storage.service');

// Lấy danh sách giọng mẫu
// - Chưa đăng nhập (req.user = null): chỉ thấy giọng global
// - Đã đăng nhập là user: thấy giọng global + giọng riêng của mình
// - Đã đăng nhập là admin: thấy tất cả
exports.getAllVoices = async (req, res) => {
    try {
        let query = { is_active: true };
        
        if (!req.user) {
            // Khách vãng lai: chỉ thấy giọng global
            query.is_global = true;
        } else if (req.user.role !== 'admin') {
            // User thường: giọng global + giọng riêng
            query.$or = [{ is_global: true }, { user_id: req.user._id }];
        }
        // Admin: không thêm filter → thấy tất cả
        
        const voices = await Voice.find(query).sort({ createdAt: -1 });
        res.json(voices);
    } catch (error) {
        res.status(500).json({ error: "Lỗi khi tải danh sách giọng mẫu" });
    }
};

// Thêm giọng mẫu mới
exports.createVoice = async (req, res) => {
    try {
        const { voice_id, name, gender } = req.body;
        
        if (!voice_id || !name || !req.file) {
            return res.status(400).json({ error: "Vui lòng nhập đủ thông tin và upload file âm thanh" });
        }
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(voice_id)) {
            return res.status(400).json({ error: "Mã giọng chỉ được chứa chữ, số, dấu gạch ngang và gạch dưới" });
        }

        const ext = path.extname(req.file.originalname).toLowerCase() || '.wav';
        const contentTypes = {
            '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
            '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.webm': 'audio/webm'
        };
        const fileName = `${voice_id}.${crypto.randomUUID()}${ext}`;
        let file_path;

        if (storage.isR2Enabled()) {
            file_path = `samples/${fileName}`;
            await storage.uploadBuffer(req.file.buffer, file_path, contentTypes[ext]);
        } else {
            // Chế độ local (dev chưa cấu hình R2): ghi ra đĩa như cũ
            const localDir = path.join(__dirname, '../../public/audio/samples');
            fs.mkdirSync(localDir, { recursive: true });
            fs.writeFileSync(path.join(localDir, fileName), req.file.buffer);
            file_path = `public/audio/samples/${fileName}`;
        }

        const newVoice = new Voice({
            voice_id,
            name,
            gender: gender || 'male',
            file_path,
            user_id: req.user._id,
            is_global: req.user.role === 'admin'
        });
        await newVoice.save();
        
        res.status(201).json({ message: "Thêm giọng mẫu thành công", data: newVoice });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ error: "voice_id này đã tồn tại!" });
        }
        console.error(error);
        res.status(500).json({ error: "Lỗi hệ thống khi thêm giọng mẫu" });
    }
};

// Cập nhật giọng mẫu (Sửa)
exports.updateVoice = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const updatedVoice = await Voice.findByIdAndUpdate(id, updates, { new: true });
        
        if (!updatedVoice) {
            return res.status(404).json({ error: "Không tìm thấy giọng mẫu" });
        }

        res.json({ message: "Cập nhật thành công", data: updatedVoice });
    } catch (error) {
        res.status(500).json({ error: "Lỗi khi cập nhật giọng mẫu" });
    }
};

// Xóa giọng mẫu (Ẩn đi chứ không xóa data cứng - Soft Delete)
exports.deleteVoice = async (req, res) => {
    try {
        const { id } = req.params;
        
        const deletedVoice = await Voice.findByIdAndUpdate(id, { is_active: false }, { new: true });
        
        if (!deletedVoice) {
            return res.status(404).json({ error: "Không tìm thấy giọng mẫu" });
        }

        res.json({ message: "Đã xóa giọng mẫu thành công" });
    } catch (error) {
        res.status(500).json({ error: "Lỗi khi xóa giọng mẫu" });
    }
};
