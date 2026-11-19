const bookQueue = require('../db/book_queue');
const db = require('../db/postgres');
const { problem } = require('./keycloak.service');
const VOICE_RANK = { free: 0, gold: 1, diamond: 2 };
const TIERS = {
    free: { maxVoices:2, lectureChars:5000, lecturesPerDay:5, bookMinutes:15, bookChars:150000, booksPerDay:2, maxActiveBookJobs:1, maxRevisions:2, previewsPerDay:20, cloneProviders:['edge'] },
    gold: { maxVoices:10, lectureChars:12000, lecturesPerDay:20, bookMinutes:30, bookChars:500000, booksPerDay:6, maxActiveBookJobs:2, maxRevisions:8, previewsPerDay:60, cloneProviders:['edge','vieneu'] },
    diamond: { maxVoices:30, lectureChars:20000, lecturesPerDay:50, bookMinutes:59, bookChars:1000000, booksPerDay:15, maxActiveBookJobs:3, maxRevisions:null, previewsPerDay:120, cloneProviders:['edge','vieneu'] },
};
function effectiveClass(user, now = new Date()) {
    if (user?.role === 'admin') return 'diamond';
    if (!Object.hasOwn(VOICE_RANK,user?.account_class)) return 'free';
    return user.subscription_expires_at && new Date(user.subscription_expires_at) <= now ? 'free' : user.account_class;
}
function limits(user) {
    const value = TIERS[effectiveClass(user)];
    return user?.role === 'admin' ? {...value,maxVoices:null,lecturesPerDay:null,booksPerDay:null,previewsPerDay:null} : value;
}
async function resolveEffectiveUser(user) {
    if (!user || user.account_class === 'free' || !user.subscription_expires_at || new Date(user.subscription_expires_at) > new Date()) return user;
    const result = await db.query(`UPDATE users SET account_class='free',subscription_expires_at=NULL,subscription_cycle=NULL,profile_version=profile_version+1
        WHERE _id=$1 AND subscription_expires_at<=now() RETURNING *`,[user._id]);
    const latest = result.rows[0] || (await db.query('SELECT * FROM users WHERE _id=$1',[user._id])).rows[0];
    return latest ? {...latest,role:user.role === 'admin' && latest.role === 'admin' ? 'admin':'user'} : user;
}
async function currentUser(user, lock = false) {
    const row = (await db.query('SELECT * FROM users WHERE _id=$1'+(lock?' FOR UPDATE':''),[user._id])).rows[0];
    if (!row || row.status !== 'active' || row.authSyncPending || row.authProvisioning) throw problem(403,'Tài khoản không hoạt động hoặc đang chờ đồng bộ.','ACCOUNT_DISABLED');
    return resolveEffectiveUser({...row,role:user.role === 'admin' && row.role === 'admin' ? 'admin':'user'});
}
function deny(message) { throw problem(403,message,'TIER_LIMIT'); }
function canUseVoice(user,voice,provider='edge',mode='clone') {
    return VOICE_RANK[effectiveClass(user)] >= (VOICE_RANK[voice?.class || 'free'] ?? Infinity)
        && (mode !== 'clone' || voice?.is_global || voice?.origin==='system' || limits(user).cloneProviders.includes(provider));
}
function assertVoiceAccessAllowed(user,voice,provider,mode) {
    if (!canUseVoice(user,voice,provider,mode)) deny('Gói hiện tại chưa hỗ trợ giọng hoặc bộ tạo giọng này. Hãy nâng cấp gói.');
}
function assertLectureAllowed(user,length) {
    if (!Number.isInteger(length) || length < 1 || length > limits(user).lectureChars) deny(`Gói hiện tại cho phép tối đa ${limits(user).lectureChars.toLocaleString('vi-VN')} ký tự mỗi bài giảng.`);
}
function assertBookSubmissionAllowed(user,{textLength,targetMinutes}) {
    const tier = limits(user);
    if (!Number.isInteger(targetMinutes) || targetMinutes < 1 || targetMinutes > tier.bookMinutes) deny(`Gói hiện tại cho phép sách nói từ 1 đến ${tier.bookMinutes} phút.`);
    if (!Number.isInteger(textLength) || textLength > tier.bookChars) deny(`Gói hiện tại cho phép tối đa ${tier.bookChars.toLocaleString('vi-VN')} ký tự nguồn.`);
}
function assertBookReviseAllowed(user,checkpoint) {
    const maximum = limits(user).maxRevisions;
    if (maximum != null && (checkpoint?.revision_requests || 0) >= maximum) deny('Đã hết lượt AI chỉnh sửa của sách này. Bạn vẫn có thể chỉnh sửa thủ công.');
}
async function getUsageToday(userId) {
    const row = (await db.query(`SELECT lectures,books,previews FROM account_usage_daily WHERE user_id=$1
        AND usage_date=(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,[userId])).rows[0] || {};
    const counts = (await db.query(`SELECT
        (SELECT count(*)::int FROM ${bookQueue.jobs}
            WHERE user_id=$1 AND delete_requested=false AND status IN ('queued','processing')) AS active_book_jobs,
        (SELECT count(*)::int FROM voices WHERE user_id=$1 AND is_global=false AND is_active=true) AS custom_voices`,[userId])).rows[0];
    return {lectures_today:row.lectures||0,books_today:row.books||0,previews_today:row.previews||0,...counts};
}
async function assertQueueAllowed(user) {
    const {active_book_jobs} = await getUsageToday(user._id);
    if (active_book_jobs >= limits(user).maxActiveBookJobs) throw problem(429,'Hàng đợi của gói hiện tại đã đầy. Hãy chờ hoặc hủy một yêu cầu.','TIER_LIMIT');
}
async function withUserLock(user,work) {
    return db.transaction(async()=>{
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['account-usage:'+user._id]);
        return work(await currentUser(user,true));
    });
}
async function consume(user,kind,work=async()=>{}) {
    const key = {lectures:'lecturesPerDay',books:'booksPerDay',previews:'previewsPerDay'}[kind];
    if (!key) throw new Error('Unknown usage kind');
    return withUserLock(user,async current=>{
        const maximum=limits(current)[key];
        await db.query(`INSERT INTO account_usage_daily(user_id,usage_date) VALUES($1,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) ON CONFLICT DO NOTHING`,[user._id]);
        const count=(await db.query(`UPDATE account_usage_daily SET ${kind}=${kind}+1 WHERE user_id=$1
            AND usage_date=(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AND ($2::int IS NULL OR ${kind}<$2) RETURNING ${kind}`,[user._id,maximum])).rowCount;
        if (!count) throw problem(429,'Đã hết lượt sử dụng hôm nay. Hạn mức được làm mới lúc 00:00 giờ Việt Nam.','TIER_LIMIT');
        return work(current);
    });
}
async function assertVoiceUploadAllowed(user) {
    const maximum = limits(user).maxVoices;
    if (maximum != null && (await getUsageToday(user._id)).custom_voices >= maximum) deny('Đã đạt số giọng riêng của gói hiện tại. Hãy ẩn bớt giọng hoặc nâng cấp.');
}
async function describeForUser(user) {
    return {account_class:user.account_class||'free',effective_class:effectiveClass(user),subscription_expires_at:user.subscription_expires_at||null,
        subscription_cycle:user.subscription_cycle||null,is_admin_unlimited:user.role==='admin',limits:limits(user),usage:await getUsageToday(user._id),catalog:TIERS};
}
async function setAccountClass(id,body) {
    if (!db.isValidId(id) || !Object.hasOwn(VOICE_RANK,body?.account_class) || !Object.hasOwn(body,'duration_days')
        || (body.duration_days != null && (!Number.isInteger(body.duration_days) || body.duration_days<1 || body.duration_days>3650))) {
        throw problem(400,'Hạng tài khoản hoặc thời hạn không hợp lệ.','INVALID_INPUT');
    }
    const user=(await db.query(`UPDATE users SET account_class=$2,subscription_cycle=CASE WHEN $2='free' THEN NULL ELSE 'manual' END,
        subscription_expires_at=CASE WHEN $2='free' OR $3::int IS NULL THEN NULL ELSE now()+$3*interval '1 day' END,
        profile_version=profile_version+1 WHERE _id=$1 RETURNING *`,[id,body.account_class,body.duration_days])).rows[0];
    if (!user) throw problem(404,'Không tìm thấy tài khoản.','USER_NOT_FOUND');
    return user;
}
module.exports={TIERS,VOICE_RANK,effectiveClass,limits,resolveEffectiveUser,currentUser,canUseVoice,assertVoiceAccessAllowed,assertLectureAllowed,
    assertBookSubmissionAllowed,assertBookReviseAllowed,getUsageToday,assertQueueAllowed,withUserLock,consume,assertVoiceUploadAllowed,describeForUser,setAccountClass};
