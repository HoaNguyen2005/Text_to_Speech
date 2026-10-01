const mongoose = require('mongoose');

// Bản ghi mỗi lần sinh audio thành công (dùng cho trang Lịch sử)
const GeneratedLectureSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false // cho phép khách chưa đăng nhập (không lưu lịch sử)
    },
    text: {
        type: String,
        required: true
    },
    teacher_id: {
        type: String,
        default: ''
    },
    style_id: {
        type: String,
        default: 'normal'
    },
    audio_url: {
        type: String,
        required: true
    }
}, {
    timestamps: true, // cần createdAt cho lịch sử
    versionKey: false
});

module.exports = mongoose.model('GeneratedLecture', GeneratedLectureSchema);
