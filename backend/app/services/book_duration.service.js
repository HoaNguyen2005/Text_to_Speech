const { ReadingProfile } = require('../models/book_cache.model');
const content = require('./book_content.service');
const storage = require('./storage.service');
const providers = require('./tts_provider.service');
const path = require('path');
const fs = require('fs/promises');

const VERSION = 'measured-duration-2';
const sample = 'Mỗi cuốn sách mở ra một cách nhìn mới về cuộc sống. Khi đọc, chúng ta không chỉ ghi nhớ những câu chữ, mà còn tìm hiểu ý nghĩa phía sau câu chuyện. Hãy dành một chút thời gian để lắng nghe, suy ngẫm và kết nối điều vừa học với trải nghiệm của mình. Một ý tưởng chỉ trở nên hữu ích khi được hiểu đúng trong hoàn cảnh của nó.';
const validRate = rate => Number.isFinite(rate) && rate >= 80 && rate <= 600;

// Measure once at 1x, separately for each engine/model/reference revision.
// Playback rate is applied later by the same planner used for narration.
async function readingKey(voice, mode) {
    let revision = '';
    if (voice.file_path && !storage.isStorageKey(voice.file_path)) {
        const stat = await fs.stat(path.join(__dirname, '../..', voice.file_path));
        revision = `${stat.size}:${stat.mtimeMs}`;
    }
    // Whitelist ordered values: PostgreSQL JSONB can reorder object properties.
    return content.hash(JSON.stringify([VERSION, mode, voice.voice_id, voice.file_path || '', voice.gender,
        voice.provider || 'edge', voice.model_revision || '', voice.preset || '', revision]));
}
async function calibrate(job, context) {
    const voice = context.checkpoint.voice;
    const key = await readingKey(voice, job.voice_mode);
    const previous = context.checkpoint.editorial.reading_rate;
    if (previous?.key === key && validRate(previous.units_per_minute)) return previous;
    const cached = await ReadingProfile.findOne({ _id: key, expires_at: { $gt: new Date() } }).lean();
    if (cached && validRate(cached.units_per_minute)) return { key, units_per_minute: cached.units_per_minute, version: VERSION };
    await context.save('calibration', 1, 'Đo tốc độ giọng đã chọn để tính độ dài bản tóm tắt.');
    const referenceUrl = job.voice_mode === 'clone' && storage.isStorageKey(voice.file_path) ? await storage.resolveUrl(voice.file_path) : undefined;
    const audio = await context.timed('calibration', () => context.engine('part', {
        job_id: String(job._id), part_id: content.hash(`${key}:${sample}`), text: sample,
        mode: job.voice_mode, gender: voice.gender, style: 'normal', reference_key: key,
        ...providers.settings(voice.provider || 'edge', voice.preset, voice.model_revision),
        reference_audio_url: referenceUrl,
        reference_file: voice.file_path ? path.basename(voice.file_path) : undefined,
        rate_percent: 0, pitch_hz: 0, pause_ms: 0,
    }, context.guard));
    context.artifactPath(job._id, audio.output_path);
    const seconds = audio.speech_duration_seconds ?? audio.duration_seconds;
    const rate = content.units(sample) * 60 / seconds;
    if (!Number.isFinite(seconds) || seconds <= 0 || !validRate(rate)) throw new Error('Không đo được tốc độ giọng hợp lệ. Kiểm tra Engine và thử lại.');
    await context.guard();
    await ReadingProfile.updateOne({ _id: key }, { $set: {
        units_per_minute: rate, seconds, expires_at: new Date(Date.now() + 30 * 86400000),
    } }, { upsert: true });
    return { key, units_per_minute: rate, version: VERSION };
}

function budget(source, introduction, minutes, baseRate, ratePercent = 0, sections = 1) {
    const rate = baseRate * (1 + ratePercent / 100);
    const pauses = .65 + sections * 1.4;
    const requested = Math.max(20, Math.floor((minutes * 60 - pauses) * rate / 60 - content.units(introduction)));
    // Source length is an upper estimate, not proof of sufficient information
    // or permission to reproduce a work. Semantic adequacy is checked by the AI.
    const capacity = Math.max(20, content.units(source));
    const target = Math.min(requested, capacity);
    return { version: VERSION, target_units: target, requested_units: requested,
        source_limited: capacity < requested * .85,
        source_capacity_seconds: Math.round((capacity + content.units(introduction)) * 60 / rate + pauses) };
}

function audit(draft, targetMinutes) {
    const estimated = content.estimate(draft), target = targetMinutes * 60;
    return { target_seconds: target, estimated_seconds: estimated,
        deviation_percent: Math.round((estimated - target) / target * 100),
        outside_tolerance: Math.abs(estimated - target) > target * .15,
        source_limited: Boolean(draft.duration_budget?.source_limited && estimated < target * .85) };
}
function annotate(draft, targetMinutes) {
    draft.duration_fit = audit(draft, targetMinutes);
    draft.estimated_seconds = draft.duration_fit.estimated_seconds;
    draft.warning = !draft.duration_fit.outside_tolerance ? ''
        : draft.duration_fit.source_limited
            ? 'Nguồn hiện có chưa đủ để đạt thời lượng đã chọn. Hãy thêm nội dung nguồn hoặc chấp nhận bản ngắn hơn; hệ thống không bịa hay lặp ý để kéo dài.'
            : 'Bản tóm tắt còn lệch thời lượng đã chọn. Bạn có thể căn lại thời lượng trước khi duyệt tạo âm thanh.';
    return draft;
}

function sourceIssue(source, intro, minutes, baseRate = 300, ratePercent = 0, measured = false) {
    const target = budget(source, intro, minutes, baseRate, ratePercent, Math.ceil(minutes / 1.25));
    if (!target.source_limited) return null;
    let maxMinutes = 0;
    for (let candidate = 1; candidate <= 59; candidate++) {
        if (!budget(source, intro, candidate, baseRate, ratePercent, Math.ceil(candidate / 1.25)).source_limited) maxMinutes = candidate;
    }
    return { source_units: content.units(source), target_minutes: minutes,
        estimated_seconds: target.source_capacity_seconds, max_minutes: maxMinutes || null,
        rate_basis: measured ? 'measured' : 'estimated' };
}
async function checkSource(source, intro, minutes, voice, mode, speechOptions = {}, readingRate) {
    let baseRate = readingRate?.units_per_minute;
    if (!validRate(baseRate)) {
        const key = await readingKey(voice, mode);
        const profile = await ReadingProfile.findOne({ _id:key, expires_at:{$gt:new Date()} }).lean();
        baseRate = profile?.units_per_minute;
    }
    return sourceIssue(source, intro, minutes, validRate(baseRate) ? baseRate : 300,
        speechOptions?.rate_percent ?? 0, validRate(baseRate));
}
function rejectSource(issue) {
    if (!issue) return;
    throw Object.assign(new Error(issue.max_minutes
        ? `Nguồn quá ngắn so với ${issue.target_minutes} phút đã chọn. Hãy chọn tối đa khoảng ${issue.max_minutes} phút hoặc thêm nội dung nguồn.`
        : 'Nguồn quá ngắn để tạo bản tóm tắt từ 1 phút. Hãy thêm nội dung nguồn trước khi tiếp tục.'), {
        status:422, code:'SOURCE_TOO_SHORT', duration_issue:issue,
    });
}
module.exports = { VERSION, calibrate, budget, audit, annotate, checkSource, sourceIssue, rejectSource };
