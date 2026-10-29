// Small previews run in the HTTP service, independently of the heavy book worker.
// Only private Engine calls cross the boundary; no credentials reach the browser.
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const db = require('../db/postgres');
const { repository } = require('../db/repository');
const Preview = repository('book_previews');
const { WorkerLease } = require('../models/book_cache.model');
const Job = require('../models/book_job.model');
const User = require('../models/user.model');
const voices = require('./book_voice.service');
const providers = require('./tts_provider.service');
const { keycloakService } = require('./keycloak.service');
const config = require('../config/book');
const content = require('./book_content.service');
const speech = require('./speech.service');
const storage = require('./storage.service');
const TTL = 7 * 86400000, LEASE = 90000;
const problem = (status,message)=>Object.assign(new Error(message),{status});
const active = new Set();
const filenameFor=row=>`book-preview-${row.job_id}-preview_${content.hash(row.signature+row._id)}.mp3`;
function signature(job) {
    const reference=job.selected_voice?.file_path;
    let stamp='';
    if(reference && !storage.isStorageKey(reference)) {
        try {const stat=require('fs').statSync(path.resolve(__dirname,'../..',reference));stamp=`${stat.size}:${stat.mtimeMs}`;}
        catch {stamp='missing';}
    }
    return content.hash(JSON.stringify(['direct-preview-1',config.narrationVersion,job.voice_mode,job.selected_voice,
        stamp,job.draft?.style,job.draft?.speech,job.draft?.sections]));
}
async function cacheExists(row) {
    if(storage.isStorageKey(row.result?.audio_url))return true;
    try {await fs.access(path.resolve(__dirname,'../../public/audio/generated',filenameFor(row)));return true;}
    catch {return false;}
}
async function engine(endpoint,payload) {
    const response=await fetch(`${config.engineUrl}/book/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json','X-Book-Engine-Secret':config.engineSecret},
        body:JSON.stringify(payload),signal:AbortSignal.timeout(config.engineTimeout)});
    const result=await response.json();
    if(!response.ok) {
        // Only forward authored diagnostics from known private Engine failures.
        const detail=result.detail;
        const codes=new Set(['VOICE_SAMPLE_NOT_FOUND','VOICE_SAMPLE_ACCESS_DENIED','VOICE_SAMPLE_DOWNLOAD_FAILED','VOICE_SAMPLE_NETWORK','VOICE_SAMPLE_TOO_LARGE','VIENEU_SERVICE_ERROR','VIENEU_CONNECTION_FAILED']);
        const message=detail && typeof detail==='object' && codes.has(detail.code) && typeof detail.message==='string'
            ? detail.message:'Không tạo được đoạn nghe thử. Kiểm tra Engine và thử lại.';
        throw problem(503,message);
    }
    return result;
}
function localFile(id,file) {
    const resolved=path.resolve(file);
    if(path.dirname(resolved)!==path.join(config.artifactRoot,id))throw problem(503,'Đường dẫn nghe thử không hợp lệ.');
    return resolved;
}
async function allowed(job,user,identity=false) {
    const current=await Job.findOne({_id:job._id,user_id:user._id,status:'review',delete_requested:false,cancel_requested:false}).lean();
    if(!current || signature(current)!==signature(job))throw problem(409,'Bản tóm tắt đã đổi hoặc yêu cầu đã hủy. Đoạn nghe thử cũ được bỏ qua.');
    const owner=await User.findById(user._id).lean();
    if(!owner || owner.status!=='active' || owner.authSyncPending || owner.authProvisioning || !owner.keycloakId)throw problem(403,'Tài khoản không còn hoạt động.');
    if(identity) {
        const state=await keycloakService().identity(owner.keycloakId);
        if(!state.user.enabled || (state.user.attributes?.legacyStatus?.[0] && state.user.attributes.legacyStatus[0]!=='active'))throw problem(403,'Tài khoản không còn hoạt động.');
        user.role=state.role;
    }
    const voice=await voices.resolve(job.voice_mode,job.selected_voice.voice_id,user,job.selected_voice.provider);
    if(['file_path','gender','model_revision','preset'].some(k=>voice[k]!==job.selected_voice[k]) || voice.provider!==(job.selected_voice.provider||'edge'))throw problem(409,'Giọng mẫu đã đổi. Hãy tạo yêu cầu mới.');
}
async function describe(job) {
    if(!job.draft?.sections || job.workflow_version!=='review-v1')return null;
    const row=await Preview.findOne({job_id:job._id,user_id:job.user_id,signature:signature(job),expires_at:{$gt:new Date()}}).sort({expires_at:-1}).lean();
    if(!row || row.status==='pruning')return null;
    if(row.status==='ready' && !await cacheExists(row))return {status:'failed',error:'Lượt nghe thử bị gián đoạn. Hãy bấm nghe thử lại.'};
    if(row.status==='processing' && new Date(row.lease_until)<=new Date())return {status:'failed',error:'Lượt nghe thử bị gián đoạn. Hãy bấm nghe thử lại.'};
    return row.status==='ready'?{status:'ready',...row.result}:{status:row.status,error:row.error||''};
}
async function request(job,user) {
    await allowed(job,user,true);
    const sig=signature(job),owner=crypto.randomUUID();
    // One preview at a time bounds CPU pressure across API processes. It never
    // waits for the book queue, and duplicate requests share the persisted row.
    const claimed=await db.transaction(async()=>{
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended('book-preview-admission',0))");
        const existing=await Preview.findOne({job_id:job._id,signature:sig,expires_at:{$gt:new Date()}}).sort({expires_at:-1}).lean();
        if(existing?.status==='ready' && await cacheExists(existing))return null;
        if(existing?.status==='processing' && new Date(existing.lease_until)>new Date())return null;
        let lease;
        try {lease=await WorkerLease.findOneAndUpdate({_id:'book-preview-engine',until:{$lte:new Date()}},{$set:{owner,until:new Date(Date.now()+LEASE)}},{upsert:true});}
        catch(error){if(error.code!==11000)throw error;}
        if(!lease)throw problem(429,'Một đoạn nghe thử đang được tạo. Hãy chờ hoàn tất rồi thử lại.');
        if(existing && existing.status!=='pruning')await Preview.updateOne({_id:existing._id},{$set:{expires_at:new Date(),status:'failed',lease_until:new Date(0)}});
        // Every attempt owns a new scratch ID and output filename. A late old
        // process can never clean up or overwrite a retried preview's files.
        return Preview.create({job_id:job._id,signature:sig,user_id:user._id,status:'processing',owner,
            lease_until:new Date(Date.now()+LEASE),expires_at:new Date(Date.now()+TTL),result:null,error:''});
    });
    if(claimed) {
        // Start after admission commits, with an attached rejection handler.
        const promise=render(claimed,job,{...user}).catch(error=>console.warn('[BOOK PREVIEW]',error.status||error.name));
        active.add(promise);promise.finally(()=>active.delete(promise));
    }
    return describe(job);
}
async function render(row,job,user) {
    let heartbeat,lost=false,published=false,lastIdentity=0,renewing=false;
    const filename=filenameFor(row);
    const key=`generated/${filename}`,destination=path.resolve(__dirname,'../../public/audio/generated',filename);
    async function guard() {
        if(lost)throw problem(409,'Lượt nghe thử đã hết quyền xử lý. Hãy thử lại.');
        if(signature(job)!==row.signature)throw problem(409,'Giọng mẫu đã đổi. Hãy tạo yêu cầu mới.');
        const identity=Date.now()-lastIdentity>60000;
        await allowed(job,user,identity);
        if(identity)lastIdentity=Date.now();
    }
    async function renew() {
        if(renewing)return;renewing=true;
        try {
            await guard();
            const until=new Date(Date.now()+LEASE);
            const a=await WorkerLease.updateOne({_id:'book-preview-engine',owner:row.owner,until:{$gt:new Date()}},{$set:{until}});
            const b=await Preview.updateOne({_id:row._id,owner:row.owner,status:'processing',lease_until:{$gt:new Date()}},{$set:{lease_until:until}});
            if(!a.matchedCount||!b.matchedCount)lost=true;
        } catch {lost=true;} finally {renewing=false;}
    }
    try {
        heartbeat=setInterval(renew,10000);
        await guard();
        const draft=job.draft,voice=job.selected_voice;
        const parts=draft.speech?speech.plan({provider:voice.provider||'edge',sections:draft.sections,speech:draft.speech,style:draft.style}).parts:content.narration('',draft.sections,draft.style);
        let remaining=30;const ids=[];
        for(const part of parts.slice(0,8)) {
            if(remaining<=0)break;
            await guard();
            const words=part.text.split(/\s+/u).filter(Boolean);
            const limit=Math.max(1,Math.floor(Math.max(0,remaining-part.pause_ms/1000)*300*(1+part.rate_percent/100)/60));
            const sample={...part,text:speech.clipText(part.text,limit),pause_ms:words.length>limit?0:part.pause_ms};
            const id=content.hash(JSON.stringify(sample));
            const audio=await engine('part',{job_id:row._id,part_id:id,text:sample.text,mode:job.voice_mode,gender:voice.gender,style:draft.style,
                reference_key:row.signature,...providers.settings(voice.provider||'edge',voice.preset,voice.model_revision),
                reference_file:voice.file_path?path.basename(voice.file_path):undefined,
                reference_audio_url:job.voice_mode==='clone'&&storage.isStorageKey(voice.file_path)?await storage.resolveUrl(voice.file_path):undefined,
                rate_percent:sample.rate_percent,pitch_hz:sample.pitch_hz,pause_ms:sample.pause_ms,interactive:true,
                ...(sample.experimental_cues ? {experimental_cues:true} : {})});
            localFile(row._id,audio.output_path);
            if(!Number.isFinite(audio.duration_seconds)||audio.duration_seconds<=0)throw problem(503,'Đoạn nghe thử thiếu thời lượng.');
            ids.push(id);remaining-=audio.duration_seconds;
        }
        await guard();
        const merged=await engine('merge',{job_id:row._id,part_ids:ids,interactive:true});
        const digest=path.basename(localFile(row._id,merged.output_path)).match(/^final_([a-f0-9]{64})[.]mp3$/)?.[1];
        if(!digest)throw problem(503,'Đường dẫn nghe thử không hợp lệ.');
        const clip=await engine('preview',{job_id:row._id,part_id:digest,merged:true});
        const file=localFile(row._id,clip.output_path);
        if(!Number.isFinite(clip.duration_seconds)||clip.duration_seconds<=0||clip.duration_seconds>30.2)throw problem(503,'Thời lượng nghe thử không hợp lệ.');
        await guard();
        // Track before writing so even a partial publish is cleaned on failure.
        published=true;
        if(storage.isR2Enabled())await storage.uploadFile(file,key,'audio/mpeg');
        else {await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(file,destination);}
        await guard();
        const result={audio_url:storage.isR2Enabled()?key:`${(process.env.PUBLIC_BACKEND_URL||'http://localhost:3000').replace(/\/$/,'')}/public/audio/generated/${filename}`,
            duration_seconds:Math.min(30,clip.duration_seconds),content_hash:content.textHash(draft.sections),speech_plan_hash:draft.speech?speech.plan({introduction:draft.introduction||'',sections:draft.sections,speech:draft.speech,style:draft.style}).hash:null};
        const updated=await Preview.updateOne({_id:row._id,owner:row.owner,status:'processing',lease_until:{$gt:new Date()}},{$set:{status:'ready',result,error:'',lease_until:new Date(0)}});
        if(!updated.matchedCount)throw problem(409,'Lượt nghe thử đã hết quyền xử lý.');
        published=false;
        await db.query(`UPDATE book_previews SET expires_at=now() WHERE _id IN
            (SELECT _id FROM book_previews WHERE job_id=$1 AND status='ready' ORDER BY expires_at DESC,_id DESC OFFSET 5)`,[job._id]);
        console.log(`[BOOK PREVIEW] job=${job._id} cache=stored`);
    } catch(error) {
        await Preview.updateOne({_id:row._id,owner:row.owner,status:'processing'},{$set:{status:'failed',error:error.status?error.message:'Không tạo được đoạn nghe thử. Kiểm tra Engine và thử lại.',lease_until:new Date(0)}});
    } finally {
        clearInterval(heartbeat);
        // Unique scratch ID prevents preview cleanup from touching full-book parts.
        try {await engine('cleanup',{job_id:row._id});}catch {console.warn('[BOOK PREVIEW] Chưa dọn được file tạm.');}
        if(published) {if(storage.isR2Enabled())await storage.deleteFile(key).catch(()=>{});else await fs.unlink(destination).catch(()=>{});}
        await WorkerLease.updateOne({_id:'book-preview-engine',owner:row.owner},{$set:{until:new Date(0)}});
    }
}
async function prune(jobId) {
    const rows=await Preview.find(jobId?{job_id:jobId}:{expires_at:{$lte:new Date()}}).limit(10).lean();
    for(const row of rows) {
        if(row.status==='processing'&&new Date(row.lease_until)>new Date())continue;
        // Match the previous lease too: an expired row may have just been retried.
        const claimed=await Preview.findOneAndUpdate({_id:row._id,owner:row.owner,status:row.status,lease_until:row.lease_until},{$set:{status:'pruning'}});
        if(!claimed)continue;
        try {
            await engine('cleanup',{job_id:row._id});
            const filename=filenameFor(row);
            if(storage.isR2Enabled())await storage.deleteFile(`generated/${filename}`);
            else await fs.unlink(path.resolve(__dirname,'../../public/audio/generated',filename)).catch(error=>{if(error.code!=='ENOENT')throw error;});
            await Preview.deleteMany({_id:row._id,status:'pruning'});
        } catch {console.warn('[BOOK PREVIEW] Cache chờ dọn ở lượt sau.');}
    }
    return jobId?!await Preview.exists({job_id:jobId}):true;
}
module.exports={request,describe,prune,signature};
