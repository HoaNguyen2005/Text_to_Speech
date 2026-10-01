const GeneratedLecture = require('../models/generated_lecture.model');

// Lấy lịch sử sinh audio của người dùng hiện tại (mới nhất lên đầu)
exports.getHistory = async (req, res) => {
    try {
        const items = await GeneratedLecture.find({ user_id: req.user._id })
            .sort({ createdAt: -1 })
            .limit(100)
            .select('text teacher_id style_id audio_url createdAt');
        res.json(items);
    } catch (error) {
        console.error('[ERROR] Lỗi khi tải lịch sử:', error.message);
        res.status(500).json({ error: "Lỗi khi tải lịch sử bài giảng" });
    }
};
