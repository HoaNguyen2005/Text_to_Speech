const mongoose = require('mongoose');

const SlideSchema = new mongoose.Schema({
    order_index: {
        type: Number,
        required: true
    },
    content: {
        type: String,
        required: true
    }
});

const LectureSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false // Đổi thành true sau khi đã ghép chặt Auth
    },
    title: {
        type: String,
        required: true
    },
    description: {
        type: String
    },
    status: {
        type: String,
        enum: ['draft', 'processing', 'completed', 'error'],
        default: 'draft'
    },
    slides: [SlideSchema]
}, { timestamps: false, versionKey: false });

module.exports = mongoose.model('Lecture', LectureSchema);
