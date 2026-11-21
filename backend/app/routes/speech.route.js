const crypto=require('crypto');
const os=require('os');
const multer=require('multer');
const router=require('express').Router();
const {verifyToken}=require('../middlewares/auth.middleware');
const config=require('../config/book');
const speech=require('../services/speech.service');
const lecture=require('../services/speech_lecture.service');
const artifact=require('../services/engine_artifact.service');
const localTts=require('../services/local_client_tts.service');

const uploadAudio=multer({storage:multer.memoryStorage(),limits:{fileSize:150*1024*1024,fieldSize:5*1024*1024,files:1}});

function verifyEngineSecret(req,res,next){
    const expected=Buffer.from(String(config.engineSecret||''),'utf8');
    const provided=Buffer.from(String(req.get('X-Book-Engine-Secret')||''),'utf8');
    if(!expected.length || expected.length!==provided.length || !crypto.timingSafeEqual(expected,provided)){
        return res.status(403).json({error:'Khóa nội bộ Engine không hợp lệ.'});
    }
    next();
}

router.post('/engine-register',verifyEngineSecret,async(req,res)=>{
    const result=await artifact.registerNode({
        role:req.body?.role,
        engineUrl:req.body?.engine_url,
        label:req.body?.label,
    });
    res.json(result);
});

router.delete('/engine-register/:role',verifyEngineSecret,async(req,res)=>{
    const result=await artifact.unregisterNode(req.params.role);
    res.json(result);
});

router.use(verifyToken);
router.get('/engine-status',async(_req,res)=>{
    res.json(await artifact.status());
});
router.get('/local-hardware',async(_req,res)=>{
    const engineStatus=await artifact.status().catch(()=>({online:false}));
    let vieneu={online:false,device:'unknown'};
    try{
        const resp=await fetch(`${String(process.env.VIENEU_URL||'http://127.0.0.1:8001').replace(/\/+$/,'')}/health/ready`,{signal:AbortSignal.timeout(2000)});
        const body=await resp.json().catch(()=>({}));
        vieneu={online:resp.ok&&body?.status==='ok',device:body?.device||'unknown'};
    }catch{}
    const cpus=os.cpus();
    res.json({
        device:engineStatus.device||'cpu',
        gpu_name:engineStatus.gpu_name||null,
        engine_online:Boolean(engineStatus.online),
        vieneu_online:vieneu.online,
        vieneu_device:vieneu.device,
        cpu_model:cpus[0]?.model||'',
        cpu_threads:cpus.length,
        local_engine_first:process.env.LOCAL_ENGINE_FIRST==='true',
    });
});
router.post('/plan',(req,res)=>{
    const planned=speech.plan(req.body || {});
    res.json({hash:planned.hash,sections:planned.sections,speech:planned.speech,changes:planned.changes,spoken_text:planned.spoken_text,estimated_seconds:planned.estimated_seconds});
});
router.post('/lecture-preview',async(req,res)=>{
    const result=await lecture.render(req.user,req.body||{},true);
    res.set('Content-Type','audio/mpeg').set('Cache-Control','no-store').send(result.buffer);
});
router.post('/local-authorize',async(req,res)=>{
    res.json(await localTts.authorizeLecture(req.user,req.body||{},Boolean(req.body?.preview)));
});
router.post('/local-complete',uploadAudio.single('audio_file'),async(req,res)=>{
    res.json(await localTts.completeLecture(req.user,req.body||{},req.file?.buffer));
});
router.use((error,req,res,next)=>{
    console.warn('[SPEECH API]',error.status||error.name);
    res.status(error.status||503).json({error:error.status?error.message:'Không xử lý được cấu hình đọc hoặc kết nối Engine. Hãy thử lại.',...(error.code?{code:error.code}:{})});
});
module.exports=router;
