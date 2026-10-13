const mongoose = require('mongoose');
const User = require('../models/user.model');
const { keycloakService, problem } = require('./keycloak.service');

async function resolveIdentity(claims) {
    const service = keycloakService();
    let user = await User.findOne({ keycloakId: claims.sub }).select('-password');
    const { user: identity, roles, role } = await service.identity(claims.sub);
    if (!identity.enabled) {
        // Deny old access tokens even if the Keycloak session has already been revoked.
        throw problem(403, 'Tài khoản đã bị khóa hoặc cấm.', 'ACCOUNT_DISABLED');
    }
    if (!['user', 'admin'].some((name) => claims.realm_access?.roles?.includes(name))
        || !roles.some((entry) => ['user', 'admin'].includes(entry.name))) {
        throw problem(403, 'Tài khoản chưa có quyền sử dụng ứng dụng.', 'INSUFFICIENT_ROLE');
    }
    if (user?.authSyncPending) throw problem(403, 'Tài khoản đang chờ đồng bộ quyền/trạng thái. Hãy liên hệ quản trị viên.', 'AUTH_SYNC_PENDING');
    if (user && user.status !== 'active') throw problem(403, 'Tài khoản đã bị khóa hoặc cấm.', 'ACCOUNT_DISABLED');
    const sessionId = claims.sid || claims.session_state;
    if (typeof sessionId !== 'string') throw problem(401, 'Access token cần gắn với phiên đăng nhập.', 'INVALID_TOKEN');
    const sessions = await service.request(`/users/${encodeURIComponent(claims.sub)}/sessions`);
    if (!sessions.some((entry) => entry.id === sessionId)) throw problem(401, 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.', 'SESSION_ENDED');
    const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';
    if (!email) throw problem(403, 'Tài khoản cần có email hợp lệ.', 'PROFILE_REQUIRED');
    const mappedId = identity.attributes?.mongoUserId?.[0];
    if (!user) {
        if (mappedId) {
            if (!mongoose.isValidObjectId(mappedId)) throw problem(409, 'Mapping tài khoản không hợp lệ.', 'IDENTITY_CONFLICT');
            throw problem(409, 'Tài khoản cũ chưa được liên kết với MongoDB ứng dụng. Cần chạy bước liên kết Phase 3.', 'MAPPING_REQUIRED');
        }
        if (await User.exists({ email })) throw problem(409, 'Email đã thuộc tài khoản cũ. Cần quản trị viên xác minh liên kết.', 'IDENTITY_CONFLICT');
        try {
            user = await User.create({ keycloakId: claims.sub, email,
                fullName: identity.firstName?.trim() || claims.name || email,
                gender: ['male', 'female', 'other'].includes(identity.attributes?.gender?.[0]) ? identity.attributes.gender[0] : 'other',
                role, status: 'active', authProvisioning: true });
        } catch (error) {
            if (error.code !== 11000) throw error;
            user = await User.findOne({ keycloakId: claims.sub }).select('-password');
            if (!user) throw problem(409, 'Email đã được sử dụng bởi tài khoản khác.', 'IDENTITY_CONFLICT');
        }
    }
    if (mappedId && mappedId !== String(user._id)) throw problem(409, 'Liên kết tài khoản không khớp.', 'IDENTITY_CONFLICT');
    if (claims.mongoUserId && claims.mongoUserId !== String(user._id)) throw problem(409, 'Claim tài khoản không khớp.', 'IDENTITY_CONFLICT');
    if (user.authSyncPending) throw problem(403, 'Tài khoản đang chờ đồng bộ quyền/trạng thái. Hãy liên hệ quản trị viên.', 'AUTH_SYNC_PENDING');
    if (user.status !== 'active') throw problem(403, 'Tài khoản đã bị khóa hoặc cấm.', 'ACCOUNT_DISABLED');
    const version = user.authSyncVersion || 0;
    const versionFilter = version === 0 ? { $or: [{ authSyncVersion: 0 }, { authSyncVersion: { $exists: false } }] } : { authSyncVersion: version };
    if (!mappedId || user.authProvisioning) {
        await service.attributes(claims.sub, { mongoUserId: [String(user._id)], legacyStatus: ['active'] });
        await User.updateOne({ _id: user._id, keycloakId: claims.sub }, { $set: { authProvisioning: false } });
        user.authProvisioning = false;
    }
    const updates = { email, fullName: identity.firstName?.trim() || user.fullName, role };
    if (['male', 'female', 'other'].includes(identity.attributes?.gender?.[0])) updates.gender = identity.attributes.gender[0];
    if (Object.entries(updates).some(([field, value]) => user[field] !== value)) {
        const saved = await User.findOneAndUpdate({ _id: user._id, keycloakId: claims.sub, authSyncPending: { $ne: true }, ...versionFilter },
            { $set: updates }, { returnDocument: 'after', runValidators: true }).select('-password');
        if (!saved) throw problem(403, 'Tài khoản đang chờ đồng bộ.', 'AUTH_SYNC_PENDING');
        user = saved;
    }
    if (!await User.exists({ _id: user._id, keycloakId: claims.sub, status: 'active', authSyncPending: { $ne: true }, ...versionFilter })) {
        throw problem(403, 'Quyền/trạng thái tài khoản vừa thay đổi. Vui lòng thử lại.', 'AUTH_SYNC_PENDING');
    }
    // Promotions require a fresh token; demotions apply from the current Keycloak role immediately.
    const effectiveRole = role === 'admin' && claims.realm_access.roles.includes('admin') ? 'admin' : 'user';
    const result = user.toObject();
    delete result.password;
    result.role = effectiveRole;
    return result;
}
module.exports = { resolveIdentity };
