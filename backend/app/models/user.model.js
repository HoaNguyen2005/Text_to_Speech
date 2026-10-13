const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    fullName: {
        type: String,
        required: true,
        trim: true
    },
    gender: {
        type: String,
        enum: ['male', 'female', 'other'],
        default: 'other'
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'banned'],
        default: 'active'
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    authProvisioning: { type: Boolean, default: false },
    authSyncPending: { type: Boolean, default: false },
    authSyncError: { type: String, default: '' },
    authSyncVersion: { type: Number, default: 0 },
    authSyncStartedAt: { type: Date },
    // Liên kết tài khoản Keycloak; không đổi MongoDB _id
    // vì Voice và GeneratedLecture đang tham chiếu user bằng ObjectId này.
    keycloakId: {
        type: String,
        default: undefined,
        unique: true,
        sparse: true
    }
}, { 
    timestamps: false,
    versionKey: false 
});

module.exports = mongoose.model('User', UserSchema);
