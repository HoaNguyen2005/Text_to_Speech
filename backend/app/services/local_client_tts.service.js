const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const config = require('../config/book');
const { repository } = require('../db/repository');
const Job = require('../models/book_job.model');
const History = require('../models/generated_lecture.model');
const Preview = repository('book_previews');
const speech = require('./speech.service');
const storage = require('./storage.service');
const bookVoices = require('./book_voice.service');
const providers = require('./tts_provider.service');
const content = require('./book_content.service');
const duration = require('./book_duration.service');
const tiers = require('./account_tier.service');
const { normalizeMetadata, AI_SUMMARY_NOTICE } = require('./book_metadata.service');

const TOKEN_TTL_MS = 45 * 60 * 1000;
const problem = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

function signingKey() {
  const key = config.engineSecret || process.env.KEYCLOAK_SERVICE_CLIENT_SECRET || '';
  if (!key) throw problem(503, 'Chưa cấu hình khóa xác thực local TTS trên máy chủ.');
  return key;
}

function signToken(payload) {
  const body = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', signingKey()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token, expectedKind, userId, jobId = null) {
  if (typeof token !== 'string' || !token.includes('.')) throw problem(400, 'Mã xác thực phiên xử lý không hợp lệ.');
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) throw problem(400, 'Mã xác thực phiên xử lý không hợp lệ.');
  const expected = crypto.createHmac('sha256', signingKey()).update(encoded).digest();
  let provided;
  try { provided = Buffer.from(sig, 'base64url'); } catch { throw problem(400, 'Mã xác thực không hợp lệ.'); }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(expected, provided)) {
    throw problem(403, 'Chữ ký phiên xử lý không hợp lệ.');
  }
  let data;
  try { data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { throw problem(400, 'Dữ liệu phiên xử lý không hợp lệ.'); }
  if (!data || data.exp <= Date.now()) throw problem(410, 'Phiên xử lý âm thanh đã hết hạn. Vui lòng thử lại.');
  if (data.kind !== expectedKind || String(data.user_id) !== String(userId)) {
    throw problem(403, 'Phiên xử lý không khớp tài khoản hiện tại.');
  }
  if (jobId && String(data.job_id) !== String(jobId)) {
    throw problem(403, 'Phiên xử lý không khớp yêu cầu hiện tại.');
  }
  return data;
}

async function publishBuffer(buffer, filename, contentType) {
  if (storage.isR2Enabled()) {
    const key = `generated/${filename}`;
    await storage.uploadBuffer(buffer, key, contentType);
    return key;
  }
  const dir = path.resolve(__dirname, '../../public/audio/generated');
  await fs.mkdir(dir, { recursive: true });
  const destination = path.join(dir, filename);
  await fs.writeFile(`${destination}.tmp`, buffer);
  await fs.rename(`${destination}.tmp`, destination);
  return `${(process.env.PUBLIC_BACKEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/public/audio/generated/${filename}`;
}

function parseTimings(raw, expectedLength) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed) || parsed.length !== expectedLength || !parsed.length) {
    throw problem(400, 'Thiếu thông tin thời lượng các đoạn âm thanh.');
  }
  let total = 0;
  for (const item of parsed) {
    const sec = Number(item?.duration_seconds);
    if (!Number.isFinite(sec) || sec <= 0) throw problem(400, 'Thời lượng đoạn âm thanh không hợp lệ.');
    total += sec;
  }
  if (total >= config.maxAudioSeconds) throw problem(400, 'Âm thanh đạt 1 giờ. Hãy rút gọn nội dung.');
  return { timings: parsed, totalSeconds: total };
}

async function buildVoicePartBase(voice, mode, provider, jobId, referenceKey) {
  const settings = providers.settings(provider, voice.preset, voice.model_revision);
  const reference_audio_url = mode === 'clone' && storage.isStorageKey(voice.file_path)
    ? await storage.resolveUrl(voice.file_path)
    : undefined;
  return {
    job_id: jobId,
    mode,
    gender: voice.gender,
    reference_key: referenceKey,
    reference_file: voice.file_path ? path.basename(voice.file_path) : undefined,
    reference_audio_url,
    ...settings,
  };
}

