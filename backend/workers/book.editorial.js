// New, opt-in review workflow. Legacy jobs continue through book.worker.js.
const path = require('path');
const fs = require('fs/promises');
const Job = require('../app/models/book_job.model');
const History = require('../app/models/generated_lecture.model');
const { BookCache } = require('../app/models/book_cache.model');
const config = require('../app/config/book');
const storage = require('../app/services/storage.service');
const llm = require('../app/services/book_llm.service');
const content = require('../app/services/book_content.service');
const speech = require('../app/services/speech.service');
const language = require('../app/services/book_language');
const duration = require('../app/services/book_duration.service');
const { normalizeMetadata, introduction, openingLine, AI_SUMMARY_NOTICE } = require('../app/services/book_metadata.service');

module.exports = async function editorial(job, context) {
    const { checkpoint, guard, save, timed, engine, artifactPath, restore, exists, workerId, Interrupted } = context;
    const state = checkpoint.editorial ||= {};
    const chunkChars = checkpoint.analysis_chunk_chars || 6000;
    const chunks = llm.splitText(job.source,chunkChars);
    const metadata = normalizeMetadata(job.book_metadata, job.title);
    // Keep reviewed text and retry checkpoints identical; new jobs carry a fixed opening index.
    const intro = job.draft?.introduction ?? state.task?.draft?.introduction ?? introduction(metadata, openingLine(checkpoint.opening_index));
    if (['summary', 'revise'].includes(job.work_action)) {
        state.reading_rate = await duration.calibrate(job, context);
        await save('analysis', 2);
    }
    const baseRate = state.reading_rate?.units_per_minute || 300;
    const initialRate = checkpoint.initial_speech?.rate_percent ?? 0;
    if (job.work_action === 'summary' || job.edit_request?.fit_duration) {
        const chosenRate = job.work_action === 'revise' ? job.draft?.speech?.rate_percent ?? initialRate : initialRate;
        state.source_duration_issue = duration.sourceIssue(job.source, intro, job.target_minutes, baseRate, chosenRate, true);
        if (state.source_duration_issue) {
            await save('calibration', 2, 'Nguồn quá ngắn cho thời lượng đã chọn. Hãy chọn lại thời lượng hoặc thêm nội dung nguồn.');
            duration.rejectSource(state.source_duration_issue);
        }
    }
    const possibleMinutes = Math.max(0.5, (llm.units(job.source) + llm.units(intro)) / (baseRate * (1 + initialRate / 100)));
    const minutes = Math.min(job.target_minutes, possibleMinutes);
    const adaptive = checkpoint.analysis_strategy === 'adaptive-v1';
    const usable = text => typeof text === 'string' && text.trim() && !language.missingDiacritics(text);
    const cacheVersion = `${config.editorialVersion}:${config.languageVersion}${chunkChars === 6000 ? '' : ':chunks-'+chunkChars}${adaptive ? ':'+llm.FAST_VERSION+':'+(process.env.GEMINI_MODEL || 'gemini-flash-latest') : ''}`;
    if (!state.notes) {
        const cache = await BookCache.findOne({ user_id: job.user_id, source_hash: job.source_hash, version: cacheVersion, expires_at: { $gt: new Date() } }).lean();
        state.notes = cache?.notes || [];
        state.overview = cache?.overview;
    }
    if (adaptive && !state.plan && !state.fastRejected && chunks.length <= 4 && !state.notes.some(usable)) {
        const items = chunks.map((text,id)=>({id,text}));
        if (llm.withinBudget(items)) {
            await save('analysis', 2, 'Phân tích dữ kiện và lập dàn ý trong cùng lượt.');
            try {
                const combined = await timed('analysis_outline', () => llm.analyzeGroup(items, minutes, guard));
                combined.notes.forEach(item=>{state.notes[item.id]=item.note;});
                state.plan = combined.plan;
                await save('outline', 24);
            } catch (error) {
                if (!llm.canFallback(error) && error.code !== 'TIMEOUT') throw error;
                state.fastRejected = true;
                await save('analysis', 2, 'Chuyển sang phân tích theo nhóm nhỏ hơn.');
                if (error.code === 'TIMEOUT') throw error; // Respect the shared retry gate.
            }
        } else state.fastRejected = true;
    }
    async function analyzeBatch(items) {
        try {
            const results = items.length === 1
                ? [{ id:items[0].id, note:await timed('analysis',()=>llm.analyze(items[0].text,guard)) }]
                : (await timed('analysis_batch',()=>llm.analyzeGroup(items,null,guard))).notes;
            results.forEach(item=>{state.notes[item.id]=item.note;});
            await save('analysis', 2 + state.notes.filter(usable).length / chunks.length * 20);
        } catch (error) {
            if (items.length < 2 || (!llm.canFallback(error) && error.code !== 'TIMEOUT')) throw error;
            state.groupMaxChunks = Math.max(1,Math.floor(items.length/2));
            await save('analysis', 2 + state.notes.filter(usable).length / chunks.length * 20, 'Chia nhóm phân tích để giữ đủ dữ kiện.');
            if (error.code === 'TIMEOUT') throw error;
            const middle = Math.ceil(items.length/2);
            await analyzeBatch(items.slice(0,middle));
            await analyzeBatch(items.slice(middle));
        }
    }
    for (let start = 0; adaptive && start < chunks.length;) {
        if (usable(state.notes[start])) { start++; continue; }
        const items=[];
        const max = state.groupMaxChunks || 4;
        while (start < chunks.length && items.length < max && !usable(state.notes[start])) {
            const item = {id:start,text:chunks[start]};
            if (items.length && !llm.withinBudget([...items,item])) break;
            items.push(item);start++;
        }
        await save('analysis',2 + state.notes.filter(usable).length / chunks.length * 20,'Phân tích nguồn theo nhóm, giữ mã tham chiếu từng phần.');
        await analyzeBatch(items);
    }
    for (let start = 0; !adaptive && start < chunks.length; start += config.analysisConcurrency) {
        const ids = [];
        for (let i = start; i < Math.min(chunks.length, start + config.analysisConcurrency); i++) if (!usable(state.notes[i])) ids.push(i);
        if (!ids.length) continue;
        await save('analysis', 2 + start / chunks.length * 20, `Phân tích dữ kiện · ${start}/${chunks.length} phần`);
        const results = await Promise.allSettled(ids.map(i => timed('analysis', () => llm.analyze(chunks[i], guard))));
        results.forEach((result, i) => { if (result.status === 'fulfilled') state.notes[ids[i]] = result.value; });
        await save('analysis', 2 + (start + ids.length) / chunks.length * 20);
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
    }
    if (!state.overview) {
        // Compact the structured record only for planning. Writing and checking
        // retrieve original excerpts again, so this overview is never the sole source.
        const records = state.notes.map((text, i) => `[Phần ${i}] ${text}`);
        let groups = records;
        state.overviewRounds ||= [];
        for (let round = 0; !state.plan && groups.join('\n').length > 14000; round++) {
            if (round > 5) throw new Error('Nguồn quá phức tạp để lập dàn ý. Hãy chia thành các tập nhỏ hơn.');
            const batches = []; let batch = '';
            for (const record of groups) {
                if (batch.length + record.length > 14000 && batch) { batches.push(batch); batch = ''; }
                batch += record + '\n';
            }
            if (batch) batches.push(batch);
            const saved = state.overviewRounds[round] ||= [];
            for (let i = 0; i < batches.length; i++) {
                if (!saved[i]) saved[i] = await timed('reduce', () => llm.reduce(batches[i], guard));
                await save('outline', 24, 'Đang gộp dữ kiện để lập dàn ý.');
            }
            groups = saved.slice(0, batches.length);
        }
        state.overview = groups.join('\n');
        await BookCache.updateOne({ user_id: job.user_id, source_hash: job.source_hash, version: cacheVersion },
            { $set: { notes: state.notes, overview: state.overview, expires_at: new Date(Date.now() + 7 * 86400000) } }, { upsert: true });
        await save('outline', 24);
    }
    if (!state.plan) {
        // Do not force a long requested duration from a short source.
        await save('outline', 25, 'Lập dàn ý theo thể loại và mạch nội dung.');
        state.plan = await timed('outline', () => llm.editorialOutline(state.overview, state.notes, Math.min(job.target_minutes, possibleMinutes), guard));
        await save('outline', 27);
    }
    const taskKey = content.hash(JSON.stringify([job.work_action, job.draft_revision, job.edit_request || null,
        ...(['summary','revise'].includes(job.work_action) ? [llm.scriptVersion] : [])]));
    if (state.task?.key !== taskKey) state.task = { key: taskKey, checks: {} };
    const task = state.task;
    if (state.plan.sections.some(section => language.headingDiacriticsIssue(section.title))) {
        state.plan = await timed('headings', () => llm.ensureHeadings(state.plan, guard));
        // Preserve the existing section order, source IDs and every saved paragraph.
        if (task.draft?.sections) task.draft.sections = task.draft.sections.map((section, i) => ({ ...section, title: state.plan.sections[i].title }));
        await save('outline', 27, 'Đã viết tiêu đề mục bằng tiếng Việt đầy đủ dấu.');
    }
    const rate = baseRate * (1 + (checkpoint.initial_speech?.rate_percent ?? (state.plan.style === 'story' ? -5 : state.plan.style === 'news' ? 8 : 0)) / 100);
    const draftBase = () => ({ introduction: intro, sections: [], units_per_minute: rate,
        ...(openingLine(checkpoint.opening_index) ? { opening_index:checkpoint.opening_index } : {}),
        ...(state.reading_rate ? { reading_rate: state.reading_rate } : {}),
        genre: state.plan.genre, style: state.plan.style, reason: state.plan.reason, verification_notes: [], preview: null,
        speech: structuredClone(checkpoint.initial_speech || { version:'speech-v1', profile:'auto', normalize:false, dictionary:[], rate_percent:0 }) });
    const sourceFor = (i, text = '', expanded = false) => content.evidence(state.plan.sections[i], chunks, state.notes, text, expanded);

    async function returnForReview(draft, message = 'Bản tóm tắt đã sẵn sàng. Xem trước rồi chọn tạo âm thanh.') {
        await guard(true);
        duration.annotate(draft, job.target_minutes);
        const result = await Job.updateOne({ _id: job._id, status: 'processing', lease_owner: workerId,
            cancel_requested: false, lease_until: { $gt: new Date() } }, { $set: {
            status: 'review', draft, checkpoint, approved_revision: null, error: '',
            progress: { phase: 'review', percent: 55, message },
        }, $inc: { draft_revision: 1 }, $unset: { lease_owner: '', lease_until: '', edit_request: '' } });
        if (!result.matchedCount) throw new Interrupted();
    }
    async function verify(draft, repair) {
        // Persists across actions/revisions. The key includes retrieved evidence,
        // previous paragraph, model and prompt version, not just section text.
        state.reviewCache ||= {};
        let evaluated;
        const makeItem = (section,id) => ({ id,text:section.text,evidence:sourceFor(id,section.text,section.evidence_expanded===true),section:state.plan.sections[id],previous:(draft.sections[id-1]?.text || '').slice(-1000) });
        const keyOf = item => content.hash(JSON.stringify([config.editorialVersion,job.source_hash,llm.reviewIdentity(),item]));
        async function checkBatch(items) {
            try {
                const results = await timed('verification',()=>llm.reviewSections(items,guard));
                items.forEach((item,index)=>{state.reviewCache[keyOf(item)]=results[index];});
                while(Object.keys(state.reviewCache).length>256)delete state.reviewCache[Object.keys(state.reviewCache)[0]];
                await save('verification',48,'Đã lưu kết quả đối chiếu từng mục.');
            } catch(error) {
                if(items.length<2 || (!llm.canFallback(error) && error.code!=='TIMEOUT'))throw error;
                state.reviewBatchSize=1;
                await save('verification',48,'Đối chiếu từng mục vì nhóm vượt ngân sách.');
                if(error.code==='TIMEOUT')throw error;
                for(const item of items)await checkBatch([item]);
            }
        }
        for(let attempt=0;attempt<(repair?2:1);attempt++) {
            evaluated=draft.sections.map(makeItem);
            let batch=[];
            for(const item of evaluated) {
                if(state.reviewCache[keyOf(item)])continue;
                if(batch.length && (batch.length>=(state.reviewBatchSize||3) || !llm.withinBudget([...batch,item]))) {await checkBatch(batch);batch=[];}
                batch.push(item);
            }
            if(batch.length)await checkBatch(batch);
            if(!repair || attempt===1)break;
            let changed=false;
            for(const item of evaluated) {
                const result=state.reviewCache[keyOf(item)];
                if(result.passed || !result.corrected_text.trim() || result.corrected_text===item.text)continue;
                const text=content.checkedText(result.corrected_text),section=draft.sections[item.id];
                section.text=text;
                if(section.delivery)section.delivery={profile:section.delivery.profile,markup:text,paragraph_profiles:[]};
                changed=true;
            }
            if(!changed)break;
            await save('verification',50,'Kiểm tra lại các mục vừa sửa và ngữ cảnh liên quan.');
        }
        const notes=[];
        let allPassed=true;
        for(const item of evaluated) {
            const result=state.reviewCache[keyOf(item)];
            if(!result.passed) {
                allPassed=false;
                notes.push(...(result.issues.length?result.issues:['AI chưa xác nhận được nội dung từ các đoạn nguồn liên quan.']).map(issue=>`Mục ${item.id+1}: ${issue}`));
            }
        }
        draft.verification_notes=notes.slice(0,60);
        draft.verified_hash=allPassed?content.textHash(draft.sections):null;
        draft.verification_method=allPassed?'ai':'pending';
        return allPassed;
    }

    if (job.work_action === 'summary' || job.work_action === 'revise') {
        task.draft ||= job.work_action === 'revise' ? structuredClone(job.draft) : draftBase();
        const draft = task.draft;
        if (state.reading_rate) draft.reading_rate = state.reading_rate;
        draft.user_edited=false;
        draft.user_approval=null;
        draft.units_per_minute = baseRate * (1 + (draft.speech?.rate_percent ?? 0) / 100);
        draft.duration_budget = duration.budget(job.source, intro, job.target_minutes, baseRate,
            draft.speech?.rate_percent ?? 0, state.plan.sections.length);
        const target = draft.duration_budget.target_units;
        task.written ||= [];
        task.scriptStates ||= {};
        for (let i = 0; i < state.plan.sections.length; i++) {
            const revising = job.work_action === 'revise';
            if (revising && job.edit_request?.section_index != null && job.edit_request.section_index !== i) continue;
            if (task.written.includes(i)) continue;
            await save('script', 30 + i / state.plan.sections.length * 14, `${revising ? 'Chỉnh' : 'Viết'} bản tóm tắt · mục ${i + 1}/${state.plan.sections.length}`);
            const allocated = Math.max(20, Math.round(target / state.plan.sections.length));
            const written = await timed('script', () => llm.editorialScript(sourceFor(i, draft.sections[i]?.text || ''), state.plan, i,
                allocated, draft.sections[i - 1]?.text || '', guard,
                revising ? draft.sections[i]?.text || '' : '', job.edit_request?.instruction || '', {
                    state: task.scriptStates[i] ||= {}, onDraft: () => save('script', 30 + i / state.plan.sections.length * 14),
                    expandEvidence: () => sourceFor(i, task.scriptStates[i]?.result?.text || '', true),
                }));
            draft.sections[i] = { title: state.plan.sections[i].title, source_ids: state.plan.sections[i].source_ids, text: written.text,
                source_shortfall: written.shortfall,
                evidence_expanded: written.evidence_expanded === true,
                ...(draft.sections[i]?.delivery ? { delivery: { profile: draft.sections[i].delivery.profile, markup: written.text, paragraph_profiles: [] } } : {}) };
            task.written.push(i);
            draft.preview = null;
            await save('script', 30 + (i + 1) / state.plan.sections.length * 14);
        }
        await verify(draft, true);
        // Verification may shorten the prose. Rebalance once after it, without
        // touching a user-requested revision unless they explicitly chose duration fitting.
        if ((job.work_action === 'summary' || job.edit_request?.fit_duration) && !task.durationFitCompleted) {
            task.fitDone ||= [];
            task.fitStates ||= {};
            let changed = false;
            for (let i = 0; i < draft.sections.length; i++) {
                const total = draft.sections.reduce((sum, section) => sum + llm.units(section.text), 0);
                if (Math.abs(total - target) <= target * .1) break;
                const section = draft.sections[i], allocated = Math.max(20, Math.round(target / draft.sections.length));
                const count = llm.units(section.text);
                if (task.fitDone.includes(i) || section.source_shortfall || Math.abs(count - allocated) <= allocated * .15) continue;
                await save('script', 46, `Căn độ dài sau đối chiếu · mục ${i + 1}/${draft.sections.length}`);
                const candidate = await timed('duration_fit', () => llm.editorialScript(sourceFor(i, section.text), state.plan, i,
                    allocated, draft.sections[i-1]?.text || '', guard, section.text,
                    'Căn độ dài, giữ các dữ kiện đã được đối chiếu. Không bịa, lặp, thêm nhận xét sáo rỗng hoặc tái hiện chi tiết để đủ thời lượng.', {
                        maxAttempts: 1, state: task.fitStates[i] ||= {}, onDraft: () => save('script', 46),
                    }));
                if (Math.abs(candidate.units - allocated) < Math.abs(count - allocated)) {
                    section.text = candidate.text;
                    section.source_shortfall = candidate.shortfall;
                    if (section.delivery) section.delivery = { profile: section.delivery.profile, markup: candidate.text, paragraph_profiles: [] };
                    draft.verified_hash = null;
                    changed = true;
                }
                task.fitDone.push(i);
                await save('script', 47);
            }
            if (changed || !draft.verified_hash) await verify(draft, true);
            task.durationFitCompleted = true;
            await save('verification', 52);
        }
        await returnForReview(draft, draft.verified_hash ? undefined : 'Bản nháp còn điểm cần xem lại. Chỉnh nội dung hoặc yêu cầu AI viết lại trước khi tạo âm thanh.');
        return;
    }
    if (!job.draft?.sections?.length) throw new Error('Chưa có bản tóm tắt để tạo âm thanh.');
    const draft = structuredClone(job.draft);
    speech.assertProvider(draft.speech,checkpoint.voice.provider || 'edge');
    draft.sections = draft.sections.map((section, i) => ({ ...section, title: state.plan.sections[i].title }));
    const planned = draft.speech ? speech.plan({ introduction: draft.introduction || '', sections: draft.sections, speech: draft.speech, style: draft.style }) : null;
    const narrationParts = planned?.parts || content.narration(draft.introduction, draft.sections, draft.style);
    if (!checkpoint.referenceKey) {
        const voice = checkpoint.voice;
        let revision = '';
        if (voice.file_path && !storage.isStorageKey(voice.file_path)) {
            const stat = await fs.stat(path.join(__dirname, '..', voice.file_path)); revision = `${stat.size}:${stat.mtimeMs}`;
        }
        checkpoint.referenceKey = content.hash(`${voice.voice_id}:${voice.file_path || voice.gender}:${revision}`);
        await save('audio', 55);
    }
    const partId = part => content.hash(JSON.stringify([config.editorialVersion, config.narrationVersion, checkpoint.referenceKey, job.voice_mode, draft.style, part,
        ...(checkpoint.voice.provider === 'vieneu' ? [checkpoint.voice.provider, checkpoint.voice.model_revision, checkpoint.voice.preset] : [])]));
    async function partPayload(part) {
        const id = partId(part);
        const voice = checkpoint.voice;
        const url = job.voice_mode === 'clone' && storage.isStorageKey(voice.file_path) ? await storage.resolveUrl(voice.file_path) : undefined;
        return { job_id: String(job._id), part_id: id, text: part.text,
            mode: job.voice_mode, gender: voice.gender, style: draft.style, reference_key: checkpoint.referenceKey,
            ...require('../app/services/tts_provider.service').settings(voice.provider || 'edge',voice.preset,voice.model_revision),
            reference_audio_url: url, reference_file: voice.file_path ? path.basename(voice.file_path) : undefined,
            rate_percent: part.rate_percent, pitch_hz: part.pitch_hz, pause_ms: part.pause_ms,
            ...(part.experimental_cues ? {experimental_cues:true} : {}) };
    }
    async function makePart(part) {
        const id = partId(part);
        const audio = await timed('audio', async () => engine('part', await partPayload(part), guard));
        artifactPath(job._id, audio.output_path);
        if (!Number.isFinite(audio.duration_seconds) || audio.duration_seconds <= 0) throw new Error('Đoạn âm thanh thiếu thời lượng.');
        return { ...audio, part_id: id };
    }
    async function publish(file, name, type) {
        if (storage.isR2Enabled()) {
            const key = `generated/${name}`;
            await timed('upload', () => storage.uploadFile(file, key, type)); return key;
        }
        const destination = path.join(__dirname, '../public/audio/generated', name);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(file, `${destination}.tmp`); await fs.rename(`${destination}.tmp`, destination);
        return `${(process.env.PUBLIC_BACKEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/public/audio/generated/${name}`;
    }
    if (job.work_action === 'preview') {
        await save('preview', 56, 'Tạo đoạn nghe thử bằng giọng đã chọn.');
        const samples = planned ? speech.plan({ sections: draft.sections, speech: draft.speech, style: draft.style }).parts : content.narration('', draft.sections, draft.style);
        const ids=[]; let budget=30;
        for (const part of samples.slice(0,8)) {
            if (budget<=0) break;
            const limit=Math.max(1,Math.floor(Math.max(0,budget-part.pause_ms/1000)*300*(1+part.rate_percent/100)/60));
            const words=part.text.split(/\s+/u).filter(Boolean);
            const sample={...part,text:speech.clipText(part.text,limit),pause_ms:words.length>limit?0:part.pause_ms};
            const audio=await makePart(sample);ids.push(audio.part_id);budget-=audio.duration_seconds;
        }
        const previewMerged=await engine('merge',{job_id:String(job._id),part_ids:ids},guard);
        const previewId=path.basename(previewMerged.output_path).match(/^final_([a-f0-9]{64})[.]mp3$/)?.[1];
        if (!previewId) throw new Error('Đường dẫn nghe thử không hợp lệ.');
        const clip = await timed('preview', () => engine('preview', { job_id: String(job._id), part_id: previewId, merged:true }, guard));
        const file = artifactPath(job._id, clip.output_path);
        draft.preview = { audio_url: await publish(file, `book-preview-${job._id}-${path.basename(file)}`, 'audio/mpeg'), duration_seconds: clip.duration_seconds,
            content_hash: content.textHash(draft.sections), speech_plan_hash: planned?.hash };
        await returnForReview(draft, 'Đoạn nghe thử đã sẵn sàng. Bạn có thể tạo toàn bộ âm thanh khi hài lòng.');
        return;
    }
    if (job.work_action !== 'audio' || job.approved_revision !== job.draft_revision) throw new Error('Chưa duyệt đúng phiên bản bản tóm tắt.');
    const userApproved=draft.user_edited && draft.user_approval?.method==='user'
        && draft.user_approval.user_id===String(job.user_id) && draft.user_approval.revision===job.draft_revision
        && draft.user_approval.content_hash===content.textHash(draft.sections);
    if(userApproved) {draft.verification_method='user';draft.verified_hash=null;}
    if (!userApproved && draft.verified_hash !== content.textHash(draft.sections) && !await verify(draft, false)) {
        draft.preview = null;
        await returnForReview(draft, 'Bản chỉnh sửa còn điểm chưa khớp nguồn. Hãy xem nhận xét và chỉnh lại trước khi tạo âm thanh.');
        return;
    }
    const parts = narrationParts;
    const estimated = content.estimate(draft);
    if (estimated >= config.maxAudioSeconds) throw new Error('Kịch bản dự kiến đạt 1 giờ. Hãy quay lại bản tóm tắt và rút gọn trước khi tạo âm thanh.');
    task.parts ||= [];
    const prefetch = await require('../app/services/edge_prefetch.service')({
        jobId: job._id, provider: checkpoint.voice.provider || 'edge', parts, payload: partPayload, guard, timed,
        skip: i => task.parts[i]?.part_id === partId(parts[i]),
    });
    try {
        for (let i = 0; i < parts.length; i++) {
            await save('audio', 55 + i / parts.length * 38, `Tạo âm thanh đoạn ${i + 1}/${parts.length}`);
            const id = partId(parts[i]);
            const expected = path.join(config.artifactRoot, String(job._id), `${id}.wav`);
            let saved = task.parts[i];
            if (saved?.part_id !== id || (!await exists(expected) && !await restore(saved.storage_key, expected))) saved = null;
            if (!saved) {
                await prefetch.ready(i);
                prefetch.advance(i + 1);
                const audio = await makePart(parts[i]);
                const storageKey = `generated/book-${job._id}-${id}.wav`;
                if (storage.isR2Enabled()) await timed('upload', () => storage.uploadFile(expected, storageKey, 'audio/wav'));
                saved = { part_id: id, duration_seconds: audio.duration_seconds, speech_duration_seconds: audio.speech_duration_seconds, storage_key: storage.isR2Enabled() ? storageKey : null };
                task.parts[i] = saved;
            }
            prefetch.advance(i + 1);
            await save('audio', 55 + (i + 1) / parts.length * 38);
            if (task.parts.slice(0, i + 1).reduce((sum, part) => sum + part.duration_seconds, 0) >= config.maxAudioSeconds) throw new Error('Thời lượng âm thanh đã đạt 1 giờ. Hãy quay lại bản tóm tắt và rút gọn.');
        }
    } finally { await prefetch.close(); }
    task.parts = task.parts.slice(0, parts.length);
    await save('merge', 94);
    const merged = await timed('merge', () => engine('merge', { job_id: String(job._id), part_ids: task.parts.map(part => part.part_id) }, guard));
    if (!Number.isFinite(merged.duration_seconds) || merged.duration_seconds <= 0 || merged.duration_seconds >= config.maxAudioSeconds) throw new Error('Thời lượng âm thanh không hợp lệ hoặc đạt 1 giờ. Hãy rút gọn bản tóm tắt.');
    await save('publishing', 97, 'Đang lưu âm thanh và lịch sử.');
    const file = artifactPath(job._id, merged.output_path);
    const audioUrl = await publish(file, `book-${job._id}-${path.basename(file)}`, 'audio/mpeg');
    const subtitleName = `book-${job._id}-${path.basename(file, '.mp3')}.srt`;
    const subtitleFile = path.join(path.dirname(file),path.basename(file,'.mp3')+'.srt');
    await fs.writeFile(subtitleFile, speech.subtitles(parts,task.parts), 'utf8');
    const subtitleUrl = await publish(subtitleFile, subtitleName, 'application/x-subrip; charset=utf-8');
    await guard(true);
    const summary = [draft.introduction, ...draft.sections.map(section => section.text)].join('\n\n');
    const warning = Math.abs(merged.duration_seconds - job.target_minutes * 60) > job.target_minutes * 60 * 0.15
        ? 'Thời lượng thực tế lệch mốc đã chọn. Hệ thống giữ nguyên nội dung đã duyệt, không thêm hoặc cắt ý để đủ phút.' : '';
    await History.updateOne({ book_job_id: job._id }, { $setOnInsert: { book_job_id: job._id, user_id: job.user_id, title: job.title,
        text: summary, teacher_id: checkpoint.voice.voice_id, style_id: draft.style, audio_url: audioUrl,
        target_minutes: job.target_minutes, duration_seconds: merged.duration_seconds, voice_mode: job.voice_mode, book_metadata: metadata, ai_assisted: true,
        speech_config: { ...(draft.speech || {}), provider:checkpoint.voice.provider || 'edge', model_revision:checkpoint.voice.model_revision,
            voice_origin:checkpoint.voice.origin,
            verification_method:userApproved?'user':'ai',user_approval:draft.user_approval||null,
            deliveries: draft.sections.map(section => section.delivery) },
        subtitle_url: subtitleUrl, subtitle_timing: 'estimated-within-measured-segments' } }, { upsert: true });
    const result = await Job.updateOne({ _id: job._id, status: 'processing', lease_owner: workerId,
        cancel_requested: false, lease_until: { $gt: new Date() } }, { $set: { status: 'completed', checkpoint, draft,
        result: { audio_url: audioUrl, subtitle_url: subtitleUrl, subtitle_timing:'estimated-within-measured-segments', summary, duration_seconds: merged.duration_seconds, target_minutes: job.target_minutes,
            genre: draft.genre, voice: checkpoint.voice.name, tts_provider:checkpoint.voice.provider || 'edge', style: draft.style, reason: draft.reason, warning,
            verification_method:userApproved?'user':'ai',
            book_metadata: metadata, ai_assisted: true, ai_notice: AI_SUMMARY_NOTICE, processing_times: checkpoint.timings },
        progress: { phase: 'completed', percent: 100, message: 'Đã tạo và lưu sách nói vào lịch sử.' }, error: '',
    }, $unset: { lease_owner: '', lease_until: '' } });
    if (!result.matchedCount) throw new Interrupted();
};
