const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const speech = require('./speech.service');
const storage = require('./storage.service');
const config = require('../config/book');
const User = require('../models/user.model');
const History = require('../models/generated_lecture.model');
const providers = require('./tts_provider.service');
const problem = (status,message) => Object.assign(new Error(message),{status});
let running = 0;
async function engine(endpoint,payload) {
    const response=await fetch(`${config.engineUrl}/book/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json','X-Book-Engine-Secret':config.engineSecret},body:JSON.stringify(payload),signal:AbortSignal.timeout(config.engineTimeout)});
    const result=await response.json();
    if (!response.ok) throw problem(503,typeof result.detail==='string'?result.detail:result.detail?.message||'Engine chưa sẵn sàng.');
    return result;
}
function localFile(id,file) {
    const directory=path.resolve(config.artifactRoot,id),resolved=path.resolve(file);
    if(path.dirname(resolved)!==directory || !/^[a-z0-9_.-]+$/.test(path.basename(resolved)))throw problem(503,'Đường dẫn âm thanh không hợp lệ.');
    return resolved;
}
async function render(user,body,preview=false) {
    if(running>=1)throw problem(429,'Một bài giảng đang được tạo. Hãy chờ hoàn tất rồi thử lại.');
    if(typeof body.text!=='string'||!body.text.trim()||body.text.length>20000)throw problem(400,'Bài giảng cần từ 1 đến 20.000 ký tự.');
    if(!config.engineSecret)throw problem(503,'Chưa cấu hình kết nối Engine.');
    const provider=providers.validate(body.tts_provider);
    const planned=speech.plan({provider,sections:[{text:body.text,delivery:{...(body.delivery||{}),markup:body.text}}],speech:body.speech,style:body.style_id||'normal'});
    if(body.speech_plan_hash!==planned.hash)throw problem(409,'Hãy xem cách đọc sau khi thay đổi nội dung hoặc cấu hình trước khi tiếp tục.');
    if(planned.estimated_seconds>=3600 || planned.parts.length>80)throw problem(400,'Bài giảng quá dài hoặc có quá nhiều đoạn. Hãy chia thành các phần nhỏ hơn.');
    // Old lecture callers are clone-only. New catalogue choices specify the
    // internal mode, independently of the system/user display group.
    const mode=body.voice_mode||'clone';
    const voice=await require('./book_voice.service').resolve(mode,body.teacher_id,user,provider);
    const jobId=crypto.randomBytes(12).toString('hex'),timings=[],parts=[];
    const published=[];
    if(running>=1)throw problem(429,'Một bài giảng đang được tạo. Hãy chờ hoàn tất rồi thử lại.');
    running++;
    let historySaved=false, prefetch;
    async function guard() {
        if(!await User.exists({_id:user._id,status:'active',authSyncPending:false}))throw problem(403,'Tài khoản không hoạt động hoặc đang chờ đồng bộ.');
        const available=await require('./book_voice.service').resolve(mode,voice.voice_id,user,provider);
        if(available.file_path!==voice.file_path || available.gender!==voice.gender || available.model_revision!==voice.model_revision)throw problem(403,'Giọng mẫu đã thay đổi hoặc bạn không còn quyền sử dụng.');
    }
    async function payload(current) {
        const settings=providers.settings(provider,voice.preset,voice.model_revision);
        const partId=crypto.createHash('sha256').update(JSON.stringify([mode,voice.voice_id,voice.file_path,current,settings])).digest('hex');
        return {job_id:jobId,part_id:partId,text:current.text,mode,gender:voice.gender,style:'normal',
            ...settings, reference_key:voice.file_path||voice.voice_id,reference_file:voice.file_path?path.basename(voice.file_path):undefined,
            reference_audio_url:mode==='clone'&&storage.isStorageKey(voice.file_path)?await storage.resolveUrl(voice.file_path):undefined,
            rate_percent:current.rate_percent,pitch_hz:0,pause_ms:current.pause_ms,
            ...(current.experimental_cues ? {experimental_cues:true} : {})};
    }
    try {
        if(!preview)prefetch=await require('./edge_prefetch.service')({jobId,provider,parts:planned.parts,payload,guard});
        let previewBudget=30;
        for(const [index,part] of planned.parts.entries()) {
            if(preview && (previewBudget<=0 || parts.length>=8))break;
            await guard();
            let current=part;
            if(preview && part.text) {
                const words=part.text.split(/\s+/u),limit=Math.max(1,Math.floor(Math.max(0,previewBudget-part.pause_ms/1000)*300*(1+part.rate_percent/100)/60));
                current={...part,text:speech.clipText(part.text,limit),pause_ms:words.length>limit?0:part.pause_ms};
            }
            if(prefetch){await prefetch.ready(index);prefetch.advance(index+1);}
            const request=await payload(current),partId=request.part_id;
            const audio=await engine('part',request);
            await guard();
            localFile(jobId,audio.output_path);
            if(!Number.isFinite(audio.duration_seconds)||audio.duration_seconds<=0)throw problem(503,'Đoạn âm thanh thiếu thời lượng.');
            parts.push({...current,part_id:partId});timings.push(audio);previewBudget-=audio.duration_seconds;
            if(timings.reduce((sum,t)=>sum+t.duration_seconds,0)>=3600)throw problem(400,'Âm thanh đạt 1 giờ. Hãy rút gọn nội dung.');
        }
        const merged=await engine('merge',{job_id:jobId,part_ids:parts.map(part=>part.part_id)});
        let file=localFile(jobId,merged.output_path);
        if(preview) {
            const digest=path.basename(file).match(/^final_([a-f0-9]{64})[.]mp3$/)?.[1];
            if(!digest)throw problem(503,'Đường dẫn âm thanh không hợp lệ.');
            const clip=await engine('preview',{job_id:jobId,part_id:digest,merged:true});
            return {buffer:await fs.readFile(localFile(jobId,clip.output_path)),duration_seconds:clip.duration_seconds};
        }
        if(!Number.isFinite(merged.duration_seconds)||merged.duration_seconds>=3600)throw problem(400,'Âm thanh đạt 1 giờ. Hãy rút gọn nội dung.');
        async function publish(source,type) {
            const name=`studio-${jobId}-${path.basename(source)}`,key=`generated/${name}`;
            if(storage.isR2Enabled()){published.push(key);await storage.uploadFile(source,key,type);return key;}
            const directory=path.resolve(__dirname,'../../public/audio/generated');await fs.mkdir(directory,{recursive:true});
            const destination=path.join(directory,name);await fs.copyFile(source,destination);published.push(destination);
            return `${(process.env.PUBLIC_BACKEND_URL||'http://localhost:3000').replace(/\/$/,'')}/public/audio/generated/${name}`;
        }
        const subtitle=file.replace(/[.]mp3$/,'.srt');
        await fs.writeFile(subtitle,speech.subtitles(parts,timings),'utf8');
        const audioUrl=await publish(file,'audio/mpeg'),subtitleUrl=await publish(subtitle,'application/x-subrip; charset=utf-8');
        const saved=await History.create({user_id:user._id,text:planned.sections[0].text,teacher_id:voice.voice_id,style_id:planned.speech.profile,
            audio_url:audioUrl,subtitle_url:subtitleUrl,subtitle_timing:'estimated-within-measured-segments',duration_seconds:merged.duration_seconds,
            speech_config:{...planned.speech,...providers.settings(provider,voice.preset,voice.model_revision),voice_origin:voice.origin,voice_mode:mode,deliveries:planned.sections.map(section=>section.delivery)}});
        historySaved=true;
        return {status:'success',history_id:saved._id,audio_url:await storage.resolveUrl(audioUrl),subtitle_url:await storage.resolveUrl(subtitleUrl),subtitle_timing:saved.subtitle_timing,duration_seconds:merged.duration_seconds};
    } finally {
        if(prefetch)await prefetch.close();
        running--;
        if(!historySaved)for(const item of published) {
            if(storage.isStorageKey(item))await storage.deletePendingStudioFile(item).catch(()=>{});
            else if(path.dirname(item)===path.resolve(__dirname,'../../public/audio/generated')&&path.basename(item).startsWith(`studio-${jobId}-`))await fs.unlink(item).catch(()=>{});
        }
        await engine('cleanup',{job_id:jobId}).catch(()=>console.warn('[SPEECH] Chưa dọn xong thư mục của lượt tạo bài giảng.'));
    }
}
module.exports={render};
