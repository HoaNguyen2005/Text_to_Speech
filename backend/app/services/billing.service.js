const crypto=require('crypto');
const db=require('../db/postgres');
const {problem}=require('./keycloak.service');
const tiers=require('./account_tier.service');
const {getBillingConfig}=require('../config/billing');
const prices={gold:{monthly:29000,yearly:290000},diamond:{monthly:59000,yearly:590000}};
const demoPrices={gold:{monthly:2000,yearly:5000},diamond:{monthly:3000,yearly:10000}};
const day=86400000;
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
function getPlansCatalog() {
    const config=getBillingConfig();
    return {configured:config.configured,demo_prices:config.demo,verification_available:config.configured&&Boolean(config.apiToken),
        plans:Object.entries(config.demo?demoPrices:prices).flatMap(([plan_class,cycles])=>Object.entries(cycles).map(([billing_cycle,amount_vnd])=>({
            plan_class,billing_cycle,amount_vnd,duration_days:billing_cycle==='yearly'?365:30,limits:tiers.TIERS[plan_class]})))};
}
function present(order) {
    const value={};
    for(const key of ['_id','user_id','payment_code','plan_class','billing_cycle','duration_days','amount_vnd','status','paid_amount_vnd','paid_at','expires_at','createdAt','bank_reference_code']) value[key]=order[key]??null;
    value.review_reason=order.gateway_payload?.review_reason||null;
    if(value.status==='pending' && new Date(order.expires_at)<=new Date())value.status='expired';
    if(getBillingConfig().configured && order.status==='pending' && new Date(order.expires_at)>new Date()) {
        value.bank=order.bank_details;
        const params=new URLSearchParams({acc:order.bank_details.account_number,bank:order.bank_details.bank_code,amount:String(order.amount_vnd),des:order.payment_code,template:'compact'});
        value.qr_url='https://qr.sepay.vn/img?'+params;
    }
    return value;
}
async function billingTransaction(work) {
    // A short shared lock also serializes webhook/API deduplication across processes.
    return db.transaction(async()=>{await db.query("SELECT pg_advisory_xact_lock(hashtextextended('tts-billing',0))");return work();});
}
async function expire(userId) {
    await db.query(`UPDATE payment_orders SET status='expired',"updatedAt"=now() WHERE user_id=$1 AND status='pending' AND expires_at<=now()`,[userId]);
}
function assertPurchaseAllowed(user,plan) {
    const active=tiers.effectiveClass({...user,role:'user'});
    if(tiers.VOICE_RANK[active]>tiers.VOICE_RANK[plan]) throw problem(409,'Không thể mua gói thấp hơn khi gói hiện tại còn hiệu lực.','PLAN_DOWNGRADE');
    if(active!=='free' && !user.subscription_expires_at) throw problem(409,'Tài khoản đã được cấp gói vĩnh viễn. Hãy liên hệ quản trị viên.','PERMANENT_PLAN');
}
async function createOrder(user,input) {
    const config=getBillingConfig(),plan=getPlansCatalog().plans.find(p=>p.plan_class===input?.plan_class&&p.billing_cycle===input?.billing_cycle);
    if(!config.configured) throw problem(503,'Thanh toán chưa được cấu hình. Hãy liên hệ quản trị viên.','BILLING_NOT_CONFIGURED');
    if(!plan) throw problem(400,'Gói hoặc chu kỳ thanh toán không hợp lệ.','INVALID_INPUT');
    return billingTransaction(async()=>{
        const current=await tiers.currentUser(user,true);assertPurchaseAllowed(current,plan.plan_class);
        await expire(user._id);
        if((await db.query("SELECT count(*)::int AS count FROM payment_orders WHERE user_id=$1 AND status='pending'",[user._id])).rows[0].count>=3) {
            throw problem(429,'Bạn đang có 3 đơn chờ thanh toán. Hãy hủy hoặc hoàn tất đơn trước.','PENDING_ORDER_LIMIT');
        }
        for(let attempt=0;attempt<5;attempt++) {
            const code='TTS'+crypto.randomBytes(4).toString('hex').toUpperCase();
            const result=await db.query(`INSERT INTO payment_orders(_id,user_id,payment_code,plan_class,billing_cycle,duration_days,amount_vnd,bank_details,expires_at)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now()+interval '15 minutes') ON CONFLICT (payment_code) DO NOTHING RETURNING *`,
                [crypto.randomBytes(12).toString('hex'),user._id,code,plan.plan_class,plan.billing_cycle,plan.duration_days,plan.amount_vnd,JSON.stringify(config.bank)]);
            if(result.rowCount)return present(result.rows[0]);
        }
        throw problem(503,'Không tạo được mã thanh toán. Hãy thử lại.','BILLING_UNAVAILABLE');
    });
}
async function getOrder(user,id) {
    if(!db.isValidId(id))throw problem(404,'Không tìm thấy đơn thanh toán.','ORDER_NOT_FOUND');
    await expire(user._id);
    const row=(await db.query('SELECT * FROM payment_orders WHERE _id=$1 AND user_id=$2',[id,user._id])).rows[0];
    if(!row)throw problem(404,'Không tìm thấy đơn thanh toán.','ORDER_NOT_FOUND');
    return row;
}
async function listOrders(user,admin=false,before) {
    if(admin && user.role!=='admin')throw problem(403,'Bạn không có quyền quản trị.','INSUFFICIENT_ROLE');
    if(before && !db.isValidId(before))throw problem(400,'Mã phân trang không hợp lệ.','INVALID_INPUT');
    await expire(user._id);
    const rows=(await db.query(`SELECT * FROM payment_orders WHERE ($1::text IS NULL OR user_id=$1)
        AND ($2::text IS NULL OR ("createdAt",_id)<(SELECT "createdAt",_id FROM payment_orders WHERE _id=$2 AND ($1::text IS NULL OR user_id=$1)))
        ORDER BY "createdAt" DESC,_id DESC LIMIT 20`,[admin?null:user._id,before||null])).rows;
    return {orders:rows.map(present),next_cursor:rows.length===20?rows.at(-1)._id:null};
}
async function cancelOrder(user,id) {
    return billingTransaction(async()=>{
        const row=await getOrder(user,id);
        if(row.status!=='pending')return present(row);
        return present((await db.query(`UPDATE payment_orders SET status='cancelled',"updatedAt"=now() WHERE _id=$1 RETURNING *`,[id])).rows[0]);
    });
}
function parseDate(value) {
    if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))return null;
    const date=new Date(value.replace(' ','T')+'+07:00');
    return Number.isFinite(+date) && new Date(+date+7*3600000).toISOString().slice(0,19).replace('T',' ')===value ? date:null;
}
function transferFromPayload(payload,source='webhook') {
    if(!payload || typeof payload!=='object')return null;
    const rawId=String(payload.id??'');
    const amount=Number(source==='api'?payload.amount_in:payload.transferAmount);
    if((source==='webhook'&&payload.transferType!=='in') || !/^[0-9]{1,30}$/.test(rawId) || !Number.isSafeInteger(amount) || amount<=0)return null;
    const codes=[...new Set([payload.code,source==='api'?payload.transaction_content:payload.content].flatMap(text=>
        [...String(text||'').toUpperCase().matchAll(/(?:^|[^A-Z0-9])(TTS[0-9A-F]{8})(?![A-Z0-9])/g)].map(match=>match[1])))];
    if(codes.length!==1)return null;
    const date=parseDate(source==='api'?payload.transaction_date:payload.transactionDate);
    if(!date)return null;
    return {id:rawId,amount,code:codes[0],date,account:String(source==='api'?payload.account_number:payload.accountNumber),
        gateway:String(source==='api'?payload.bank_brand_name:payload.gateway),reference:String((source==='api'?payload.reference_number:payload.referenceCode)||'').slice(0,200)};
}
function subscriptionForPayment(user,order,now=new Date()) {
    const current=tiers.effectiveClass({...user,role:'user'},now);
    if(tiers.VOICE_RANK[current]>tiers.VOICE_RANK[order.plan_class])return {review_reason:'higher_plan_active'};
    if(current!=='free' && !user.subscription_expires_at)return {review_reason:'permanent_plan'};
    const start=current===order.plan_class && new Date(user.subscription_expires_at)>now ? +new Date(user.subscription_expires_at):+now;
    return {account_class:order.plan_class,subscription_expires_at:new Date(start+order.duration_days*day),subscription_cycle:order.billing_cycle};
}
async function settleOrderPaid(transfer) {
    if(!transfer)return {ignored:true};
    return billingTransaction(async()=>{
        if((await db.query('SELECT 1 FROM payment_orders WHERE sepay_transaction_id=$1',[transfer.id])).rowCount)return {alreadyProcessed:true};
        const order=(await db.query('SELECT * FROM payment_orders WHERE payment_code=$1 FOR UPDATE',[transfer.code])).rows[0];
        if(!order || order.status==='paid' || order.sepay_transaction_id)return {ignored:true};
        if(normalize(transfer.gateway)!==normalize(order.bank_details.gateway) || transfer.account!==order.bank_details.account_number)return {ignored:true};
        const user=(await db.query('SELECT * FROM users WHERE _id=$1 FOR UPDATE',[order.user_id])).rows[0];
        // Use the same clock as the stored order timestamps even when the Docker clock drifts.
        const now = new Date((await db.query('SELECT clock_timestamp() AS now')).rows[0].now);
        const subscription=subscriptionForPayment(user,order,now);
        let reason=order.status==='cancelled'?'cancelled_order':order.status==='review_required'?'manual_review':null;
        if(transfer.date<new Date(+new Date(order.createdAt)-1000) || transfer.date>new Date(+now+60000))reason='invalid_transaction_time';
        else if(transfer.date>new Date(order.expires_at))reason='late_payment';
        else if(transfer.amount<order.amount_vnd)reason='insufficient_amount';
        else if(user.status!=='active' || user.authSyncPending || user.authProvisioning)reason='inactive_account';
        reason ||= subscription.review_reason;
        await db.query(`UPDATE payment_orders SET status=$2,sepay_transaction_id=$3,bank_reference_code=$4,paid_amount_vnd=$5,
            paid_at=$6,gateway_payload=$7::jsonb,"updatedAt"=now() WHERE _id=$1`,
            [order._id,reason?'review_required':'paid',transfer.id,transfer.reference,transfer.amount,transfer.date,
                JSON.stringify({review_reason:reason||null,bank:transfer.gateway,account:transfer.account,transaction_date:transfer.date})]);
        if(!reason)await db.query(`UPDATE users SET account_class=$2,subscription_expires_at=$3,subscription_cycle=$4,profile_version=profile_version+1 WHERE _id=$1`,
            [user._id,subscription.account_class,subscription.subscription_expires_at,subscription.subscription_cycle]);
        return {paid:!reason,review_required:Boolean(reason)};
    });
}
function verifyWebhookSecret(header) {
    const config=getBillingConfig();
    if(!config.configured)throw problem(503,'Thanh toán chưa được cấu hình.','BILLING_NOT_CONFIGURED');
    const expected=Buffer.from('Apikey '+config.secret),actual=Buffer.from(typeof header==='string'?header:'');
    if(expected.length!==actual.length || !crypto.timingSafeEqual(expected,actual))throw problem(401,'Chứng thực SePay không hợp lệ.','INVALID_WEBHOOK_SECRET');
}
async function verifyOrderWithSepayApi(user,id) {
    let row=await getOrder(user,id);
    if(['paid','review_required','cancelled'].includes(row.status))return present(row);
    const config=getBillingConfig();
    if(!config.configured || !config.apiToken)throw problem(503,'Chưa cấu hình API đối soát SePay.','BILLING_NOT_CONFIGURED');
    const claimed=await billingTransaction(async()=>{
        if((await db.query("SELECT 1 FROM payment_orders WHERE user_id=$1 AND last_checked_at>now()-interval '30 seconds' LIMIT 1",[user._id])).rowCount)return false;
        return (await db.query('UPDATE payment_orders SET last_checked_at=now() WHERE _id=$1 AND user_id=$2 RETURNING _id',[id,user._id])).rowCount>0;
    });
    if(!claimed)return present(row);
    const localDate=value=>new Date(+new Date(value)+7*3600000).toISOString().slice(0,10);
    const params = new URLSearchParams({
        account_number: row.bank_details.account_number,
        transaction_date_min: `${localDate(row.createdAt)} 00:00:00`,
        transaction_date_max: `${localDate(row.expires_at)} 23:59:59`,
        limit: '5000',
    });
    let data;
    try {
        const response=await fetch('https://my.sepay.vn/userapi/transactions/list?'+params,{headers:{Authorization:'Bearer '+config.apiToken},signal:AbortSignal.timeout(10000)});
        data=await response.json();
        if(!response.ok || Number(data.status)!==200 || !Array.isArray(data.transactions))throw new Error('Invalid SePay response');
    } catch {throw problem(503,'Không kết nối được API đối soát SePay. Hãy thử lại sau.','BILLING_UNAVAILABLE');}
    const transfers=data.transactions.map(payload=>transferFromPayload(payload,'api')).filter(t=>t?.code===row.payment_code);
    for(const transfer of transfers)await settleOrderPaid(transfer);
    row=await getOrder(user,id);
    if(data.transactions.length>=5000 && !['paid','review_required'].includes(row.status))throw problem(503,'Danh sách giao dịch vượt giới hạn đối soát. Cần kiểm tra nhật ký SePay.','BILLING_RECONCILIATION_INCOMPLETE');
    return present(row);
}
module.exports={getPlansCatalog,present,createOrder,getOrder,listOrders,cancelOrder,parseDate,transferFromPayload,subscriptionForPayment,settleOrderPaid,verifyWebhookSecret,verifyOrderWithSepayApi};
