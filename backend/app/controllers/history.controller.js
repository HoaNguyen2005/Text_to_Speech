const GeneratedLecture = require('../models/generated_lecture.model');
const storage = require('../services/storage.service');

// Lấy lịch sử sinh audio của người dùng hiện tại (mới nhất lên đầu)
exports.getHistory = async (req, res) => {
    try {
        const items = await GeneratedLecture.find({ user_id: req.user._id })
            .sort({ createdAt: -1 })
            .limit(100)
            .select('text teacher_id style_id audio_url createdAt');

        // DB lưu key R2 (generated/xxx.wav) → sinh URL presigned mới mỗi lần đọc,
        // tránh link hết hạn. Giá trị URL http cũ (dữ liệu chưa migrate) giữ nguyên.
        const resolved = await Promise.all(items.map(async (item) => {
            const obj = item.toObject();
            if (storage.isStorageKey(obj.audio_url)) {
                obj.audio_url = await storage.resolveUrl(obj.audio_url);
            }
            return obj;
        }));

        res.json(resolved);
    } catch (error) {
        console.error('[ERROR] Lỗi khi tải lịch sử:', error.message);
        res.status(500).json({ error: "Lỗi khi tải lịch sử bài giảng" });
    }
};
