const assert=require('node:assert/strict');
const tiers=require('../app/services/account_tier.service');
const billing=require('../app/services/billing.service');
const free={_id:'a'.repeat(24),account_class:'free',role:'user'};
const gold={...free,account_class:'gold',subscription_expires_at:'2030-01-01T00:00:00Z'};
const diamond={...gold,account_class:'diamond'};
async function main(){
    assert.equal(tiers.effectiveClass({...gold,subscription_expires_at:'2000-01-01'}),'free');
    assert.equal(tiers.effectiveClass({...free,role:'admin'}),'diamond');
    assert.equal(tiers.limits({...free,role:'admin'}).lecturesPerDay,null);
    for(const [user,max] of [[free,5000],[gold,12000],[diamond,20000]]){
        tiers.assertLectureAllowed(user,max);
        assert.throws(()=>tiers.assertLectureAllowed(user,max+1),{code:'TIER_LIMIT'});
        tiers.assertBookSubmissionAllowed(user,{textLength:tiers.limits(user).bookChars,targetMinutes:tiers.limits(user).bookMinutes});
        assert.throws(()=>tiers.assertBookSubmissionAllowed(user,{textLength:1,targetMinutes:tiers.limits(user).bookMinutes+1}),{code:'TIER_LIMIT'});
    }
    assert.equal(tiers.canUseVoice(free,{class:'free'},'vieneu','clone'),false);
    assert.equal(tiers.canUseVoice(free,{class:'free',is_global:true},'vieneu','clone'),true);
    assert.equal(tiers.canUseVoice(gold,{class:'gold'},'vieneu','clone'),true);
    assert.equal(tiers.canUseVoice(gold,{class:'diamond'},'edge','clone'),false);
    assert.equal(tiers.canUseVoice(diamond,{class:'unknown'},'edge','clone'),false);
    assert.throws(()=>tiers.assertBookReviseAllowed(free,{revision_requests:2}),{code:'TIER_LIMIT'});
    assert.throws(()=>tiers.assertBookReviseAllowed(gold,{revision_requests:8}),{code:'TIER_LIMIT'});
    tiers.assertBookReviseAllowed(diamond,{revision_requests:100});

    const now=new Date('2026-11-18T10:00:00Z'),order={plan_class:'gold',duration_days:30,billing_cycle:'monthly'};
    const first=billing.subscriptionForPayment(free,order,now);
    assert.equal(+first.subscription_expires_at,+now+30*86400000);
    const renewed=billing.subscriptionForPayment({...gold,subscription_expires_at:new Date(+now+5*86400000)},order,now);
    assert.equal(+renewed.subscription_expires_at,+now+35*86400000);
    assert.equal(billing.subscriptionForPayment(diamond,order,now).review_reason,'higher_plan_active');
    assert.equal(billing.subscriptionForPayment({...gold,subscription_expires_at:null},order,now).review_reason,'permanent_plan');
    assert.equal(billing.parseDate('2026-11-18 17:00:00').toISOString(),now.toISOString());
    assert.equal(billing.parseDate('2026-02-30 17:00:00'),null);
    assert.equal(billing.parseDate('2026-11-18T10:00:00Z'),null);
    const payload={id:123,gateway:'MBBank',accountNumber:'0123456789',content:'Thanh toan TTSAABBCCDD',transferAmount:29000,transferType:'in',transactionDate:'2026-11-18 17:00:00'};
    assert.equal(billing.transferFromPayload(payload).code,'TTSAABBCCDD');
    for(const bad of [{transferType:'out'},{id:null},{transferAmount:-1},{transferAmount:0.1},{transactionDate:'bad'},{content:'TTSAABBCCDD TTS11223344'},{content:'XT TSAABBCCDD'},{content:'TTSAABBCCDD123'}]) assert.equal(billing.transferFromPayload({...payload,...bad}),null);
    process.env.BILLING_ENABLED='false';
    await assert.rejects(billing.createOrder(free,order),{code:'BILLING_NOT_CONFIGURED'});
    assert.throws(()=>billing.verifyWebhookSecret('Apikey bad'),{code:'BILLING_NOT_CONFIGURED'});
    Object.assign(process.env,{BILLING_ENABLED:'true',SEPAY_BANK_CODE:'MBBank',SEPAY_BANK_GATEWAY:'MBBank',SEPAY_ACCOUNT_NUMBER:'0123456789',SEPAY_ACCOUNT_NAME:'TEST ONLY',SEPAY_WEBHOOK_SECRET:'test-only-webhook-secret-32-characters',BILLING_DEMO_PRICES:'false'});
    assert.throws(()=>billing.verifyWebhookSecret('Apikey wrong'),{status:401});
    assert.throws(()=>billing.verifyWebhookSecret(undefined),{status:401});
    billing.verifyWebhookSecret('Apikey '+process.env.SEPAY_WEBHOOK_SECRET);
    assert.equal(billing.getPlansCatalog().plans.find(p=>p.plan_class==='gold'&&p.billing_cycle==='monthly').amount_vnd,29000);
    process.env.BILLING_DEMO_PRICES='true';
    assert.equal(billing.getPlansCatalog().plans.find(p=>p.plan_class==='gold'&&p.billing_cycle==='monthly').amount_vnd,2000);

    const app=require('express')();app.use(require('express').json());app.use('/api/billing',require('../app/routes/billing.route'));
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const endpoint=`http://127.0.0.1:${server.address().port}/api/billing`;
    try{
        const bad=await fetch(endpoint+'/webhook/sepay',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Apikey invalid'},body:JSON.stringify(payload)});assert.equal(bad.status,401);
        const out=await fetch(endpoint+'/webhook/sepay',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Apikey '+process.env.SEPAY_WEBHOOK_SECRET},body:JSON.stringify({...payload,transferType:'out'})});assert.equal(out.status,200);assert.deepEqual(await out.json(),{success:true});
        const unauthorized=await fetch(endpoint+'/orders');assert.equal(unauthorized.status,401);
    }finally{await new Promise(resolve=>server.close(resolve));}
    console.log('PASS: tier limits, expiry, providers, renewal/downgrade rules, untrusted payment validation, disabled billing and webhook authentication.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
