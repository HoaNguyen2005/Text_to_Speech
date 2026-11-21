import api from '@/services/api';

function base64ToBlob(base64, type = 'audio/mpeg') {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function shouldFallback(error) {
  const status = error?.response?.status;
  const code = error?.response?.data?.code || error?.code;
  return status === 404 || status === 405 || code === 'NEEDS_SERVER_VERIFICATION' || code === 'LOCAL_ENGINE_UNAVAILABLE';
}

export async function isLocalSynthesisReady() {
  const bridge = typeof window !== 'undefined' ? window.desktopApp : null;
  if (!bridge?.isDesktop || typeof bridge.synthesizeLocal !== 'function') return false;
  try {
    const status = await bridge.getStatus();
    return Boolean(status?.services?.engine?.online);
  } catch {
    return false;
  }
}

export async function synthesizeLectureLocal(payload, { preview = false } = {}) {
  let plan;
  try {
    const { data } = await api.post('/api/speech/local-authorize', { ...payload, preview }, { timeout: 20000 });
    plan = data;
  } catch (error) {
    if (shouldFallback(error)) error.localFallback = true;
    throw error;
  }

  let synth;
  try {
    synth = await window.desktopApp.synthesizeLocal({
      jobId: plan.job_id,
      parts: plan.parts,
      preview,
    });
  } catch (error) {
    if (error?.message?.includes('LOCAL_ENGINE_UNAVAILABLE') || error?.message?.includes('Local Engine chưa sẵn sàng')) {
      error.localFallback = true;
    }
    throw error;
  }

  const audioBlob = base64ToBlob(synth.audioBase64, 'audio/mpeg');
  if (preview) return audioBlob;

  const form = new FormData();
  form.append('completion_token', plan.completion_token);
  form.append('timings', JSON.stringify(synth.timings));
  form.append('audio_file', audioBlob, `lecture-${plan.job_id}.mp3`);
  const { data } = await api.post('/api/speech/local-complete', form, { timeout: 120000 });
  return data;
}

export async function synthesizeBookLocal(jobId, body, { action = 'audio', onProgress } = {}) {
  let plan;
  try {
    const { data } = await api.post(`/api/book-jobs/${jobId}/local-audio-plan`, { ...body, action }, { timeout: 20000 });
    plan = data;
  } catch (error) {
    if (shouldFallback(error)) error.localFallback = true;
    throw error;
  }

  let lastPing = 0;
  let synth;
  try {
    synth = await window.desktopApp.synthesizeLocal(
      { jobId: plan.job_id, parts: plan.parts, preview: action === 'preview' },
      (step) => {
        const msg = action === 'preview'
          ? `Đang tạo nghe thử trên máy (${step.current}/${step.total})…`
          : `Đang tạo âm thanh trên máy (${step.current}/${step.total})…`;
        if (typeof onProgress === 'function') onProgress(msg, step);
        if (action === 'audio' && (Date.now() - lastPing > 2500 || step.current === step.total)) {
          lastPing = Date.now();
          const percent = 56 + Math.round((step.percent || 0) * 0.38);
          api.post(`/api/book-jobs/${jobId}/local-audio-progress`, { percent, message: msg }).catch(() => {});
        }
      }
    );
  } catch (error) {
    if (error?.message?.includes('LOCAL_ENGINE_UNAVAILABLE') || error?.message?.includes('Local Engine chưa sẵn sàng')) {
      error.localFallback = true;
    }
    throw error;
  }

  if (typeof onProgress === 'function') onProgress('Đang lưu âm thanh lên hệ thống…');
  const audioBlob = base64ToBlob(synth.audioBase64, 'audio/mpeg');
  const form = new FormData();
  form.append('completion_token', plan.completion_token);
  form.append('duration_seconds', String(synth.duration_seconds || 30));
  form.append('timings', JSON.stringify(synth.timings));
  form.append('audio_file', audioBlob, `book-${jobId}.mp3`);
  const { data } = await api.post(`/api/book-jobs/${jobId}/local-audio-complete`, form, { timeout: 120000 });
  return data;
}
