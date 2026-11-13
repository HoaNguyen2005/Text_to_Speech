const db=require('../db/postgres');
const User=require('../models/user.model');
const {keycloakService,problem}=require('./keycloak.service');
async function update(user,input) {
    if(!input || Object.keys(input).some(k=>!['fullName','gender','profile_version'].includes(k))
        || typeof input.fullName!=='string' || !input.fullName.trim() || input.fullName.trim().length>200 || /[\u0000-\u001f\u007f]/u.test(input.fullName)
        || !['male','female','other'].includes(input.gender) || !Number.isInteger(input.profile_version))throw problem(400,'Thông tin hồ sơ không hợp lệ. Tên cần từ 1 đến 200 ký tự.','INVALID_PROFILE');
    return db.transaction(async(client)=>{
        // Coordinate with role/status updates; version increments also prevent a
        // stale identity read from overwriting the freshly saved local profile.
        await client.query('SELECT _id FROM users WHERE _id=$1 FOR UPDATE',[user._id]);
        const current=await User.findById(user._id);
        if(!current || current.status!=='active' || current.authSyncPending || current.authProvisioning)throw problem(409,'Tài khoản đang được cập nhật. Hãy thử lại sau.','AUTH_SYNC_PENDING');
        if((current.profile_version||0)!==input.profile_version)throw problem(409,'Hồ sơ đã được thay đổi. Hãy tải lại trước khi lưu.','PROFILE_CONFLICT');
        const service=keycloakService(),endpoint=`/users/${encodeURIComponent(current.keycloakId)}`;
        const identity=await service.request(endpoint);
        if(!identity.enabled || identity.attributes?.mongoUserId?.[0]!==String(current._id))throw problem(403,'Liên kết tài khoản không hợp lệ.','IDENTITY_CONFLICT');
        if(typeof identity.email!=='string' || !identity.email.trim())throw problem(409,'Tài khoản cần có email hợp lệ. Hãy liên hệ quản trị viên để khôi phục.','PROFILE_REQUIRED');
        const fullName=input.fullName.trim();
        // Keycloak PUT clears omitted profile fields, so preserve the current representation.
        await service.request(endpoint,{method:'PUT',body:{...identity,firstName:fullName,attributes:{...identity.attributes,gender:[input.gender]}}});
        const verified=await service.request(endpoint);
        if(verified.firstName!==fullName || verified.attributes?.gender?.[0]!==input.gender || verified.email!==identity.email
            || verified.username!==identity.username || verified.enabled!==identity.enabled || verified.emailVerified!==identity.emailVerified)throw problem(503,'Chưa đồng bộ được hồ sơ. Hãy thử lại.','PROFILE_SYNC_FAILED');
        const saved=await User.findOneAndUpdate({_id:current._id,profile_version:current.profile_version||0},{$set:{fullName,gender:input.gender},$inc:{profile_version:1,authSyncVersion:1}});
        if(!saved)throw problem(409,'Hồ sơ đã được thay đổi. Hãy tải lại trước khi lưu.','PROFILE_CONFLICT');
        return {...saved.toObject(),role:user.role};
    });
}
module.exports={update};
