// Run independently of HTTP: npm run worker:books. PostgreSQL checkpoints survive restarts.
const config = require('../app/config/book');
const database = require('../app/db/postgres');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { pipeline: streamPipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');
const Job = require('../app/models/book_job.model');
const User = require('../app/models/user.model');
const Voice = require('../app/models/voice.model');
const History = require('../app/models/generated_lecture.model');
const { BookCache, ReadingProfile, WorkerLease } = require('../app/models/book_cache.model');
const { keycloakService } = require('../app/services/keycloak.service');
const storage = require('../app/services/storage.service');
const llm = require('../app/services/book_llm.service');
const reliability = require('../app/services/gemini_reliability');
const language = require('../app/services/book_language');
const { normalizeMetadata, introduction, AI_SUMMARY_NOTICE } = require('../app/services/book_metadata.service');
const workerId = crypto.randomUUID();
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const expiry = (days) => new Date(Date.now() + days * 86400000);
const usableNote = (text) => typeof text === 'string' && Boolean(text.trim()) && !language.missingDiacritics(text);
const phaseNames = { analysis: 'Phân tích nguồn', outline: 'Lập dàn ý', calibration: 'Đo tốc độ giọng đọc', script: 'Viết kịch bản', verification: 'Đối chiếu bản tóm tắt với nguồn', review: 'Chờ duyệt nội dung', preview: 'Tạo đoạn nghe thử', audio: 'Tạo từng đoạn âm thanh', merge: 'Ghép và lưu sách nói' };
let stopping = false;
let activeJob;
let heartbeat;
let leaseLost = false;

class Interrupted extends Error { constructor(cancelled = false) { super('Worker bị ngắt hoặc yêu cầu đã hủy.'); this.cancelled = cancelled; } }
async function engine(endpoint, payload, guard = async () => {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
        await guard();
        try {
            const response = await fetch(`${config.engineUrl}/book/${endpoint}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Book-Engine-Secret': config.engineSecret },
                body: JSON.stringify(payload), signal: AbortSignal.timeout(config.engineTimeout),
            });
            const result = await response.json();
            if (!response.ok) {
                const detail = typeof result.detail === 'string' ? result.detail : result.detail?.message;
                const error = new Error(response.status === 403 ? 'Khóa nội bộ Engine không khớp. Khởi động lại Backend/Engine/worker.' : detail || 'Engine chưa sẵn sàng.');
                error.retryable = response.status >= 500 && result.detail?.retryable !== false;
                throw error;
            }
            await guard();
            return result;
        } catch (error) {
            if (error instanceof Interrupted) throw error;
            if ((error.retryable || error.name === 'TimeoutError' || error.name === 'TypeError') && attempt < 2) {
                await llm.delay(4000 * (attempt + 1)); continue;
            }
            if (error.name === 'TimeoutError' || error.name === 'TypeError') throw new Error('Không kết nối được Engine hoặc đoạn âm thanh quá hạn. Chạy Engine rồi thử lại.');
            throw error;
        }
    }
}
function artifactPath(jobId, file) {
    const resolved = path.resolve(file);
    const directory = path.join(config.artifactRoot, String(jobId));
    if (path.dirname(resolved) !== directory || !/^[a-z0-9_.-]+$/.test(path.basename(resolved))) throw new Error('Engine trả đường dẫn âm thanh không hợp lệ.');
    return resolved;
}
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function restore(key, file) {
    if (!storage.isR2Enabled() || !storage.isStorageKey(key)) return false;
    const response = await fetch(await storage.resolveUrl(key), { signal: AbortSignal.timeout(120000) });
    if (!response.ok) return false;
    await fs.mkdir(path.dirname(file), { recursive: true });
    let bytes = 0;
    const bound = new Transform({ transform(chunk, encoding, callback) {
        bytes += chunk.length;
        callback(bytes > 50 * 1024 * 1024 ? new Error('Đoạn âm thanh vượt giới hạn.') : null, chunk);
    } });
    const temp = `${file}.download`;
    try {
        await streamPipeline(Readable.fromWeb(response.body), bound, require('fs').createWriteStream(temp));
        await fs.rename(temp, file);
        return true;
    } finally { await fs.unlink(temp).catch(() => {}); }
}

async function processJob(job, aiProgress) {
    if (!Number.isInteger(job.target_minutes) || job.target_minutes < config.minMinutes || job.target_minutes > config.maxMinutes) {
        throw new Error('Thời lượng phải là số phút nguyên từ 1 đến 59. Hãy tạo yêu cầu mới.');
    }
    let checkpoint = job.checkpoint || {};
    checkpoint.timings ||= {};
    async function timed(stage, operation) {
        const start = performance.now();
        try { return await operation(); }
        finally {
            const elapsed = Math.round(performance.now() - start);
            const metric = checkpoint.timings[stage] ||= { milliseconds: 0, calls: 0 };
            metric.milliseconds += elapsed;
            metric.calls++;
            // Summed call durations can overlap during source analysis.
            console.log(`[BOOK TIMING] job=${job._id} stage=${stage} elapsed_ms=${elapsed}`);
        }
    }
    const selectedVoice = job.selected_voice || checkpoint.voice;
    if (!selectedVoice || !selectedVoice.voice_id || !['male', 'female'].includes(selectedVoice.gender)) {
        throw new Error('Chưa có giọng đọc được chọn cho yêu cầu cũ. Hãy tạo yêu cầu mới và chọn giọng cụ thể.');
    }
    if (checkpoint.voice && ['voice_id', 'gender', 'file_path', 'provider', 'model_revision', 'preset'].some((key) => checkpoint.voice[key] !== selectedVoice[key])) {
        throw new Error('Giọng đọc không khớp checkpoint. Hãy tạo yêu cầu mới khi muốn đổi giọng.');
    }
    if (job.voice_mode === 'standard' && !config.standardVoices.some((voice) => voice.voice_id === selectedVoice.voice_id && voice.gender === selectedVoice.gender)) {
        throw new Error('Giọng tiêu chuẩn đã chọn không hợp lệ. Hãy tạo yêu cầu mới.');
    }
    checkpoint.voice ||= { ...selectedVoice };
    let owner;
    let lastIdentityAt = 0;
    let currentRole;
    async function guard(forceIdentity = false) {
        if (stopping || leaseLost) throw new Interrupted();
        const state = await Job.findOne({ _id: job._id, status: 'processing', lease_owner: workerId, lease_until: { $gt: new Date() } }).select('cancel_requested delete_requested').lean();
        if (!state) throw new Interrupted();
        if (state.cancel_requested || state.delete_requested) throw new Interrupted(true);
        owner = await User.findById(job.user_id).lean();
        if (!owner || owner.status !== 'active' || owner.authSyncPending || owner.authProvisioning || !owner.keycloakId) {
            throw new Error('Tài khoản không hoạt động hoặc đang chờ đồng bộ. Hãy liên hệ quản trị viên trước khi thử lại.');
        }
        if (forceIdentity || Date.now() - lastIdentityAt > 60000) {
            const identity = await keycloakService().identity(owner.keycloakId);
            if (!identity.user.enabled || (identity.user.attributes?.legacyStatus?.[0] && identity.user.attributes.legacyStatus[0] !== 'active')) throw new Error('Tài khoản đã bị vô hiệu hóa trên Keycloak.');
            currentRole = identity.role;
            lastIdentityAt = Date.now();
        }
        owner.role = currentRole;
        if (checkpoint.voice && job.voice_mode === 'clone') {
            const voice = await Voice.findOne({ voice_id: checkpoint.voice.voice_id, is_active: true }).lean();
            if (!require('../app/services/voice_access').visible(voice,owner)) throw new Error('Giọng đọc đã bị ẩn, xóa hoặc bạn không còn quyền sử dụng.');
            if (voice.file_path !== checkpoint.voice.file_path || voice.gender !== checkpoint.voice.gender) throw new Error('Giọng mẫu đã thay đổi. Hãy tạo yêu cầu mới để giữ âm sắc thống nhất.');
        }
    }
    guard.aiProgress = aiProgress;
    async function save(phase, percent, message) {
        await guard();
        const updates = { checkpoint, progress: { phase, percent: Math.floor(percent), message: message || phaseNames[phase] } };
        if (aiProgress.successes && aiProgress.retryState.provider === 'gemini') {
            aiProgress.retryState = { ...aiProgress.retryState, automatic: false, attempts: 0, first_failure_at: null, recovered_at: new Date().toISOString() };
            updates.retry_state = aiProgress.retryState;
            updates.next_attempt_at = null;
        }
        const result = await Job.updateOne({ _id: job._id, lease_owner: workerId, status: 'processing', cancel_requested: false, lease_until: { $gt: new Date() } },
            { $set: updates });
        if (!result.matchedCount) throw new Interrupted();
    }
    async function compress(key, texts) {
        checkpoint.compressions ||= {};
        const memo = checkpoint.compressions[key] ||= { rounds: [] };
        let items = texts;
        let round = 0;
        while (items.join('\n\n').length > 14000) {
            if (round > 5) throw new Error('Tài liệu quá phức tạp để gộp. Hãy chia thành các tập nhỏ hơn.');
            const groups = [];
            let group = [];
            let size = 0;
            for (const item of items) {
                if (size + item.length > 14000 && group.length) { groups.push(group.join('\n\n')); group = []; size = 0; }
                group.push(item); size += item.length + 2;
            }
            if (group.length) groups.push(group.join('\n\n'));
            const outputs = memo.rounds[round] ||= [];
            for (let i = 0; i < groups.length; i++) {
                if (usableNote(outputs[i])) continue;
                outputs[i] = await timed('reduce', () => llm.reduce(groups[i], guard));
                await save('outline', 24, `Đang gộp ý chính · lượt ${round + 1}, phần ${i + 1}/${groups.length}`);
            }
            items = outputs.slice(0, groups.length);
            round++;
        }
        return items.join('\n\n');
    }
    await guard(true);
    if (checkpoint.version && checkpoint.version !== config.version) throw new Error('Pipeline đã đổi phiên bản. Tạo yêu cầu mới để giữ dữ liệu nhất quán.');
    checkpoint.version = config.version;
    if (job.workflow_version === 'review-v1') {
        await require('./book.editorial')(job, { checkpoint, guard, save, timed, engine, artifactPath, restore, exists, workerId, Interrupted });
        return;
    }
    const sourceChunks = llm.splitText(job.source);
    const cacheVersion = `${config.version}:${config.languageVersion}`;
    // Old cache may still provide good notes. Validate every entry before use,
    // regenerate only the invalid ones, and publish into the new cache namespace.
    const cached = await BookCache.findOne({ user_id: job.user_id, source_hash: job.source_hash, version: cacheVersion, expires_at: { $gt: new Date() } }).lean()
        || await BookCache.findOne({ user_id: job.user_id, source_hash: job.source_hash, version: config.version, expires_at: { $gt: new Date() } }).lean();
    checkpoint.notes ||= cached?.notes || [];
    let analysisChanged = false;
    for (let start = 0; start < sourceChunks.length; start += config.analysisConcurrency) {
        const indices = [];
        for (let i = start; i < Math.min(sourceChunks.length, start + config.analysisConcurrency); i++) {
            if (!usableNote(checkpoint.notes[i])) indices.push(i);
        }
        if (!indices.length) continue;
        if (!analysisChanged) {
            checkpoint.overview = null;
            checkpoint.briefs = [];
            checkpoint.compressions = {};
            analysisChanged = true;
        }
        const done = () => checkpoint.notes.filter(usableNote).length;
        await save('analysis', 2 + done() / sourceChunks.length * 20, `Phân tích nguồn · đã xong ${done()}/${sourceChunks.length} phần`);
        // Only note requests overlap. Wait for every result before touching the
        // checkpoint; retain successful siblings even if one request fails.
        const results = await Promise.allSettled(indices.map((i) => timed('analysis', () => llm.note(sourceChunks[i], guard))));
        results.forEach((result, i) => { if (result.status === 'fulfilled') checkpoint.notes[indices[i]] = result.value; });
        await save('analysis', 2 + done() / sourceChunks.length * 20, `Phân tích nguồn · đã xong ${done()}/${sourceChunks.length} phần`);
        const failure = results.find((result) => result.status === 'rejected');
        if (failure) throw failure.reason;
    }
    const previousOverview = checkpoint.overview || (!analysisChanged && cached?.overview);
    checkpoint.overview = usableNote(previousOverview) ? previousOverview : await compress('overview', checkpoint.notes.map((n, i) => `[Phần ${i}] ${n}`));
    await BookCache.updateOne({ user_id: job.user_id, source_hash: job.source_hash, version: cacheVersion },
        { $set: { notes: checkpoint.notes, overview: checkpoint.overview, expires_at: expiry(7) } }, { upsert: true });

    if (!checkpoint.plan) {
        await save('outline', 25);
        checkpoint.plan = await timed('outline', () => llm.outline(checkpoint.overview, checkpoint.notes, job.target_minutes, guard));
        await save('outline', 27);
    }
    if (!checkpoint.referenceKey) {
        const voice = checkpoint.voice;
        // New uploads use immutable UUID keys; local legacy samples additionally use their file version.
        let revision = '';
        if (voice.file_path && !storage.isStorageKey(voice.file_path)) {
            const stat = await fs.stat(path.join(__dirname, '..', voice.file_path));
            revision = `${stat.size}:${stat.mtimeMs}`;
        }
        checkpoint.referenceKey = hash(`${voice.file_path || voice.gender}:${revision}`);
        await save('outline', 27);
    }
    async function makePart(text, partId, stage = 'audio') {
        const voice = checkpoint.voice;
        const url = job.voice_mode === 'clone' && storage.isStorageKey(voice.file_path) ? await storage.resolveUrl(voice.file_path) : undefined;
        return timed(stage, () => engine('part', { job_id: String(job._id), part_id: partId, text, mode: job.voice_mode,
            gender: voice.gender, style: checkpoint.plan.style, reference_key: checkpoint.referenceKey,
            reference_audio_url: url, reference_file: voice.file_path ? path.basename(voice.file_path) : undefined }, guard));
    }
    const partId = (text) => hash(JSON.stringify([config.version, text, job.voice_mode, checkpoint.voice.gender, checkpoint.referenceKey, checkpoint.plan.style]));
    if (!checkpoint.rate) {
        await save('calibration', 28);
        const key = hash(`${checkpoint.referenceKey}:${job.voice_mode}:${checkpoint.plan.style}:${config.version}`);
        const measured = await ReadingProfile.findOne({ _id: key, expires_at: { $gt: new Date() } }).lean();
        if (measured) checkpoint.rate = measured.units_per_minute;
        else {
            const sample = 'Mỗi cuốn sách mở ra một cách nhìn mới về cuộc sống. Khi đọc, chúng ta không chỉ ghi nhớ những câu chữ, mà còn tìm hiểu ý nghĩa phía sau câu chuyện. Hãy dành một chút thời gian để lắng nghe, suy ngẫm và kết nối điều vừa học với trải nghiệm của mình. Một ý tưởng chỉ trở nên hữu ích khi được hiểu đúng trong hoàn cảnh của nó. Vì vậy, bản tóm tắt sẽ giữ các luận điểm chính, những ví dụ quan trọng và kết luận của tác giả. Các phần nối tiếp nhau theo một trình tự rõ ràng, giúp người nghe theo dõi nội dung và nhớ lại những điều cần thiết.';
            const audio = await makePart(sample, partId(sample), 'calibration');
            artifactPath(job._id, audio.output_path);
            const rate = llm.units(sample) * 60 / audio.duration_seconds;
            if (!Number.isFinite(rate) || rate < 80 || rate > 600) throw new Error('Tốc độ giọng đọc đo được không hợp lệ. Kiểm tra mẫu giọng và Engine.');
            checkpoint.rate = rate;
            await ReadingProfile.updateOne({ _id: key }, { $set: { units_per_minute: rate, seconds: audio.duration_seconds, expires_at: expiry(30) } }, { upsert: true });
        }
        await save('calibration', 30);
    }
    const targetUnits = Math.round(checkpoint.rate * job.target_minutes);
    const metadata = normalizeMetadata(job.book_metadata?.toObject ? job.book_metadata.toObject() : job.book_metadata, job.title);
    const attributionIntro = introduction(metadata);
    if (llm.units(job.source) < targetUnits * 1.2) throw new Error(`Nguồn quá ngắn để tóm tắt khoảng ${job.target_minutes} phút ở tốc độ giọng đã đo. Hãy thêm nội dung hoặc chọn thời lượng ngắn hơn.`);
    checkpoint.scripts ||= [];
    checkpoint.briefs ||= [];
    checkpoint.scriptDrafts ||= [];
    const introUnits = llm.units(attributionIntro);
    if (Math.round((targetUnits - introUnits) / checkpoint.plan.sections.length) < 20) throw new Error('Phần giới thiệu nguồn quá dài so với thời lượng đã chọn. Rút gọn tên sách/tác giả hoặc chọn thời lượng dài hơn.');
    async function writeSection(i, budget) {
        const text = await timed('script', () => llm.script(checkpoint.briefs[i], checkpoint.plan, i, Math.max(20, Math.round(budget)), checkpoint.scripts[i - 1] || '', guard, {
            draft: checkpoint.scriptDrafts[i],
            onDraft: async (draft) => {
                checkpoint.scriptDrafts[i] = draft;
                await save('script', 30 + i / checkpoint.plan.sections.length * 25, `Đang chỉnh độ dài mục ${i + 1}/${checkpoint.plan.sections.length} · ${draft.units}/${draft.target_units} âm tiết`);
            },
            onReject: async (draft) => {
                // Private checkpoint only: retain one rejected candidate per
                // section for diagnosis, never treat it as a TTS-ready draft.
                checkpoint.scriptRejections ||= [];
                checkpoint.scriptRejections[i] = draft;
                await save('script', 30 + i / checkpoint.plan.sections.length * 25, `Mục ${i + 1} chưa đạt yêu cầu dấu tiếng Việt · lượt ${draft.attempt}/2`);
            },
        }));
        checkpoint.scriptDrafts[i] = { ...checkpoint.scriptDrafts[i], text, units: llm.units(text), target_units: Math.max(20, Math.round(budget)) };
        return text;
    }
    // Validate resumed scripts too; previous successful audio is reused only
    // when its text hash still matches the corrected script.
    for (let i = 0; i < checkpoint.scripts.length; i++) {
        const previous = checkpoint.scripts[i];
        if (language.missingDiacritics(previous)) {
            const section = checkpoint.plan.sections[i];
            if (!usableNote(checkpoint.briefs[i])) checkpoint.briefs[i] = await compress(`section-${i}`, section.source_ids.map((id) => `[Phần ${id}] ${checkpoint.notes[id]}`));
            checkpoint.scriptDrafts[i] = null;
            await save('script', 30, `Viết lại mục ${i + 1} bằng tiếng Việt đầy đủ dấu.`);
            checkpoint.scripts[i] = await writeSection(i, Math.max(20, llm.units(previous)));
            await save('script', 30, `Đã viết lại mục ${i + 1} bằng tiếng Việt đầy đủ dấu.`);
        } else {
            checkpoint.scripts[i] = language.normalize(previous);
        }
    }
    for (let i = checkpoint.scripts.length; i < checkpoint.plan.sections.length; i++) {
        const section = checkpoint.plan.sections[i];
        if (!usableNote(checkpoint.briefs[i])) checkpoint.briefs[i] = await compress(`section-${i}`, section.source_ids.map((id) => `[Phần ${id}] ${checkpoint.notes[id]}`));
        await save('script', 30 + i / checkpoint.plan.sections.length * 25, `Viết kịch bản mục ${i + 1}/${checkpoint.plan.sections.length}`);
        const remaining = targetUnits - introUnits - checkpoint.scripts.reduce((total, text) => total + llm.units(text), 0);
        checkpoint.scripts.push(await writeSection(i, remaining / (checkpoint.plan.sections.length - i)));
        await save('script', 30 + (i + 1) / checkpoint.plan.sections.length * 25);
    }
    const scriptUnits = () => introUnits + checkpoint.scripts.reduce((total, text) => total + llm.units(text), 0);
    const outsideTotalBudget = () => scriptUnits() < targetUnits * 0.65 || scriptUnits() > targetUnits * 1.35;
    if (outsideTotalBudget()) {
        const last = checkpoint.scripts.length - 1;
        const remaining = targetUnits - introUnits - checkpoint.scripts.slice(0, last).reduce((total, text) => total + llm.units(text), 0);
        if (remaining >= 20) {
            const draft = checkpoint.scriptDrafts[last];
            if (!draft?.text || Math.abs(llm.units(draft.text) - remaining) > Math.abs(llm.units(checkpoint.scripts[last]) - remaining)) checkpoint.scriptDrafts[last] = { text: checkpoint.scripts[last] };
            const revised = await writeSection(last, remaining);
            if (Math.abs(scriptUnits() - llm.units(checkpoint.scripts[last]) + llm.units(revised) - targetUnits) < Math.abs(scriptUnits() - targetUnits)) checkpoint.scripts[last] = revised;
            await save('script', 55, 'Đã đối chiếu độ dài toàn kịch bản.');
        }
    }
    checkpoint.scriptBudget = { target_units: targetUnits, actual_units: scriptUnits(), estimated_seconds: scriptUnits() * 60 / checkpoint.rate };
    await save('script', 55);
    if (outsideTotalBudget()) throw new Error(`Kịch bản hiện ước tính ${Math.round(checkpoint.scriptBudget.estimated_seconds)} giây, mục tiêu ${job.target_minutes * 60} giây. Đã giữ bản nháp để thử lại chỉnh độ dài; chưa tạo âm thanh lệch quá nhiều.`);
    // Sentence boundaries with a hard character cap keep Edge-TTS AND OpenVoice bounded.
    const texts = [attributionIntro, ...checkpoint.scripts].flatMap((text) => llm.splitText(text, 1200));
    if (texts.length > 300) throw new Error('Kịch bản có quá nhiều đoạn. Tạo yêu cầu mới với thời lượng ngắn hơn.');
    checkpoint.parts ||= [];
    // A corrected script may split into fewer parts than a previous attempt.
    checkpoint.parts = checkpoint.parts.slice(0, texts.length);
    for (let i = 0; i < texts.length; i++) {
        await save('audio', 55 + i / texts.length * 38, `Tạo âm thanh đoạn ${i + 1}/${texts.length}`);
        const id = partId(texts[i]);
        const expected = path.join(config.artifactRoot, String(job._id), `${id}.wav`);
        let saved = checkpoint.parts[i];
        if (saved?.part_id !== id) saved = null;
        if (saved && !await exists(expected)) {
            if (!await restore(saved.storage_key, expected)) saved = null;
        }
        if (!saved) {
            const audio = await makePart(texts[i], id);
            const file = artifactPath(job._id, audio.output_path);
            if (!Number.isFinite(audio.duration_seconds) || audio.duration_seconds <= 0) throw new Error('Đoạn âm thanh thiếu thời lượng.');
            const storageKey = `generated/book-${job._id}-${id}.wav`;
            if (storage.isR2Enabled()) await timed('upload', () => storage.uploadFile(file, storageKey, 'audio/wav'));
            saved = { part_id: id, duration_seconds: audio.duration_seconds, storage_key: storage.isR2Enabled() ? storageKey : null };
            checkpoint.parts[i] = saved;
        }
        await save('audio', 55 + (i + 1) / texts.length * 38);
    }
    if (checkpoint.parts.reduce((total, part) => total + part.duration_seconds, 0) >= config.maxAudioSeconds) {
        throw new Error('Thời lượng âm thanh đã đạt 1 giờ. Hãy tạo yêu cầu mới với số phút ngắn hơn; hệ thống không tự cắt nội dung.');
    }
    await save('merge', 94);
    const merged = await timed('merge', () => engine('merge', { job_id: String(job._id), part_ids: checkpoint.parts.map((p) => p.part_id) }, guard));
    if (!Number.isFinite(merged.duration_seconds) || merged.duration_seconds <= 0) throw new Error('Thời lượng âm thanh sau ghép không hợp lệ.');
    if (merged.duration_seconds >= config.maxAudioSeconds) {
        throw new Error('Thời lượng âm thanh sau ghép đã đạt 1 giờ. Hãy tạo yêu cầu mới với số phút ngắn hơn.');
    }
    const finalPath = artifactPath(job._id, merged.output_path);
    await save('publishing', 97, 'Đang lưu âm thanh và lịch sử.');
    const filename = `book-${job._id}-${path.basename(finalPath)}`;
    let audioKey;
    if (storage.isR2Enabled()) {
        audioKey = `generated/${filename}`;
        await timed('upload', () => storage.uploadFile(finalPath, audioKey, 'audio/mpeg'));
    } else {
        const destination = path.join(__dirname, '../public/audio/generated', filename);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(finalPath, `${destination}.tmp`);
        await fs.rename(`${destination}.tmp`, destination);
        audioKey = `${(process.env.PUBLIC_BACKEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/public/audio/generated/${filename}`;
    }
    await guard(true);
    const summary = [attributionIntro, ...checkpoint.scripts].join('\n\n');
    const seconds = merged.duration_seconds;
    const warning = Math.abs(seconds - job.target_minutes * 60) > job.target_minutes * 60 * 0.15
        ? 'Thời lượng thực tế lệch hơn 15% so với mốc đã chọn do nhịp đọc và ngắt nghỉ. Nội dung được giữ trung thực với sách.' : '';
    await History.updateOne({ book_job_id: job._id }, { $setOnInsert: { book_job_id: job._id, user_id: job.user_id, title: job.title,
        text: summary, teacher_id: checkpoint.voice.voice_id, style_id: checkpoint.plan.style, audio_url: audioKey,
        target_minutes: job.target_minutes, duration_seconds: seconds, voice_mode: job.voice_mode,
        book_metadata: metadata, ai_assisted: true } }, { upsert: true });
    const completed = await Job.updateOne({ _id: job._id, lease_owner: workerId, status: 'processing', cancel_requested: false, lease_until: { $gt: new Date() } }, { $set: {
        status: 'completed', error: '', result: { audio_url: audioKey, summary, duration_seconds: seconds,
            target_minutes: job.target_minutes, genre: checkpoint.plan.genre, voice: checkpoint.voice.name,
            style: checkpoint.plan.style, reason: checkpoint.plan.reason, units_per_minute: checkpoint.rate, warning,
            book_metadata: metadata, ai_assisted: true, ai_notice: AI_SUMMARY_NOTICE, processing_times: checkpoint.timings },
        progress: { phase: 'completed', percent: 100, message: 'Đã tạo và lưu sách nói vào lịch sử.' }, checkpoint,
    }, $unset: { lease_owner: '', lease_until: '' } });
    if (!completed.matchedCount) throw new Interrupted();
}

async function maintainLease() {
    const now = new Date();
    const until = new Date(Date.now() + config.leaseMs);
    const result = await WorkerLease.updateOne({ _id: 'book-audio', owner: workerId, until: { $gt: now } }, { $set: { until } });
    if (!result.matchedCount) { leaseLost = true; return; }
    if (activeJob) {
        const renewed = await Job.updateOne({ _id: activeJob, status: 'processing', lease_owner: workerId, lease_until: { $gt: now } }, { $set: { lease_until: until } });
        if (!renewed.matchedCount) leaseLost = true;
    }
}
async function claimGlobalLease() {
    try {
        return Boolean(await WorkerLease.findOneAndUpdate({ _id: 'book-audio', $or: [{ until: { $lte: new Date() } }, { owner: workerId }] },
            { $set: { owner: workerId, until: new Date(Date.now() + config.leaseMs) } }, { upsert: true, returnDocument: 'after' }));
    } catch (error) { if (error.code === 11000) return false; throw error; }
}
async function cleanupTerminal() {
    // Failed jobs retain artifacts for retry. Completed/cancelled temporary files are disposable.
    const jobs = await Job.find({ artifacts_cleaned: { $ne: true }, status: { $in: ['completed', 'cancelled'] } }).select('+checkpoint').limit(10);
    for (const job of jobs) {
        if (leaseLost || stopping) return;
        try {
            // Never delete while a retried job is processing.
            if (!await Job.exists({ _id: job._id, status: job.status, updatedAt: job.updatedAt })) continue;
            if (job.delete_requested && await History.exists({ book_job_id: job._id })) continue;
            if(job.delete_requested && !await require('../app/services/book_preview.service').prune(String(job._id)))continue;
            await engine('cleanup', { job_id: String(job._id) });
            if (job.delete_requested) {
                await storage.deleteDiscardedBookAudio(String(job._id));
                // Retain only the submission identity and required operational fields.
                await Job.updateOne({ _id: job._id, status: 'cancelled', delete_requested: true }, {
                    $set: { artifacts_cleaned: true, title: 'Đã xóa', source_hash: '', draft_revision: 0,
                        progress: { phase: 'cancelled', percent: 0, message: 'Đã xóa.' }, error: '', runs: 0 },
                    $unset: { source: '', checkpoint: '', draft: '', approved_revision: '', book_metadata: '',
                        selected_voice: '', edit_request: '', retry_state: '', result: '', next_attempt_at: '', lease_owner: '', lease_until: '' },
                });
            } else {
                await storage.deleteBookParts(String(job._id));
                await Job.updateOne({ _id: job._id, status: job.status, delete_requested: false }, { $set: { artifacts_cleaned: true }, $unset: { source: '', checkpoint: '' } });
            }
        } catch { console.warn('[BOOK WORKER] Chưa dọn được file tạm; sẽ thử lại ở lượt sau.'); break; }
    }
}
async function main() {
    if (!config.engineSecret) throw new Error('Chạy npm run books:init trước.');
    await database.connect();
    await Promise.all([Job.init(), BookCache.init(), ReadingProfile.init(), WorkerLease.init(), History.init()]);
    if (process.env.BOOK_WORKER_ID_FILE) await fs.writeFile(process.env.BOOK_WORKER_ID_FILE, workerId, { mode: 0o600 });
    console.log('[BOOK WORKER] Sẵn sàng. Đóng bằng Ctrl+C; yêu cầu đang làm sẽ tiếp tục ở lần chạy sau.');
    while (!stopping) {
        if (!await claimGlobalLease()) { await llm.delay(5000); continue; }
        leaseLost = false;
        heartbeat = setInterval(() => maintainLease().catch(() => { leaseLost = true; }), 10000);
        try {
            while (!stopping && !leaseLost) {
                const job = await Job.findOneAndUpdate({ $or: [{ status: 'queued', delete_requested: false, $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: new Date() } }] }, { status: 'processing', lease_until: { $lte: new Date() } }] },
                    { $set: { status: 'processing', next_attempt_at: null, lease_owner: workerId, lease_until: new Date(Date.now() + config.leaseMs) }, $inc: { runs: 1 } },
                    { sort: { createdAt: 1 }, returnDocument: 'after' }).select('+source +checkpoint');
                if (!job) { await database.pruneExpired(); await cleanupTerminal(); await llm.delay(3000); continue; }
                activeJob = job._id;
                const aiProgress = { retryState: job.retry_state || {}, successes: 0 };
                try {
                    if (job.runs > 10 + (job.retry_state?.total_attempts || 0)) throw new Error('Yêu cầu đã bị ngắt quá nhiều lần. Kiểm tra worker rồi nhấn Thử lại.');
                    await processJob(job, aiProgress);
                } catch (error) {
                    const cancelled = (error instanceof Interrupted && error.cancelled)
                        || Boolean(await Job.exists({ _id: job._id, lease_owner: workerId, status: 'processing', cancel_requested: true }));
                    if (!(error instanceof Interrupted) || cancelled) {
                        if (!cancelled && error instanceof reliability.GeminiRequestError) {
                            const plan = reliability.retryPlan(error, aiProgress.retryState, aiProgress.successes);
                            const latest = await Job.findOne({ _id: job._id, lease_owner: workerId, status: 'processing' }).select('progress').lean();
                            const resumePhase = latest?.progress?.phase === 'retry_wait' ? aiProgress.retryState.resume_phase : latest?.progress?.phase;
                            const message = plan.allowed ? `${error.message} Hệ thống sẽ tự thử lại từ phần đã lưu.`
                                : error.retryable ? `${error.message} Đã hết ngân sách tự thử lại; tiến độ được giữ, hãy kiểm tra dịch vụ rồi tiếp tục.` : error.message;
                            const rescheduled = await Job.updateOne({ _id: job._id, lease_owner: workerId, status: 'processing', cancel_requested: false, lease_until: { $gt: new Date() } }, { $set: {
                                status: plan.allowed ? 'queued' : 'failed', error: plan.allowed ? '' : message,
                                next_attempt_at: plan.allowed ? plan.next : null,
                                retry_state: { ...plan.state, resume_phase: resumePhase || 'analysis', message },
                                progress: { phase: plan.allowed ? 'retry_wait' : 'failed', percent: latest?.progress?.percent || 0, message },
                            }, $unset: { lease_owner: '', lease_until: '' } });
                            if (!rescheduled.matchedCount) await Job.updateOne({ _id: job._id, lease_owner: workerId, status: 'processing', cancel_requested: true,
                                lease_until: { $gt: new Date() } }, { $set: { status: 'cancelled', error: '', next_attempt_at: null,
                                progress: { phase: 'cancelled', percent: latest?.progress?.percent || 0, message: 'Đã hủy; các phần tạm sẽ được dọn.' } },
                            $unset: { lease_owner: '', lease_until: '' } });
                            console.warn('[BOOK AI RETRY] ' + JSON.stringify({ job: job._id, code: error.code, http_status: error.httpStatus,
                                stage: error.stage, scheduled: plan.allowed, attempt: plan.state.attempts, total: plan.state.total_attempts,
                                retry_at: plan.allowed ? plan.next.toISOString() : null }));
                            continue;
                        }
                        const message = cancelled ? '' : safeMessage(error);
                        await database.transaction(async (client) => {
                            await client.query('SELECT _id FROM book_jobs WHERE _id=$1 FOR UPDATE', [job._id]);
                            const state = await Job.findOne({ _id: job._id, lease_owner: workerId, status: 'processing' });
                            const stop = cancelled || state?.cancel_requested || state?.delete_requested;
                            await Job.updateOne({ _id: job._id, lease_owner: workerId, status: 'processing', lease_until: { $gt: new Date() } }, { $set: {
                                status: stop ? 'cancelled' : 'failed', error: stop ? '' : message, next_attempt_at: null,
                                'progress.message': stop ? 'Đã hủy; các phần tạm sẽ được dọn.' : 'Đã dừng ở phần lỗi. Có thể thử lại từ điểm đã lưu.',
                                'progress.phase': stop ? 'cancelled' : 'failed',
                            }, $unset: { lease_owner: '', lease_until: '' } });
                        });
                        console.warn(`[BOOK WORKER] ${job._id}: ${cancelled ? 'cancelled' : error.name}`);
                    }
                } finally { activeJob = null; }
            }
        } finally {
            clearInterval(heartbeat);
            await WorkerLease.updateOne({ _id: 'book-audio', owner: workerId }, { $set: { until: new Date(0) } });
        }
    }
    await database.close();
}
function safeMessage(error) {
    if (error.code === 'SOURCE_TOO_SHORT') return error.message.slice(0, 500);
    if (error.code === 'SPEECH_VALIDATION') return error.message.slice(0, 500);
    if (error instanceof reliability.GeminiRequestError) return error.message;
    if (error.pgCode || /postgres|database|query|ECONNREFUSED|ECONNRESET/i.test(error.message)) return 'Không lưu được tiến độ vào PostgreSQL. Kiểm tra kết nối rồi thử lại.';
    if (error.status) return 'Không kiểm tra được trạng thái tài khoản Keycloak. Kiểm tra Docker/Keycloak rồi thử lại.';
    // Only known, authored Vietnamese messages are exposed; SDK errors may contain credentials/URLs.
    if (/^(Cần |Phần |Gemini |Không |Dàn |Danh sách tiêu đề |Tiêu đề |Ghi |Đề |Kịch |Nguồn |Giọng |Tài |Chưa |Pipeline |Tốc |Đoạn |Yêu |Khóa |Bản |Nội |Nhịp |Cao |Đối |OpenVoice |Edge|FFmpeg)/.test(error.message)) return error.message.slice(0, 500);
    return 'Xử lý sách nói bị gián đoạn. Kiểm tra cấu hình và dịch vụ, sau đó nhấn Thử lại.';
}
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
if (require.main === module) main().catch((error) => { console.error('[BOOK WORKER]', safeMessage(error)); process.exitCode = 1; database.close(); });
