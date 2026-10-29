const express = require('express');
const crypto = require('crypto');
const { isValidId, transaction, query } = require('../db/postgres');
const config = require('../config/book');
const Job = require('../models/book_job.model');
const History = require('../models/generated_lecture.model');
const storage = require('../services/storage.service');
const { normalizeMetadata, introduction, openingLine, openingCount } = require('../services/book_metadata.service');
const bookVoices = require('../services/book_voice.service');
const content = require('../services/book_content.service');
const duration = require('../services/book_duration.service');
const speech = require('../services/speech.service');
const reliability = require('../services/gemini_reliability');
const previews = require('../services/book_preview.service');
const { WorkerLease } = require('../models/book_cache.model');
const { verifyToken } = require('../middlewares/auth.middleware');
const router = express.Router();
router.use(verifyToken);

// Serialize submission/retry admission per owner, including requests from two tabs.
async function admit(userId, work) {
    const id = `submit-${userId}`;
    const owner = crypto.randomUUID();
    let acquired;
    try {
        acquired = await WorkerLease.findOneAndUpdate({ _id: id, until: { $lte: new Date() } },
            { $set: { owner, until: new Date(Date.now() + 90000) } }, { upsert: true, returnDocument: 'after' });
    } catch (error) { if (error.code !== 11000) throw error; }
    if (!acquired) throw Object.assign(new Error('Một yêu cầu khác đang được gửi. Hãy thử lại sau vài giây.'), { status: 409 });
    try {
        const pending = await Job.countDocuments({ user_id: userId, delete_requested: false, status: { $in: ['queued', 'processing'] } });
        if (pending >= 3) throw Object.assign(new Error('Bạn đang có 3 yêu cầu chờ/xử lý. Hãy chờ hoặc hủy một yêu cầu.'), { status: 429 });
        return await work();
    } finally { await WorkerLease.updateOne({ _id: id, owner }, { $set: { until: new Date(0) } }); }
}

