const assert=require('node:assert/strict');
const crypto=require('node:crypto');
module.exports=async function checks({query,newUser}){
    const auth=require('../../app/middlewares/auth.middleware');
    const originalVerify=auth.verifyToken;
    auth.verifyToken=async(req,res,next)=>{
        const user=(await query('SELECT * FROM users WHERE _id=$1',[req.get('X-Test-User')||''])).rows[0];
        if(!user)return res.status(401).json({error:'Test authentication required'});
        req.user=user;next();
    };
    const config=require('../../app/config/book'),oldSecret=config.engineSecret;
    const duration=require('../../app/services/book_duration.service'),oldCheck=duration.checkSource;
    config.engineSecret='test-only-no-engine';duration.checkSource=async()=>null;
    const app=require('express')();app.use(require('express').json());
    app.use('/api/book-jobs',require('../../app/routes/book.route'));
    app.use('/api/auth',require('../../app/routes/auth.route'));
    app.use('/api/billing',require('../../app/routes/billing.route'));
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    async function request(user,path,body,method){
        const response=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(user?{'X-Test-User':user._id}:{})},...(body?{body:JSON.stringify(body)}:{})});
        return {status:response.status,body:await response.json()};
    }
    try{
        const user=await newUser();
        const body={text:'Nội dung kiểm thử '.repeat(100),title:'VIP test',target_minutes:1,voice_mode:'standard',voice_id:'standard-female',tts_provider:'edge',request_id:crypto.randomUUID()};
        const me=await request(user,'/api/auth/me');assert.equal(me.status,200);assert.equal(me.body.tier_info.limits.bookMinutes,15);
        assert.equal((await request(null,'/api/book-jobs')).status,401);
        assert.equal((await request(user,'/api/book-jobs',{...body,target_minutes:16})).status,403);
        const parallel=await Promise.all([request(user,'/api/book-jobs',body),request(user,'/api/book-jobs',{...body,request_id:crypto.randomUUID()})]);
        assert.ok(parallel.every(r=>[202,409,429].includes(r.status)),'Concurrent admission must not become an internal server error');
        const accepted=parallel.find(r=>r.status===202);assert.ok(accepted);assert.equal(parallel.filter(r=>r.status===202).length,1);
        // The public response omits request IDs; retry the actual accepted fixture by its SQL request ID.
        const saved=(await query('SELECT request_id FROM book_job_requests WHERE _id=$1',[accepted.body._id])).rows[0];
        const repeated=await request(user,'/api/book-jobs',{...body,request_id:saved.request_id});assert.equal(repeated.status,200);assert.equal(repeated.body._id,accepted.body._id);
        assert.equal((await request(user,'/api/auth/me')).body.tier_info.usage.books_today,1);
        const outsider=await newUser();assert.equal((await request(outsider,'/api/book-jobs/'+accepted.body._id)).status,404);
        assert.equal((await request(user,'/api/book-jobs/'+accepted.body._id,null,'DELETE')).status,202);
        const second=await request(user,'/api/book-jobs',{...body,request_id:crypto.randomUUID()});assert.equal(second.status,202);
        await request(user,'/api/book-jobs/'+second.body._id,null,'DELETE');
        const third=await request(user,'/api/book-jobs',{...body,request_id:crypto.randomUUID()});assert.equal(third.status,429);assert.equal(third.body.code,'TIER_LIMIT');
        assert.equal((await request(user,'/api/auth/me')).body.tier_info.usage.books_today,2);

        const editor=await newUser(),Job=require('../../app/models/book_job.model');
        const selected=await require('../../app/services/book_voice.service').resolve('standard','standard-female',editor,'edge');
        const job=await Job.create({user_id:editor._id,request_id:crypto.randomUUID(),title:'Review test',source:body.text,source_hash:'test',target_minutes:1,voice_mode:'standard',selected_voice:selected,
            status:'review',workflow_version:'review-v1',draft_revision:1,draft:{sections:[{title:'Mục',text:body.text}],style:'normal'},checkpoint:{revision_requests:0}});
        for(let i=1;i<=2;i++){
            const revised=await request(editor,`/api/book-jobs/${job._id}/revise`,{revision:i,instruction:'Viết rõ ràng hơn'});
            assert.equal(revised.status,202);assert.equal(revised.body.ai_revisions,i);
            await Job.updateOne({_id:job._id},{$set:{status:'review',draft_revision:i+1}});
        }
        const exhausted=await request(editor,`/api/book-jobs/${job._id}/revise`,{revision:3,instruction:'Viết rõ ràng hơn'});assert.equal(exhausted.status,403);assert.equal(exhausted.body.code,'TIER_LIMIT');
        const voice=await require('../../app/models/voice.model').create({voice_id:'vip-test-'+crypto.randomUUID(),name:'Private',gender:'male',file_path:'test-only',user_id:editor._id});
        const locked=await request(editor,'/api/book-jobs',{...body,voice_mode:'clone',voice_id:voice.voice_id,tts_provider:'vieneu',request_id:crypto.randomUUID()});assert.equal(locked.status,403);
        const catalog=await request(editor,'/api/book-jobs/voices?provider=vieneu');assert.equal(catalog.body.voices.find(v=>v.voice_id===voice.voice_id).usable,false);
        assert.equal((await request(user,'/api/billing/admin/orders')).status,403);
        assert.equal((await request(user,`/api/auth/users/${editor._id}/account-class`,{account_class:'diamond',duration_days:30},'PUT')).status,403);
        console.log('PASS: authenticated APIs enforce book duration/queue/daily limits, idempotent submission, owner isolation, revision limits, private VieNeu access and admin-only billing/tier changes.');
    }finally{
        auth.verifyToken=originalVerify;config.engineSecret=oldSecret;duration.checkSource=oldCheck;await new Promise(resolve=>server.close(resolve));
    }
};