async function authorizeLecture(user, body = {}, preview = false) {
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 20000) {
    throw problem(400, 'Bài giảng cần từ 1 đến 20.000 ký tự.');
  }
  const provider = providers.validate(body.tts_provider);
  const planned = speech.plan({
    sections: [{ text: body.text, delivery: { ...(body.delivery || {}), markup: body.text } }],
    speech: body.speech,
    style: body.style_id || 'normal',
  });
  if (body.speech_plan_hash !== planned.hash) {
    throw problem(409, 'Hãy xem cách đọc sau khi thay đổi nội dung hoặc cấu hình trước khi tiếp tục.');
  }
  if (planned.estimated_seconds >= config.maxAudioSeconds || planned.parts.length > 80) {
    throw problem(400, 'Bài giảng quá dài hoặc có quá nhiều đoạn. Hãy chia thành các phần nhỏ hơn.');
  }
  const mode = body.voice_mode || 'clone';
  const current = await tiers.currentUser(user);
  tiers.assertLectureAllowed(current, body.text.length);
  const voice = await bookVoices.resolve(mode, body.teacher_id, current, provider);

  await tiers.consume(current, preview ? 'previews' : 'lectures', async (locked) => {
    tiers.assertLectureAllowed(locked, body.text.length);
    tiers.assertVoiceAccessAllowed(locked, voice, provider, mode);
  });

  const jobId = crypto.randomBytes(12).toString('hex');
  const settings = providers.settings(provider, voice.preset, voice.model_revision);
  const referenceKey = voice.file_path || voice.voice_id;
  const base = await buildVoicePartBase(voice, mode, provider, jobId, referenceKey);

  let selectedParts = planned.parts;
  if (preview) {
    const clipped = [];
    let budget = 30;
    for (const part of planned.parts.slice(0, 8)) {
      if (budget <= 0) break;
      const words = part.text ? part.text.split(/\s+/u).filter(Boolean) : [];
      const limit = Math.max(1, Math.floor(Math.max(0, budget - part.pause_ms / 1000) * 300 * (1 + (part.rate_percent || 0) / 100) / 60));
      const item = part.text ? { ...part, text: speech.clipText(part.text, limit), pause_ms: words.length > limit ? 0 : part.pause_ms } : part;
      clipped.push(item);
      budget -= (item.text ? item.text.split(/\s+/u).filter(Boolean).length * 60 / (300 * (1 + (item.rate_percent || 0) / 100)) : 0) + item.pause_ms / 1000;
    }
    selectedParts = clipped.length ? clipped : planned.parts.slice(0, 1);
  }

  const parts = selectedParts.map((part) => ({
    ...base,
    part_id: crypto.createHash('sha256').update(JSON.stringify([mode, voice.voice_id, voice.file_path, part, settings])).digest('hex'),
    text: part.text,
    style: 'normal',
    rate_percent: part.rate_percent,
    pitch_hz: part.pitch_hz || 0,
    pause_ms: part.pause_ms || 0,
  }));

  const completion_token = signToken({
    kind: 'lecture',
    user_id: String(user._id),
    job_id: jobId,
    preview: Boolean(preview),
    parts: preview ? [] : parts.map((p) => ({ text: p.text, pause_ms: p.pause_ms })),
    meta: preview ? null : {
      text: planned.sections[0].text,
      teacher_id: voice.voice_id,
      style_id: planned.speech.profile,
      speech_config: {
        ...planned.speech,
        ...settings,
        voice_name: voice.name,
        voice_class: voice.class,
        voice_origin: voice.origin,
        voice_mode: mode,
        deliveries: planned.sections.map((s) => s.delivery),
      },
    },
  });

  return { job_id: jobId, preview: Boolean(preview), parts, completion_token };
}