async function present(job, includeScript = true) {
    if (job.delete_requested) throw Object.assign(new Error('Yêu cầu này đã được hủy và xóa. Hãy gửi yêu cầu mới nếu muốn tạo lại.'), { status: 410 });
    const value = job.toObject ? job.toObject() : { ...job };
    if (job.checkpoint?.editorial?.source_duration_issue) value.source_duration_issue = job.checkpoint.editorial.source_duration_issue;
    delete value.source;
    delete value.source_hash;
    delete value.checkpoint;
    delete value.lease_owner;
    delete value.lease_until;
    delete value.request_id;
    delete value.artifacts_cleaned;
    delete value.edit_request;
    delete value.delete_requested;
    if (value.retry_state) { value.retry_state = { ...value.retry_state }; delete value.retry_state.scope; }
    if (value.selected_voice) {
        const { voice_id, name, gender, provider = 'edge',origin } = value.selected_voice;
        value.selected_voice = { voice_id, name, gender, provider,origin };
    }
    if (value.result) value.result = { ...value.result, audio_url: await storage.resolveUrl(value.result.audio_url), subtitle_url: await storage.resolveUrl(value.result.subtitle_url) };
    if (!includeScript && value.result) delete value.result.summary;
    if (value.draft) {
        if (!includeScript) value.draft = { has_draft: true, estimated_seconds: value.draft.estimated_seconds };
        else {
            value.draft = { ...value.draft };
            const preview=await previews.describe(job);
            if(preview) {
                value.draft.preview_request={status:preview.status,error:preview.error||''};
                value.draft.preview=preview.status==='ready'?preview:null;
            }
            if(value.draft.preview?.audio_url)value.draft.preview={...value.draft.preview,audio_url:await storage.resolveUrl(value.draft.preview.audio_url)};
        }
    }
    return value;
}
router.get('/', async (req, res) => {
    const recent = await Job.find({ user_id: req.user._id, delete_requested: false }).select('+checkpoint').sort({ createdAt: -1 }).limit(30);
    const active = await Job.find({ user_id: req.user._id, delete_requested: false, status: { $in: ['queued', 'processing', 'review'] } }).select('+checkpoint').sort({ createdAt: -1 });
    const ids = new Set(active.map((job) => String(job._id)));
    const jobs = [...active, ...recent.filter((job) => !ids.has(String(job._id)))];
    const worker = await WorkerLease.exists({ _id: 'book-audio', until: { $gt: new Date() } });
    res.json({ jobs: await Promise.all(jobs.map((job) => present(job, false))), worker_online: Boolean(worker) });
});
router.get('/voices', async (req, res) => res.json(await bookVoices.choices(req.user,req.query.provider)));
router.post('/', async (req, res) => {
    const { text, target_minutes, voice_mode = 'standard', voice_id, request_id, title = 'Sách nói' } = req.body || {};
    if (typeof text !== 'string' || text.trim().length < 500 || text.length > config.maxChars) {
        return res.status(400).json({ error: 'Nội dung cần từ 500 đến 1.000.000 ký tự. PDF scan cần chuyển thành văn bản trước.' });
    }
    if (!Number.isInteger(target_minutes) || target_minutes < config.minMinutes || target_minutes > config.maxMinutes) {
        return res.status(400).json({ error: 'Thời lượng phải là số phút nguyên từ 1 đến 59 (dưới 1 giờ).' });
    }
    if (!['standard', 'clone'].includes(voice_mode)
        || typeof request_id !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(request_id) || typeof title !== 'string') {
        return res.status(400).json({ error: 'Thời lượng, loại giọng hoặc mã yêu cầu không hợp lệ.' });
    }
    const existing = await Job.findOne({ user_id: req.user._id, request_id });
    if (existing) return res.json(await present(existing));
    const selected_voice = await bookVoices.resolve(voice_mode, voice_id, req.user, req.body.tts_provider);
    const initialSpeech = req.body.speech ? speech.options(req.body.speech) : undefined;
    speech.assertProvider(initialSpeech,selected_voice.provider || 'edge');
    const metadata = normalizeMetadata(req.body.book_metadata, title);
    if (!config.engineSecret) return res.status(503).json({ error: 'Chạy npm run books:init ở backend trước khi tạo sách nói.' });
    const source = text.trim().replace(/\r\n/g, '\n');
    try {
        const job = await admit(req.user._id, async () => {
            const duplicate = await Job.findOne({ user_id: req.user._id, request_id });
            if (duplicate) return duplicate;
            // Per-owner admission serializes rotation; only read the tiny JSON fields.
            const previous = (await query(`SELECT draft->>'opening_index' AS draft_index, checkpoint->>'opening_index' AS saved_index
                FROM book_jobs WHERE user_id=$1 AND delete_requested=false
                AND (draft->>'opening_index' IN ('0','1','2','3') OR checkpoint->>'opening_index' IN ('0','1','2','3'))
                ORDER BY "createdAt" DESC LIMIT 1`, [req.user._id])).rows[0];
            const previousIndex = previous ? Number(previous.draft_index ?? previous.saved_index) : -1;
            const openingIndex = (previousIndex + 1) % openingCount;
            const intro = introduction(metadata, openingLine(openingIndex));
            duration.rejectSource(await duration.checkSource(source, intro, target_minutes, selected_voice, voice_mode, initialSpeech));
            return Job.create({ user_id: req.user._id, request_id, title: title.slice(0, 160).trim() || 'Sách nói',
                book_metadata: metadata, ai_assisted: true, workflow_version: 'review-v1', work_action: 'summary',
                source, source_hash: crypto.createHash('sha256').update(source).digest('hex'), target_minutes, voice_mode, selected_voice,
                checkpoint:{opening_index:openingIndex, analysis_chunk_chars:config.analysisChunkChars, analysis_strategy:'adaptive-v1', ...(initialSpeech ? { initial_speech: initialSpeech } : {})} });
        });
        res.status(202).json(await present(job));
    } catch (error) {
        if (error.code !== 11000) throw error;
        res.json(await present(await Job.findOne({ user_id: req.user._id, request_id })));
    }
});
router.param('id', async (req, res, next, id) => {
    if (!isValidId(id)) return res.status(404).json({ error: 'Không tìm thấy yêu cầu.' });
    // Hidden source stays server-side; it is needed for duration validation on edits/actions.
    req.bookJob = await Job.findOne({ _id: id, user_id: req.user._id }).select(req.method === 'GET' ? '+checkpoint' : '+source +checkpoint');
    if (!req.bookJob || (req.bookJob.delete_requested && req.method !== 'DELETE')) return res.status(404).json({ error: 'Không tìm thấy yêu cầu.' });
    next();
});
router.get('/:id', async (req, res) => res.json(await present(req.bookJob)));
router.get('/:id/subtitles',async(req,res)=>require('../services/subtitle_download.service')(res,req.bookJob.status==='completed'?req.bookJob.result?.subtitle_url:null));
router.delete('/:id', async (req, res) => {
    const pending = await transaction(async (client) => {
        // Serialize with worker publication/checkpoints and actions from other tabs.
        await client.query('SELECT _id FROM book_jobs WHERE _id=$1 AND user_id=$2 FOR UPDATE', [req.bookJob._id, req.user._id]);
        const current = await Job.findOne({ _id: req.bookJob._id, user_id: req.user._id });
        if (current.delete_requested) return !current.artifacts_cleaned;
        if (current.status === 'completed' || current.progress?.phase === 'publishing'
            || await History.exists({ book_job_id: current._id })) {
            throw Object.assign(new Error('Sách nói đã hoàn tất hoặc đang lưu vào lịch sử, không thể hủy ở bước này.'), { status: 409 });
        }
        const processing = current.status === 'processing';
        await Job.updateOne({ _id: current._id, user_id: req.user._id }, { $set: {
            delete_requested: true, cancel_requested: true, next_attempt_at: null, artifacts_cleaned: false,
            ...(processing ? {} : { status: 'cancelled', progress: { phase: 'cancelled', percent: 0, message: 'Đã hủy.' } }),
        } });
        return true;
    });
    res.status(202).json({ removed: true, pending_cleanup: pending });
});
router.patch('/:id/draft', async (req, res) => {
    const current = req.bookJob;
    if (current.status !== 'review' || current.workflow_version !== 'review-v1' || !current.draft) return res.status(409).json({ error: 'Bản tóm tắt chưa sẵn sàng để chỉnh sửa.' });
    if (!Number.isInteger(req.body?.revision) || req.body.revision !== current.draft_revision) return res.status(409).json({ error: 'Bản tóm tắt đã đổi ở phiên khác. Hãy tải lại trước khi sửa.' });
    speech.assertProvider(req.body.speech || current.draft.speech,current.selected_voice?.provider || 'edge');
    const draft = content.editedDraft(current.draft, req.body.sections, req.body.speech ? { speech: req.body.speech, deliveries: req.body.deliveries } : undefined);
    if (draft === current.draft) return res.json(await present(current));
    if (draft.reading_rate) draft.duration_budget = duration.budget(current.source, draft.introduction || '', current.target_minutes,
        draft.reading_rate.units_per_minute, draft.speech?.rate_percent ?? 0, draft.sections.length);
    duration.annotate(draft, current.target_minutes);
    const job = await Job.findOneAndUpdate({ _id: current._id, user_id: req.user._id, status: 'review', draft_revision: req.body.revision },
        { $set: { draft, approved_revision: null, error: '' }, $inc: { draft_revision: 1 } }, { returnDocument: 'after' });
    if (!job) return res.status(409).json({ error: 'Bản tóm tắt đã đổi ở phiên khác. Hãy tải lại trước khi sửa.' });
    res.json(await present(job));
});
for (const action of ['revise', 'preview', 'audio']) router.post(`/:id/${action}`, async (req, res) => {
    const current = req.bookJob;
    const revision = req.body?.revision;
    if (current.workflow_version !== 'review-v1' || current.status !== 'review' || !current.draft?.sections?.length) return res.status(409).json({ error: 'Bản tóm tắt chưa sẵn sàng. Hãy tải lại yêu cầu.' });
    if (!Number.isInteger(revision) || revision !== current.draft_revision) return res.status(409).json({ error: 'Bản tóm tắt đã đổi ở phiên khác. Hãy tải lại trước khi tiếp tục.' });
    speech.assertProvider(current.draft.speech,current.selected_voice?.provider || 'edge');
    if (['preview','audio'].includes(action) && current.draft.speech) {
        const plan = speech.plan({ introduction: current.draft.introduction || '', sections: current.draft.sections, speech: current.draft.speech, style: current.draft.style });
        if (req.body.speech_plan_hash !== plan.hash) return res.status(409).json({ error: 'Nội dung hoặc tốc độ vừa thay đổi. Hãy thử lại.' });
    }
    if(action==='preview') {
        try {await previews.request(current,req.user);return res.status(202).json(await present(current));}
        catch(error) {return res.status(error.status||503).json({error:error.status?error.message:'Không tạo được đoạn nghe thử. Kiểm tra Engine và thử lại.'});}
    }
    let edit_request = null;
    if (action === 'revise') {
        const instruction = req.body?.instruction;
        const sectionIndex = req.body?.section_index;
        if (typeof instruction !== 'string' || instruction.trim().length < 5 || instruction.length > 2000
            || (sectionIndex != null && (!Number.isInteger(sectionIndex) || sectionIndex < 0 || sectionIndex >= current.draft.sections.length))) {
            return res.status(400).json({ error: 'Nhập yêu cầu chỉnh sửa từ 5 đến 2.000 ký tự và chọn mục hợp lệ.' });
        }
        const fitDuration = req.body.fit_duration === true && sectionIndex == null;
        if (fitDuration) duration.rejectSource(await duration.checkSource(current.source, current.draft.introduction || '',
            current.target_minutes, current.selected_voice, current.voice_mode, current.draft.speech, current.draft.reading_rate));
        edit_request = { instruction: instruction.trim(), section_index: sectionIndex ?? null, request_id: crypto.randomUUID(), fit_duration: fitDuration };
    }
    if (action === 'audio' && content.estimate(current.draft) >= config.maxAudioSeconds) return res.status(400).json({ error: 'Bản tóm tắt dự kiến đạt 1 giờ. Hãy rút gọn trước khi tạo âm thanh.' });
    if (action === 'audio' && duration.audit(current.draft, current.target_minutes).outside_tolerance && req.body.accept_duration_mismatch !== true) {
        return res.status(409).json({ error: 'Bản tóm tắt đang lệch thời lượng đã chọn. Hãy căn lại hoặc xác nhận dùng thời lượng dự kiến trước khi tạo âm thanh.' });
    }
    const selfApprove=action==='audio' && req.body.self_approve===true;
    if(selfApprove && !current.draft.user_edited)return res.status(400).json({error:'Chỉ có thể tự duyệt bản tóm tắt đã sửa tay.'});
    const approval=selfApprove?{method:'user',user_id:String(req.user._id),revision,content_hash:content.textHash(current.draft.sections),approved_at:new Date().toISOString()}:null;
    const job = await admit(req.user._id, () => Job.findOneAndUpdate({ _id: current._id, user_id: req.user._id, status: 'review', draft_revision: revision },
        { $set: { status: 'queued', work_action: action, edit_request, approved_revision: action === 'audio' ? revision : null,
            cancel_requested: false, error: '', runs: 0, next_attempt_at: null, retry_state: null, lease_until: new Date(0),
            'draft.user_approval':approval,
            progress: { phase: action === 'revise' ? 'script' : action, percent: 55,
                message: action === 'revise' ? 'Đang chờ AI chỉnh bản tóm tắt.' : action === 'preview' ? 'Đang chờ tạo đoạn nghe thử.' : 'Đã duyệt nội dung. Đang chờ tạo âm thanh.' } },
        $unset: { lease_owner: '' } }, { returnDocument: 'after' }));
    if (!job) return res.status(409).json({ error: 'Yêu cầu đã đổi trạng thái. Hãy tải lại trước khi tiếp tục.' });
    res.status(202).json(await present(job));
});
router.post('/:id/review', async (req, res) => {
    if (!req.bookJob.draft || !Number.isInteger(req.body?.revision)) return res.status(409).json({ error: 'Chưa có bản tóm tắt để quay lại. Hãy tiếp tục từ phần lỗi.' });
    const job = await Job.findOneAndUpdate({ _id: req.bookJob._id, user_id: req.user._id, status: 'failed', workflow_version: 'review-v1', draft_revision: req.body?.revision },
        { $set: { status: 'review', error: '', approved_revision: null, cancel_requested: false, next_attempt_at: null,
            progress: { phase: 'review', percent: 55, message: 'Bạn có thể chỉnh bản tóm tắt rồi tạo âm thanh lại.' } } }, { returnDocument: 'after' });
    if (!job) return res.status(409).json({ error: 'Yêu cầu đã đổi trạng thái. Hãy tải lại trước khi tiếp tục.' });
    res.json(await present(job));
});
router.post('/:id/cancel', async (req, res) => {
    // Cancel queued first: if a worker claims it concurrently, the processing update catches it.
    await Job.updateOne({ _id: req.bookJob._id, user_id: req.user._id, status: { $in: ['queued', 'review'] } }, { $set: { status: 'cancelled', cancel_requested: true, next_attempt_at: null,
        progress: { phase: 'cancelled', percent: 0, message: 'Đã hủy.' } } });
    const cancelled = await Job.updateOne({ _id: req.bookJob._id, user_id: req.user._id, status: 'processing', 'progress.phase': { $ne: 'publishing' } }, { $set: { cancel_requested: true } });
    if (!cancelled.matchedCount && await Job.exists({ _id: req.bookJob._id, status: 'processing', 'progress.phase': 'publishing' })) {
        return res.status(409).json({ error: 'Sách nói đang được lưu vào lịch sử. Hãy chờ hoàn tất.' });
    }
    res.json(await present(await Job.findById(req.bookJob._id)));
});
router.post('/:id/retry', async (req, res) => {
    duration.rejectSource(req.bookJob.checkpoint?.editorial?.source_duration_issue);
    const job = await admit(req.user._id, () => transaction(async () => {
        const job = await Job.findOneAndUpdate({ _id: req.bookJob._id, user_id: req.user._id, status: 'failed' },
            { $set: { status: 'queued', error: '', runs: 0, cancel_requested: false, next_attempt_at: null, retry_state: null, lease_until: new Date(0),
                progress: { ...req.bookJob.progress, phase: req.bookJob.retry_state?.resume_phase || req.bookJob.progress?.phase || 'analysis',
                    message: 'Đang chờ tiếp tục từ phần đã lưu.' } } }, { returnDocument: 'after' });
        // Explicit manual retry permits one fresh quota check after the user
        // changes plan/key/quota. Automatic retries never clear this circuit.
        if (job && ['DAILY_QUOTA', 'QUOTA_CONFIG'].includes(req.bookJob.retry_state?.code)) await reliability.clearDailyGate(req.bookJob.retry_state.scope);
        return job;
    }));
    if (!job) return res.status(409).json({ error: 'Chỉ yêu cầu bị lỗi mới có thể thử lại.' });
    res.json(await present(job));
});
router.use((error, req, res, next) => {
    if (error.code === 'SOURCE_TOO_SHORT') return res.status(422).json({ error:error.message, code:error.code, duration_issue:error.duration_issue });
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('[BOOK API]', error.name);
    res.status(500).json({ error: 'Không thể lưu hoặc đọc yêu cầu sách nói. Hãy thử lại.' });
});
module.exports = router;
