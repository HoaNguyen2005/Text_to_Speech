// Real transactions and concurrent clients; all fixtures live in a random schema.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {AsyncLocalStorage}=require('node:async_hooks');
if(!process.env.VIP_TEST_DATABASE_URL)throw new Error('Set VIP_TEST_DATABASE_URL explicitly to an application PostgreSQL test connection.');
process.env.DATABASE_URL=process.env.VIP_TEST_DATABASE_URL;
const original=require('../app/db/postgres');
const pool=original.getPool(),scope=new AsyncLocalStorage();
const schema='test_vip_'+crypto.randomBytes(10).toString('hex');
assert.match(schema,/^test_vip_[0-9a-f]{20}$/);
async function transaction(work){
    if(scope.getStore())return work(scope.getStore());
    const client=await pool.connect();
    try{
        await client.query('BEGIN');
        await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
        const value=await scope.run(client,()=>work(client));await client.query('COMMIT');return value;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
async function query(sql,params){
    try{return await (scope.getStore()?scope.getStore().query(sql,params):transaction(()=>query(sql,params)));}
    catch(error){if(error.code==='23505'){error.pgCode=error.code;error.code=11000;}throw error;}
}
require.cache[require.resolve('../app/db/postgres')].exports={...original,query,transaction};
const tiers=require('../app/services/account_tier.service');
const billing=require('../app/services/billing.service');
const Job=require('../app/models/book_job.model');
const voiceModel=require('../app/models/voice.model');
const id=()=>crypto.randomBytes(12).toString('hex');
let transactionId=100000;
Object.assign(process.env,{BILLING_ENABLED:'true',BILLING_DEMO_PRICES:'true',SEPAY_BANK_CODE:'MBBank',SEPAY_BANK_GATEWAY:'MBBank',SEPAY_ACCOUNT_NUMBER:'0123456789',SEPAY_ACCOUNT_NAME:'TEST ONLY',SEPAY_WEBHOOK_SECRET:'test-only-webhook-secret-32-characters',SEPAY_API_TOKEN:'test-only-token'});
async function newUser(account_class='free'){
    const key=id();
    return (await query(`INSERT INTO users(_id,email,"fullName",account_class,subscription_expires_at,subscription_cycle)
        VALUES($1,$2,'VIP test',$3,CASE WHEN $3='free' THEN NULL ELSE now()+interval '2 days' END,CASE WHEN $3='free' THEN NULL ELSE 'monthly' END) RETURNING *`,[key,key+'@example.invalid',account_class])).rows[0];
}
const orderFor=(user,plan_class='gold',billing_cycle='monthly')=>billing.createOrder(user,{plan_class,billing_cycle});
function transfer(order,changes={}){
    return {id:String(++transactionId),code:order.payment_code,amount:order.amount_vnd,date:new Date(),gateway:'MBBank',account:'0123456789',reference:'TEST-'+transactionId,...changes};
}
async function savedOrder(order){return (await query('SELECT * FROM payment_orders WHERE _id=$1',[order._id])).rows[0];}
async function savedUser(user){return (await query('SELECT * FROM users WHERE _id=$1',[user._id])).rows[0];}
async function main(){
    try{
        const admin=await pool.connect();
        try{
            await admin.query('BEGIN');await admin.query(`CREATE SCHEMA "${schema}"`);await admin.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
            const dir=path.join(__dirname,'../app/db');
            await admin.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
            await admin.query(fs.readFileSync(path.join(dir,'schema.sql'),'utf8'));
            for(const file of fs.readdirSync(path.join(dir,'migrations')).filter(f=>/^00[2-9]-.*\.sql$/.test(f)).sort())await admin.query(fs.readFileSync(path.join(dir,'migrations',file),'utf8'));
            // Redirect every explicit public reference in historical migration 010 to this local fixture.
            const prune=fs.readFileSync(path.join(dir,'migrations/20261111150624_prune_unused_legacy_schema.sql'),'utf8')
                .replaceAll('public.',schema+'.').replaceAll("table_schema='public'","table_schema='"+schema+"'");
            assert.ok(!prune.includes('public.'));
            await admin.query(prune);
            const roles=(await admin.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')")).rows;
            let split=fs.readFileSync(path.join(dir,'migrations/20261112030932_split_book_job_storage.sql'),'utf8');
            for(const role of ['anon','authenticated'])if(!roles.some(r=>r.rolname===role))split=split.replaceAll(', '+role,'');
            await admin.query(split);
            await admin.query(fs.readFileSync(path.join(dir,'migrations/20261118103750_account_subscriptions_billing.sql'),'utf8'));
            await admin.query('COMMIT');
        }catch(error){await admin.query('ROLLBACK');throw error;}finally{admin.release();}
        const user=await newUser(),other=await newUser();
        const results=await Promise.allSettled(Array.from({length:12},()=>tiers.consume(user,'lectures')));
        assert.equal(results.filter(r=>r.status==='fulfilled').length,5,'Concurrent requests cannot overspend the daily quota');
        assert.equal((await tiers.getUsageToday(user._id)).lectures_today,5);
        await query('DELETE FROM generated_lectures WHERE user_id=$1',[user._id]);
        await assert.rejects(tiers.consume(user,'lectures'),{code:'TIER_LIMIT'});
        const books=await Promise.allSettled(Array.from({length:5},()=>tiers.consume(user,'books')));
        assert.equal(books.filter(r=>r.status==='fulfilled').length,2);
        for(const kind of ['lectures','books'])assert.ok((await tiers.getUsageToday(other._id))[kind+'_today']===0);
        const localDate=(await query("SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS day")).rows[0].day;
        assert.equal((await query('SELECT usage_date::text AS day FROM account_usage_daily WHERE user_id=$1',[user._id])).rows[0].day,localDate);
        const expired=await newUser('gold');await query("UPDATE users SET subscription_expires_at=now()-interval '1 second' WHERE _id=$1",[expired._id]);
        assert.equal((await tiers.currentUser(expired)).account_class,'free');
        assert.equal((await savedUser(expired)).subscription_cycle,null);
        const manual=await tiers.setAccountClass(other._id,{account_class:'gold',duration_days:30});assert.equal(manual.subscription_cycle,'manual');
        await assert.rejects(tiers.setAccountClass(other._id,{account_class:'gold',duration_days:-1}),{status:400});
        await tiers.setAccountClass(other._id,{account_class:'free',duration_days:null});

        const owner=await newUser();
        const voices=await Promise.allSettled(Array.from({length:5},()=>tiers.withUserLock(owner,async current=>{
            await tiers.assertVoiceUploadAllowed(current);const key=id();return voiceModel.create({voice_id:key,name:'Test',gender:'male',file_path:'test/'+key,user_id:current._id});
        })));
        assert.equal(voices.filter(r=>r.status==='fulfilled').length,2);
        assert.equal((await tiers.getUsageToday(owner._id)).custom_voices,2);
        const job=await Job.create({user_id:owner._id,request_id:id(),title:'Test',source:'x'.repeat(500),source_hash:'test',target_minutes:1,voice_mode:'standard'});
        await assert.rejects(tiers.assertQueueAllowed(owner),{code:'TIER_LIMIT'});
        await Job.updateOne({_id:job._id},{$set:{delete_requested:true,status:'cancelled'}});await tiers.assertQueueAllowed(owner);

        const payer=await newUser(),order=await orderFor(payer);
        const receipt=transfer(order);
        const payments=await Promise.all(Array.from({length:8},()=>billing.settleOrderPaid(receipt)));
        assert.equal(payments.filter(p=>p.paid).length,1);
        assert.equal((await savedOrder(order)).status,'paid');
        const paid=await savedUser(payer),expiry=+new Date(paid.subscription_expires_at);
        assert.equal(paid.account_class,'gold');assert.ok(Math.abs(expiry-Date.now()-30*86400000)<5000);
        await billing.settleOrderPaid(receipt);assert.equal(+new Date((await savedUser(payer)).subscription_expires_at),expiry);
        const renewal=await orderFor(payer);await billing.settleOrderPaid(transfer(renewal));
        assert.equal(+new Date((await savedUser(payer)).subscription_expires_at),expiry+30*86400000);
        await assert.rejects(billing.getOrder(other,order._id),{status:404});
        await assert.rejects(billing.cancelOrder(other,order._id),{status:404});
        await assert.rejects(billing.listOrders(other,true),{status:403});
        const ignored=await orderFor(await newUser());await billing.settleOrderPaid(transfer(ignored,{id:receipt.id}));assert.equal((await savedOrder(ignored)).status,'pending');
        await billing.settleOrderPaid(transfer(ignored,{account:'wrong'}));assert.equal((await savedOrder(ignored)).status,'pending');
        await billing.settleOrderPaid(transfer(ignored,{gateway:'wrong'}));assert.equal((await savedOrder(ignored)).status,'pending');
        const insufficient=await orderFor(await newUser());await billing.settleOrderPaid(transfer(insufficient,{amount:insufficient.amount_vnd-1}));
        assert.equal((await savedOrder(insufficient)).gateway_payload.review_reason,'insufficient_amount');
        const cancel=await orderFor(await newUser());await billing.cancelOrder({_id:cancel.user_id},cancel._id);await billing.settleOrderPaid(transfer(cancel));
        assert.equal((await savedOrder(cancel)).gateway_payload.review_reason,'cancelled_order');
        const delayed=await orderFor(await newUser());await query(`UPDATE payment_orders SET "createdAt"=now()-interval '16 minutes',expires_at=now()-interval '1 minute',status='expired' WHERE _id=$1`,[delayed._id]);
        await billing.settleOrderPaid(transfer(delayed,{date:new Date(Date.now()-2*60000)}));assert.equal((await savedOrder(delayed)).status,'paid');
        const late=await orderFor(await newUser());await query(`UPDATE payment_orders SET "createdAt"=now()-interval '16 minutes',expires_at=now()-interval '1 minute' WHERE _id=$1`,[late._id]);
        await billing.settleOrderPaid(transfer(late));assert.equal((await savedOrder(late)).gateway_payload.review_reason,'late_payment');
        const clockSkewOrder = await orderFor(await newUser());
        const bankTransfer = transfer(clockSkewOrder, { date: new Date((await query('SELECT clock_timestamp() AS now')).rows[0].now) });
        const RealDate = global.Date;
        global.Date = class extends RealDate {
            constructor(...args) { super(...(args.length ? args : [RealDate.now() - 4 * 60000])); }
            static now() { return RealDate.now() - 4 * 60000; }
        };
        try { assert.equal((await billing.settleOrderPaid(bankTransfer)).paid, true); }
        finally { global.Date = RealDate; }
        const future = await orderFor(await newUser());
        const futureAt = new Date(+new Date((await query('SELECT clock_timestamp() AS now')).rows[0].now) + 5 * 60000);
        await billing.settleOrderPaid(transfer(future, { date: futureAt }));
        assert.equal((await savedOrder(future)).gateway_payload.review_reason, 'invalid_transaction_time');
        const upgraded=await newUser(),oldGold=await orderFor(upgraded),newDiamond=await orderFor(upgraded,'diamond');
        await billing.settleOrderPaid(transfer(newDiamond));const afterUpgrade=await savedUser(upgraded);
        await billing.settleOrderPaid(transfer(oldGold));assert.equal((await savedOrder(oldGold)).gateway_payload.review_reason,'higher_plan_active');
        assert.equal((await savedUser(upgraded)).account_class,'diamond');
        assert.equal(+new Date((await savedUser(upgraded)).subscription_expires_at),+new Date(afterUpgrade.subscription_expires_at));
        await assert.rejects(orderFor(afterUpgrade,'gold'),{code:'PLAN_DOWNGRADE'});
        const capped=await newUser();await Promise.all(Array.from({length:3},()=>orderFor(capped)));await assert.rejects(orderFor(capped),{code:'PENDING_ORDER_LIMIT'});

        const verifyUser=await newUser(),verifyOrder=await orderFor(verifyUser),fetchOriginal=global.fetch;let calls=0;
        global.fetch=async(url,options)=>{
            calls++;const u=new URL(url);assert.equal(u.origin,'https://my.sepay.vn');assert.equal(u.searchParams.get('limit'),'5000');assert.equal(u.searchParams.get('account_number'),'0123456789');assert.equal(options.headers.Authorization,'Bearer test-only-token');
            assert.match(u.searchParams.get('transaction_date_min'), /^\d{4}-\d{2}-\d{2} 00:00:00$/);
            assert.match(u.searchParams.get('transaction_date_max'), /^\d{4}-\d{2}-\d{2} 23:59:59$/);
            const time=new Date(Date.now()+7*3600000).toISOString().slice(0,19).replace('T',' ');
            return {ok:true,json:async()=>({status:200,transactions:[{id:String(++transactionId),bank_brand_name:'MBBank',account_number:'0123456789',transaction_date:time,amount_in:String(verifyOrder.amount_vnd),amount_out:'0.00',transaction_content:verifyOrder.payment_code,reference_number:'TEST API'}]})};
        };
        try{assert.equal((await billing.verifyOrderWithSepayApi(verifyUser,verifyOrder._id)).status,'paid');await billing.verifyOrderWithSepayApi(verifyUser,verifyOrder._id);assert.equal(calls,1);}finally{global.fetch=fetchOriginal;}
        const waitingUser=await newUser(),waitingOrder=await orderFor(waitingUser);calls=0;
        global.fetch=async()=>{calls++;return {ok:true,json:async()=>({status:200,transactions:[]})};};
        try{await billing.verifyOrderWithSepayApi(waitingUser,waitingOrder._id);await billing.verifyOrderWithSepayApi(waitingUser,waitingOrder._id);
            const another=await orderFor(waitingUser);await billing.verifyOrderWithSepayApi(waitingUser,another._id);
            assert.equal(calls,1,'Reconciliation is limited per account, including across different orders');}finally{global.fetch=fetchOriginal;}
        const busyUser=await newUser(),busyOrder=await orderFor(busyUser);
        global.fetch=async()=>({ok:true,json:async()=>({status:200,transactions:Array.from({length:5000},()=>({amount_in:'0'}))})});
        try{await assert.rejects(billing.verifyOrderWithSepayApi(busyUser,busyOrder._id),{code:'BILLING_RECONCILIATION_INCOMPLETE'});assert.equal((await savedOrder(busyOrder)).status,'pending');}finally{global.fetch=fetchOriginal;}
        const policies=(await query("SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace=$1::regnamespace AND relname IN ('account_usage_daily','payment_orders')",[schema])).rows;
        assert.equal(policies.length,2);assert.ok(policies.every(p=>p.relrowsecurity));
        const roles=(await query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')")).rows;
        for(const role of roles)for(const table of policies)assert.equal((await query('SELECT has_table_privilege($1,$2,$3) AS allowed',[role.rolname,schema+'.'+table.relname,'SELECT'])).rows[0].allowed,false);
        if(process.env.VIP_TEST_EXPORT_DIAGRAMS==='true')await require('./export_database_diagrams')(schema);
        await require('./lib/vip-api-checks')({query,newUser});
        console.log('PASS: real PostgreSQL migration/RLS, concurrent usage/voice/order caps, durable usage, expiry, owner checks, queue, idempotent concurrent payments, renewal, downgrade protection, late/cancelled/underpaid transfers and SePay API verification.');
    }finally{
        // The schema name is generated here and validated before it reaches SQL.
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await original.close();
    }
}
main().catch(error=>{console.error({name:error.name,code:error.code,message:error.message});process.exitCode=1;});
