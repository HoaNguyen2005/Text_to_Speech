const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const speech = require('./speech.service');
const storage = require('./storage.service');
const config = require('../config/book');
const History = require('../models/generated_lecture.model');
const providers = require('./tts_provider.service');
const artifact = require('./engine_artifact.service');
const tiers = require('./account_tier.service');
const problem = (status,message) => Object.assign(new Error(message),{status});
let running = 0;
let activeGeneration;

function cancel(user, jobId) {
    const generation = activeGeneration;
    if (!generation || generation.jobId !== jobId || generation.owner !== String(user._id)) {
        throw problem(404, 'Không tìm thấy yêu cầu tạo âm thanh đang chạy.');
    }
    if (generation.saving) throw problem(409, 'Âm thanh đang được lưu vào lịch sử. Hãy chờ hoàn tất.');
    generation.controller.abort();
}

async function engine(endpoint,payload,signal) {
    const route = `/book/${endpoint}`;
    const request = () => {
        signal?.throwIfAborted();
        const timeout = AbortSignal.timeout(config.engineTimeout);
        return { method:'POST', headers:{'Content-Type':'application/json','X-Book-Engine-Secret':config.engineSecret},
            body:JSON.stringify(payload), signal:signal ? AbortSignal.any([signal, timeout]) : timeout };
    };
    const started = Date.now();
    let { response, engineUrl } = await artifact.fetchWithFailover(route, request, { jobId: payload.job_id });
    if (response.status === 524 && (endpoint === 'part' || endpoint === 'merge')) {
        // Cloudflare can time out while the engine is still writing the artifact. Only that node can reuse it.
        await response.body?.cancel().catch(() => {});
        console.warn(`[SPEECH ENGINE] ${endpoint} HTTP 524 after ${Date.now()-started}ms; retrying same node`);
        response = await fetch(`${engineUrl}${route}`, request());
    }
    const result=await response.json().catch(()=>({}));
    if (!response.ok) {
        console.warn(`[SPEECH ENGINE] ${endpoint} HTTP ${response.status} after ${Date.now()-started}ms`);
        if (response.status === 524) throw problem(503,'Engine mất quá nhiều thời gian để xử lý đoạn âm thanh. Hãy thử với nội dung ngắn hơn.');
        throw problem(503,typeof result.detail==='string'?result.detail:result.detail?.message||'Engine chưa sẵn sàng.');
    }
    return result;
}
function localFile(id,file) {
    return artifact.localPath(id, file, 'Đường dẫn âm thanh không hợp lệ.');
}
async function render(user,body,preview=false,onProgress) {
    if(running>=1)throw problem(429,'Một bài giảng đang được tạo. Hãy chờ hoàn tất rồi thử lại.');
    if(typeof body.text!=='string'||!body.text.trim()||body.text.length>20000)throw problem(400,'Bài giảng cần từ 1 đến 20.000 ký tự.');
    if(!config.engineSecret)throw problem(503,'Chưa cấu hình kết nối Engine.');
    const provider=providers.validate(body.tts_provider);
    const planned=speech.plan({lecture:true,sections:[{text:body.text,delivery:{...(body.delivery||{}),markup:body.text}}],speech:body.speech,style:body.style_id||'normal'});
    if(body.speech_plan_hash!==planned.hash)throw problem(409,'Hãy xem cách đọc sau khi thay đổi nội dung hoặc cấu hình trước khi tiếp tục.');
    if(planned.estimated_seconds>=3600 || planned.parts.length>80)throw problem(400,'Bài giảng quá dài hoặc có quá nhiều đoạn. Hãy chia thành các phần nhỏ hơn.');
    // Old lecture callers are clone-only. New catalogue choices specify the
    // internal mode, independently of the system/user display group.
    const mode=body.voice_mode||'clone';
    user=await tiers.currentUser(user);
    tiers.assertLectureAllowed(user,body.text.length);
    const voice=await require('./book_voice.service').resolve(mode,body.teacher_id,user,provider);
    const jobId=crypto.randomBytes(12).toString('hex'),timings=[],parts=[];
    const published=[];
    if(running>=1)throw problem(429,'Một bài giảng đang được tạo. Hãy chờ hoàn tất rồi thử lại.');
    running++;
    const generation = preview ? null : { jobId, owner:String(user._id), controller:new AbortController(), saving:false };
    const signal = generation?.controller.signal;
    if (generation) activeGeneration = generation;
    let historySaved=false, prefetch;
    async function guard() {
        signal?.throwIfAborted();
        user=await tiers.currentUser(user);
        tiers.assertLectureAllowed(user,body.text.length);
        const available=await require('./book_voice.service').resolve(mode,voice.voice_id,user,provider);
        if(available.file_path!==voice.file_path || available.gender!==voice.gender || available.model_revision!==voice.model_revision)throw problem(403,'Giọng mẫu đã thay đổi hoặc bạn không còn quyền sử dụng.');
        signal?.throwIfAborted();
    }
    async function payload(current) {
        const settings=providers.settings(provider,voice.preset,voice.model_revision);
        const partId=crypto.createHash('sha256').update(JSON.stringify([mode,voice.voice_id,voice.file_path,current,settings])).digest('hex');
        return {job_id:jobId,part_id:partId,text:current.text,mode,gender:voice.gender,style:'normal',
            ...settings, reference_key:voice.file_path||voice.voice_id,reference_file:voice.file_path?path.basename(voice.file_path):undefined,
            reference_audio_url:mode==='clone'&&storage.isStorageKey(voice.file_path)?await storage.resolveUrl(voice.file_path):undefined,
            rate_percent:current.rate_percent,pitch_hz:current.pitch_hz||0,pause_ms:current.pause_ms};
    }
    try {
        await tiers.consume(user,preview?'previews':'lectures',async current=>{
            tiers.assertLectureAllowed(current,body.text.length);
            tiers.assertVoiceAccessAllowed(current,voice,provider,mode);
        });
        const total = planned.parts.length;
        onProgress?.({stage:'synthesizing',job_id:jobId,completed:0,total});
        if(!preview)prefetch=await require('./edge_prefetch.service')({jobId,provider,parts:planned.parts,payload,guard,signal});
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
            const audio=await engine('part',request,signal);
            await guard();
            localFile(jobId,audio.output_path);
            if(!Number.isFinite(audio.duration_seconds)||audio.duration_seconds<=0)throw problem(503,'Đoạn âm thanh thiếu thời lượng.');
            parts.push({...current,part_id:partId});timings.push(audio);previewBudget-=audio.duration_seconds;
            if(timings.reduce((sum,t)=>sum+t.duration_seconds,0)>=3600)throw problem(400,'Âm thanh đạt 1 giờ. Hãy rút gọn nội dung.');
            onProgress?.({stage:'synthesizing',completed:parts.length,total});
        }
        onProgress?.({stage:'merging'});
        const merged=await engine('merge',{job_id:jobId,part_ids:parts.map(part=>part.part_id)},signal);
        let file=localFile(jobId,merged.output_path);
        if(preview) {
            const digest=path.basename(file).match(/^final_([a-f0-9]{64})[.]mp3$/)?.[1];
            if(!digest)throw problem(503,'Đường dẫn âm thanh không hợp lệ.');
            const clip=await engine('preview',{job_id:jobId,part_id:digest,merged:true});
            const clipFile=await artifact.materialize(jobId,clip.output_path,'Đường dẫn âm thanh không hợp lệ.');
            return {buffer:await fs.readFile(clipFile),duration_seconds:clip.duration_seconds};
        }
        signal.throwIfAborted();
        generation.saving = true;
        onProgress?.({stage:'saving'});
        file=await artifact.materialize(jobId,merged.output_path,'Đường dẫn âm thanh không hợp lệ.');
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
            speech_config:{...planned.speech,...providers.settings(provider,voice.preset,voice.model_revision),
                voice_name:voice.name,voice_class:voice.class,voice_origin:voice.origin,voice_mode:mode,deliveries:planned.sections.map(section=>section.delivery)}});
        historySaved=true;
        return {status:'success',history_id:saved._id,audio_url:await storage.resolveUrl(audioUrl),subtitle_url:await storage.resolveUrl(subtitleUrl),subtitle_timing:saved.subtitle_timing,duration_seconds:merged.duration_seconds};
    } catch (error) {
        if (signal?.aborted) throw Object.assign(problem(409, 'Đã hủy tạo âm thanh.'), { code:'LECTURE_CANCELLED' });
        throw error;
    } finally {
        if (generation) activeGeneration = undefined;
        async function cleanEngine() {
            await engine('cleanup',{job_id:jobId}).catch(()=>console.warn('[SPEECH] Chưa dọn xong thư mục của lượt tạo bài giảng.'));
            await artifact.cleanupLocal(jobId);
        }
        if (signal?.aborted) {
            // Engine cleanup signals cancellation even if its current inference needs time to return.
            void Promise.all([cleanEngine(), prefetch?.close()]).catch(() => console.warn('[SPEECH] Chưa dọn xong lượt đã hủy.'));
            running--;
        } else {
            try { await prefetch?.close(); } finally { running--; }
            if(!historySaved)for(const item of published) {
                if(storage.isStorageKey(item))await storage.deletePendingStudioFile(item).catch(()=>{});
                else if(path.dirname(item)===path.resolve(__dirname,'../../public/audio/generated')&&path.basename(item).startsWith(`studio-${jobId}-`))await fs.unlink(item).catch(()=>{});
            }
            await cleanEngine();
        }
    }
}
module.exports={render,cancel};