async function completeLecture(user, body = {}, audioBuffer) {
  const token = verifyToken(body.completion_token, 'lecture', user._id);
  if (token.preview) throw problem(400, 'Phiên nghe thử không cần tải lên máy chủ.');
  if (!Buffer.isBuffer(audioBuffer) || !audioBuffer.length) throw problem(400, 'Thiếu file âm thanh hoàn chỉnh.');

  const { timings, totalSeconds } = parseTimings(body.timings, token.parts.length);
  const digest = crypto.createHash('sha256').update(audioBuffer).digest('hex').slice(0, 16);
  const audioName = `studio-${token.job_id}-${digest}.mp3`;
  const subtitleName = `studio-${token.job_id}-${digest}.srt`;
  const srt = speech.subtitles(token.parts, timings);

  const audioKey = await publishBuffer(audioBuffer, audioName, 'audio/mpeg');
  const subtitleKey = await publishBuffer(Buffer.from(srt, 'utf8'), subtitleName, 'application/x-subrip; charset=utf-8');

  const saved = await History.create({
    user_id: user._id,
    text: token.meta.text,
    teacher_id: token.meta.teacher_id,
    style_id: token.meta.style_id,
    audio_url: audioKey,
    subtitle_url: subtitleKey,
    subtitle_timing: 'estimated-within-measured-segments',
    duration_seconds: totalSeconds,
    speech_config: token.meta.speech_config,
  });

  return {
    status: 'success',
    history_id: saved._id,
    audio_url: await storage.resolveUrl(audioKey),
    subtitle_url: await storage.resolveUrl(subtitleKey),
    subtitle_timing: saved.subtitle_timing,
    duration_seconds: totalSeconds,
  };
}

async function authorizeBookAudio(user, job, body = {}, requestedAction = 'audio') {
  const action = requestedAction === 'preview' ? 'preview' : 'audio';
  tiers.assertBookSubmissionAllowed(user, { textLength: job.source?.length || 0, targetMinutes: job.target_minutes });
  const provider = job.selected_voice?.provider || 'edge';
  const voice = await bookVoices.resolve(job.voice_mode, job.selected_voice.voice_id, user, provider);

  const revision = body.revision;
  if (job.workflow_version !== 'review-v1' || job.status !== 'review' || !job.draft?.sections?.length) {
    throw problem(409, 'Bản tóm tắt chưa sẵn sàng. Hãy tải lại yêu cầu.');
  }
  if (!Number.isInteger(revision) || revision !== job.draft_revision) {
    throw problem(409, 'Bản tóm tắt đã đổi ở phiên khác. Hãy tải lại trước khi tiếp tục.');
  }

  const draft = structuredClone(job.draft);
  const planned = draft.speech ? speech.plan({
    introduction: draft.introduction || '',
    sections: draft.sections,
    speech: draft.speech,
    style: draft.style,
  }) : null;
  if (planned && body.speech_plan_hash !== planned.hash) {
    throw problem(409, 'Nội dung hoặc tốc độ vừa thay đổi. Hãy thử lại.');
  }

  const jobId = String(job._id);
  const settings = providers.settings(provider, voice.preset, voice.model_revision);
  const referenceKey = job.checkpoint?.referenceKey || content.hash(`${voice.voice_id}:${voice.file_path || voice.gender}`);
  const base = await buildVoicePartBase(voice, job.voice_mode, provider, jobId, referenceKey);

  const makeBookPartId = (part) => content.hash(JSON.stringify([
    config.editorialVersion, config.narrationVersion, referenceKey, job.voice_mode, draft.style, part,
    ...(voice.model_revision ? [provider, voice.model_revision, voice.preset] : []),
  ]));

  if (action === 'preview') {
    await tiers.consume(user, 'previews', async (current) => {
      tiers.assertVoiceAccessAllowed(current, voice, provider, job.voice_mode);
    });
    const samples = planned
      ? speech.plan({ sections: draft.sections, speech: draft.speech, style: draft.style }).parts
      : content.narration('', draft.sections, draft.style);
    const chosenSamples = [];
    let budget = 30;
    for (const part of samples.slice(0, 8)) {
      if (budget <= 0) break;
      const limit = Math.max(1, Math.floor(Math.max(0, budget - (part.pause_ms || 0) / 1000) * 300 * (1 + (part.rate_percent || 0) / 100) / 60));
      const words = part.text ? part.text.split(/\s+/u).filter(Boolean) : [];
      const item = { ...part, text: part.text ? speech.clipText(part.text, limit) : '', pause_ms: words.length > limit ? 0 : (part.pause_ms || 0) };
      chosenSamples.push(item);
      budget -= (item.text ? item.text.split(/\s+/u).filter(Boolean).length * 60 / (300 * (1 + (item.rate_percent || 0) / 100)) : 0) + item.pause_ms / 1000;
    }
    const parts = (chosenSamples.length ? chosenSamples : samples.slice(0, 1)).map((part) => ({
      ...base,
      part_id: makeBookPartId(part),
      text: part.text,
      style: draft.style,
      rate_percent: part.rate_percent,
      pitch_hz: part.pitch_hz || 0,
      pause_ms: part.pause_ms || 0,
    }));
    const completion_token = signToken({
      kind: 'book',
      action: 'preview',
      user_id: String(user._id),
      job_id: jobId,
      revision,
      parts: [],
      meta: { content_hash: content.textHash(draft.sections), speech_plan_hash: planned?.hash || null },
    });
    return { job_id: jobId, action: 'preview', parts, completion_token };
  }

  if (content.estimate(draft) >= config.maxAudioSeconds) {
    throw problem(400, 'Bản tóm tắt dự kiến đạt 1 giờ. Hãy rút gọn trước khi tạo âm thanh.');
  }
  if (duration.audit(draft, job.target_minutes).outside_tolerance && body.accept_duration_mismatch !== true) {
    throw problem(409, 'Bản tóm tắt đang lệch thời lượng đã chọn. Hãy căn lại hoặc xác nhận dùng thời lượng dự kiến trước khi tạo âm thanh.');
  }

  const selfApprove = body.self_approve === true;
  if (selfApprove && !draft.user_edited) throw problem(400, 'Chỉ có thể tự duyệt bản tóm tắt đã sửa tay.');
  const sectionsHash = content.textHash(draft.sections);
  const aiVerified = draft.verified_hash === sectionsHash;
  if (!selfApprove && !aiVerified) {
    throw problem(409, 'Bản chỉnh sửa cần đối chiếu nguồn bằng AI trên máy chủ.', 'NEEDS_SERVER_VERIFICATION');
  }

  const narrationParts = planned?.parts || content.narration(draft.introduction, draft.sections, draft.style);
  const parts = narrationParts.map((part) => ({
    ...base,
    part_id: makeBookPartId(part),
    text: part.text,
    style: draft.style,
    rate_percent: part.rate_percent,
    pitch_hz: part.pitch_hz || 0,
    pause_ms: part.pause_ms || 0,
  }));

  await Job.updateOne(
    { _id: job._id, user_id: user._id, status: 'review', draft_revision: revision },
    {
      $set: {
        status: 'processing',
        work_action: 'audio',
        approved_revision: revision,
        cancel_requested: false,
        error: '',
        progress: { phase: 'audio', percent: 56, message: 'Đang tạo âm thanh trên máy của bạn (GPU/CPU)…' },
      },
    }
  );

  const completion_token = signToken({
    kind: 'book',
    action: 'audio',
    user_id: String(user._id),
    job_id: jobId,
    revision,
    parts: parts.map((p) => ({ text: p.text, pause_ms: p.pause_ms })),
    meta: {
      voice_id: voice.voice_id,
      voice_name: voice.name,
      voice_class: voice.class,
      voice_origin: voice.origin,
      provider,
      model_revision: voice.model_revision || null,
      user_approved: Boolean(selfApprove && draft.user_edited),
      approval: selfApprove && draft.user_edited
        ? { method: 'user', user_id: String(user._id), revision, content_hash: sectionsHash, approved_at: new Date().toISOString() }
        : null,
    },
  });

  return { job_id: jobId, action: 'audio', parts, completion_token };
}

