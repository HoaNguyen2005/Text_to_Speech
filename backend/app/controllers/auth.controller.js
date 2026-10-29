const { isValidId } = require('../db/postgres');
const User = require('../models/user.model');
const { keycloakService, problem } = require('../services/keycloak.service');

function fail(res, error) {
    return res.status(error.status || 503).json({ error: error.status ? error.message : 'Không thể cập nhật tài khoản. Hãy thử lại.',
        code: error.code || 'AUTH_SYNC_FAILED' });
}
exports.me = (req, res) => res.json({ user: req.user, account_created: Boolean(req.identityCreated) });
exports.updateProfile=async(req,res)=>{
    try {res.json({message:'Đã cập nhật thông tin cá nhân.',user:await require('../services/profile.service').update(req.user,req.body)});}
    catch(error){fail(res,error);}
};
exports.getAllUsers = async (req, res) => {
    try { res.json(await User.find().select('-password').sort({ _id: -1 })); }
    catch (error) { fail(res, error); }
};

async function update(req, res, field, values) {
    try {
        const { id } = req.params;
        const value = req.body?.[field];
        if (!isValidId(id) || !values.includes(value)) throw problem(400, 'ID hoặc giá trị cập nhật không hợp lệ.', 'INVALID_INPUT');
        const user = await User.findById(id).select('-password');
        if (!user) throw problem(404, 'Không tìm thấy tài khoản.', 'USER_NOT_FOUND');
        if (!user.keycloakId) throw problem(409, 'Tài khoản chưa được liên kết Keycloak.', 'MAPPING_REQUIRED');
        if (String(user._id) === String(req.user._id) && ((field === 'role' && value !== 'admin') || (field === 'status' && value !== 'active'))) {
            throw problem(409, 'Bạn không thể tự khóa hoặc hạ quyền tài khoản đang quản trị.', 'SELF_LOCKOUT');
        }
        if (user.authSyncPending && !user.authSyncError && Date.now() - new Date(user.authSyncStartedAt || 0).getTime() < 300000) {
            throw problem(409, 'Tài khoản đang được cập nhật. Nếu tiến trình bị ngắt, có thể thử lại sau 5 phút.', 'AUTH_SYNC_PENDING');
        }
        const oldVersion = user.authSyncVersion || 0;
        const versionCondition = oldVersion === 0 ? { $or: [{ authSyncVersion: 0 }, { authSyncVersion: { $exists: false } }] } : { authSyncVersion: oldVersion };
        const locked = await User.findOneAndUpdate({ _id: user._id, ...versionCondition },
            { $set: { authSyncPending: true, authSyncError: '', authSyncStartedAt: new Date() }, $inc: { authSyncVersion: 1 } }, { returnDocument: 'after' }).select('-password');
        if (!locked) throw problem(409, 'Tài khoản vừa được cập nhật bởi thao tác khác.', 'AUTH_SYNC_CONFLICT');
        const version = locked.authSyncVersion;
        const changes = { role: user.role, status: user.status, [field]: value };
        try {
            const current = await keycloakService().request(`/users/${encodeURIComponent(user.keycloakId)}`);
            if (current.attributes?.mongoUserId?.[0] !== String(user._id)) throw problem(409, 'Mapping tài khoản Keycloak không khớp.', 'IDENTITY_CONFLICT');
            await keycloakService().updateAccount(user.keycloakId, changes);
            const saved = await User.findOneAndUpdate({ _id: user._id, authSyncVersion: version },
                { $set: { ...changes, authSyncPending: false, authSyncError: '' } }, { returnDocument: 'after', runValidators: true }).select('-password');
            if (!saved) throw problem(409, 'Phiên bản đồng bộ đã thay đổi.', 'AUTH_SYNC_CONFLICT');
            res.json({ message: 'Đã cập nhật Keycloak và hồ sơ ứng dụng. Người dùng cần đăng nhập lại.', user: saved });
        } catch (error) {
            await User.updateOne({ _id: user._id, authSyncVersion: version }, { $set: { authSyncPending: true, authSyncError: 'AUTH_SYNC_FAILED' } });
            throw error;
        }
    } catch (error) { fail(res, error); }
}
exports.updateUserStatus = (req, res) => update(req, res, 'status', ['active', 'inactive', 'banned']);
exports.updateUserRole = (req, res) => update(req, res, 'role', ['user', 'admin']);
