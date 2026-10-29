const router=require('express').Router();
const {verifyToken}=require('../middlewares/auth.middleware');
const speech=require('../services/speech.service');
const lecture=require('../services/speech_lecture.service');
router.use(verifyToken);
router.post('/plan',(req,res)=>{
    const planned=speech.plan({...req.body,provider:req.body?.provider||'edge'});
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