async function updateBookProgress(user, job, body = {}) {
  const percent = Math.max(56, Math.min(96, Math.floor(Number(body.percent) || 56)));
  const message = typeof body.message === 'string' && body.message.trim()
    ? body.message.trim().slice(0, 160)
    : 'Đang tạo âm thanh trên máy của bạn…';
  await Job.updateOne(
    { _id: job._id, user_id: user._id, status: 'processing', cancel_requested: false },
    { $set: { progress: { phase: 'audio', percent, message } } }
  );
  return { ok: true };
}

async function completeBookAudio(user, job, body = {}, audioBuffer) {
  const jobId = String(job._id);
  const token = verifyToken(body.completion_token, 'book', user._id, jobId);
  if (job.status === 'completed' && token.action === 'audio') return job;
  if (job.delete_requested || job.cancel_requested || job.status === 'cancelled') {
    throw problem(409, 'Yêu cầu đã bị hủy.');
  }
  if (!Buffer.isBuffer(audioBuffer) || !audioBuffer.length) {
    throw problem(400, 'Thiếu file âm thanh hoàn chỉnh.');
  }

  const draft = structuredClone(job.draft);
  const digest = crypto.createHash('sha256').update(audioBuffer).digest('hex').slice(0, 16);

  if (token.action === 'preview') {
    const durationSec = Math.max(1, Math.min(35, Number(body.duration_seconds) || 30));
    const url = await publishBuffer(audioBuffer, `book-preview-${jobId}-${digest}.mp3`, 'audio/mpeg');
    draft.preview = {
      audio_url: url,
      duration_seconds: durationSec,
      content_hash: token.meta.content_hash,
      speech_plan_hash: token.meta.speech_plan_hash,
    };
    await Preview.updateMany({ job_id: job._id }, { $set: { expires_at: new Date(0) } }).catch(() => {});
    const updated = await Job.findOneAndUpdate(
      { _id: job._id, user_id: user._id },
      { $set: { draft, status: 'review', progress: { phase: 'review', percent: 55, message: 'Đoạn nghe thử đã sẵn sàng. Bạn có thể tạo toàn bộ âm thanh khi hài lòng.' } } },
      { returnDocument: 'after' }
    );
    return updated;
  }

  const { timings, totalSeconds } = parseTimings(body.timings, token.parts.length);
  const audioUrl = await publishBuffer(audioBuffer, `book-${jobId}-${digest}.mp3`, 'audio/mpeg');
  const srt = speech.subtitles(token.parts, timings);
  const subtitleUrl = await publishBuffer(Buffer.from(srt, 'utf8'), `book-${jobId}-${digest}.srt`, 'application/x-subrip; charset=utf-8');

  const metadata = normalizeMetadata(job.book_metadata, job.title);
  const summary = [draft.introduction, ...draft.sections.map((s) => s.text)].join('\n\n');
  const warning = Math.abs(totalSeconds - job.target_minutes * 60) > job.target_minutes * 60 * 0.15
    ? 'Thời lượng thực tế lệch mốc đã chọn. Hệ thống giữ nguyên nội dung đã duyệt, không thêm hoặc cắt ý để đủ phút.'
    : '';
  const verificationMethod = token.meta.user_approved ? 'user' : 'ai';

  await History.updateOne(
    { book_job_id: job._id },
    {
      $setOnInsert: {
        book_job_id: job._id,
        user_id: job.user_id,
        title: job.title,
        text: summary,
        teacher_id: token.meta.voice_id,
        style_id: draft.style,
        audio_url: audioUrl,
        subtitle_url: subtitleUrl,
        subtitle_timing: 'estimated-within-measured-segments',
        target_minutes: job.target_minutes,
        duration_seconds: totalSeconds,
        voice_mode: job.voice_mode,
        book_metadata: metadata,
        ai_assisted: true,
        speech_config: {
          ...(draft.speech || {}),
          provider: token.meta.provider,
          model_revision: token.meta.model_revision,
          voice_name: token.meta.voice_name,
          voice_class: token.meta.voice_class,
          voice_origin: token.meta.voice_origin,
          verification_method: verificationMethod,
          user_approval: token.meta.approval,
          deliveries: draft.sections.map((s) => s.delivery),
        },
      },
    },
    { upsert: true }
  );

  draft.user_approval = token.meta.approval;
  const updated = await Job.findOneAndUpdate(
    { _id: job._id, user_id: user._id },
    {
      $set: {
        status: 'completed',
        draft,
        result: {
          audio_url: audioUrl,
          subtitle_url: subtitleUrl,
          subtitle_timing: 'estimated-within-measured-segments',
          summary,
          duration_seconds: totalSeconds,
          target_minutes: job.target_minutes,
          genre: draft.genre,
          voice: token.meta.voice_name,
          tts_provider: token.meta.provider,
          style: draft.style,
          reason: draft.reason,
          warning,
          verification_method: verificationMethod,
          book_metadata: metadata,
          ai_assisted: true,
          ai_notice: AI_SUMMARY_NOTICE,
        },
        progress: { phase: 'completed', percent: 100, message: 'Đã tạo và lưu sách nói vào lịch sử.' },
        error: '',
      },
      $unset: { lease_owner: '', lease_until: '' },
    },
    { returnDocument: 'after' }
  );
  return updated;
}

module.exports = {
  signToken,
  verifyToken,
  authorizeLecture,
  completeLecture,
  authorizeBookAudio,
  updateBookProgress,
  completeBookAudio,
};
