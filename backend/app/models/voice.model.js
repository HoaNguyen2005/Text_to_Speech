const mongoose = require('mongoose');

const VoiceSchema = new mongoose.Schema({
    voice_id: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    gender: {
        type: String,
        enum: ['male', 'female'],
        default: 'male'
    },
    file_path: {
        type: String,
        required: true
    },
    is_active: {
        type: Boolean,
        default: true
    },
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    is_global: {
        type: Boolean,
        default: false
    }
}, { timestamps: false, versionKey: false });

module.exports = mongoose.model('Voice', VoiceSchema);
