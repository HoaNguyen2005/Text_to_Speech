const crypto=require('crypto');
const router=require('express').Router();
const {verifyToken}=require('../middlewares/auth.middleware');
const config=require('../config/book');
const speech=require('../services/speech.service');
const lecture=require('../services/speech_lecture.service');
const artifact=require('../services/engine_artifact.service');

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
router.post('/plan',(req,res)=>{
    const planned=speech.plan(req.body || {});
    res.json({hash:planned.hash,sections:planned.sections,speech:planned.speech,changes:planned.changes,spoken_text:planned.spoken_text,estimated_seconds:planned.estimated_seconds});
});
router.post('/lecture-preview',async(req,res)=>{
    const result=await lecture.render(req.user,req.body||{},true);
    res.set('Content-Type','audio/mpeg').set('Cache-Control','no-store').send(result.buffer);
});
router.use((error,req,res,next)=>{
    console.warn('[SPEECH API]',error.status||error.name);
    res.status(error.status||503).json({error:error.status?error.message:'Không xử lý được cấu hình đọc hoặc kết nối Engine. Hãy thử lại.'});
});
module.exports=router;
