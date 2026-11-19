const router=require('express').Router();
const {verifyToken,adminOnly}=require('../middlewares/auth.middleware');
const billing=require('../services/billing.service');
router.post('/webhook/sepay',async(req,res)=>{
    billing.verifyWebhookSecret(req.get('Authorization'));
    await billing.settleOrderPaid(billing.transferFromPayload(req.body));
    res.json({success:true});
});
router.use(verifyToken);
router.get('/plans',(req,res)=>res.json(billing.getPlansCatalog()));
router.get('/orders',async(req,res)=>res.json(await billing.listOrders(req.user,false,req.query.before)));
router.get('/admin/orders',adminOnly,async(req,res)=>res.json(await billing.listOrders(req.user,true,req.query.before)));
router.get('/orders/:id',async(req,res)=>res.json(billing.present(await billing.getOrder(req.user,req.params.id))));
router.post('/orders',async(req,res)=>res.status(201).json(await billing.createOrder(req.user,req.body)));
router.post('/orders/:id/verify',async(req,res)=>res.json(await billing.verifyOrderWithSepayApi(req.user,req.params.id)));
router.post('/orders/:id/cancel',async(req,res)=>res.json(await billing.cancelOrder(req.user,req.params.id)));
router.use((error,req,res,next)=>{
    console.warn('[BILLING]',error.code||error.name);
    res.status(error.status||503).json({error:error.status?error.message:'Không xử lý được thanh toán. Hãy thử lại.',code:error.status?error.code:'BILLING_UNAVAILABLE'});
});
module.exports=router;
