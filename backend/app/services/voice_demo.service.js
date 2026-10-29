const fs=require('fs/promises'),path=require('path'),crypto=require('crypto');
const config=require('../config/book'),providers=require('./tts_provider.service');
const {WorkerLease}=require('../models/book_cache.model');
const problem=(status,message)=>Object.assign(new Error(message),{status});
const directory=path.resolve(__dirname,'../../public/audio/generated');
async function engine(endpoint,payload) {
    const response=await fetch(`${config.engineUrl}/book/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json','X-Book-Engine-Secret':config.engineSecret},body:JSON.stringify(payload),signal:AbortSignal.timeout(config.engineTimeout)});
    const result=await response.json();
    if(!response.ok)throw problem(503,'Không tạo được giọng nghe mẫu. Hãy thử lại.');
    return result;
}
function checked(id,file) {
    const resolved=path.resolve(file);
    if(path.dirname(resolved)!==path.join(config.artifactRoot,id))throw problem(503,'Không tạo được giọng nghe mẫu. Hãy thử lại.');
    return resolved;
}
async function sample(provider,id) {
    providers.validate(provider);
    const voice=config.standardVoices.find(v=>v.voice_id===id&&(v.provider||'edge')===provider);
    if(!voice)throw problem(404,'Không tìm thấy giọng đọc.');
    const text='Xin chào! Đây là giọng đọc bạn đang nghe thử. Chúc bạn một ngày tốt lành.';
    const options=providers.settings(provider,voice.preset,voice.model_revision);
    const hash=crypto.createHash('sha256').update(JSON.stringify(['voice-demo-1',text,voice,options])).digest('hex');
    const output=path.join(directory,`voice-demo-${hash}.mp3`);
    try {await fs.access(output);return output;}catch{}
    const owner=crypto.randomUUID(),jobId=crypto.randomBytes(12).toString('hex');
    let claimed,lost=false;
    try {claimed=await WorkerLease.findOneAndUpdate({_id:'voice-preset-demo',until:{$lte:new Date()}},{$set:{owner,until:new Date(Date.now()+90000)}},{upsert:true});}
    catch(error){if(error.code!==11000)throw error;}
    if(!claimed)throw problem(429,'Một giọng nghe mẫu đang được chuẩn bị. Hãy thử lại sau.');
    const heartbeat=setInterval(()=>WorkerLease.updateOne({_id:'voice-preset-demo',owner,until:{$gt:new Date()}},{$set:{until:new Date(Date.now()+90000)}}).then(result=>{if(!result.matchedCount)lost=true;}).catch(()=>{lost=true;}),10000);
    const temporary=`${output}.${owner}.tmp`;
    try {
        const audio=await engine('part',{job_id:jobId,part_id:hash,text,mode:'standard',gender:voice.gender,style:'normal',reference_key:hash,...options,rate_percent:0,pitch_hz:0,pause_ms:0,interactive:true});
        checked(jobId,audio.output_path);
        const clip=await engine('preview',{job_id:jobId,part_id:hash});
        const file=checked(jobId,clip.output_path);
        if(lost || !await WorkerLease.exists({_id:'voice-preset-demo',owner,until:{$gt:new Date()}}))throw problem(503,'Lượt nghe mẫu đã bị gián đoạn. Hãy thử lại.');
        await fs.mkdir(directory,{recursive:true});await fs.copyFile(file,temporary);await fs.rename(temporary,output);
        return output;
    }finally{
        clearInterval(heartbeat);await fs.unlink(temporary).catch(()=>{});
        await engine('cleanup',{job_id:jobId}).catch(()=>{});
        await WorkerLease.updateOne({_id:'voice-preset-demo',owner},{$set:{until:new Date(0)}});
    }
}
module.exports={sample};
