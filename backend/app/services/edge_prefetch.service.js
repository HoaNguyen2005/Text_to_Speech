// Only Edge network requests overlap. Rendering/checkpoints remain ordered.
const crypto = require('crypto');
const config = require('../config/book');

module.exports = async function edgePrefetch({ jobId, provider, parts, payload, guard = async () => {}, skip = () => false,
    timed = async (stage, operation) => operation() }) {
    if (provider !== 'edge' || config.edgePrefetchConcurrency === 1) {
        return { ready: async () => {}, advance: () => {}, close: async () => {} };
    }
    const session = { job_id: String(jobId), session_id: crypto.randomBytes(16).toString('hex') };
    const controller = new AbortController();
    const pending = new Map();
    let closed = false, interrupted, timer, checking, closePromise;
    async function request(endpoint, body, signal = undefined, timeout = 20000) {
        const response = await fetch(`${config.engineUrl}/book/${endpoint}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Book-Engine-Secret': config.engineSecret },
            body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
        });
        const result = await response.json();
        if (!response.ok) {
            const error = new Error(typeof result.detail === 'string' ? result.detail : result.detail?.message || 'Không tải trước được âm thanh Edge-TTS.');
            error.retryable = response.status >= 500 && result.detail?.retryable !== false;
            throw error;
        }
        return result;
    }
    await guard();
    // Open is idempotent for the client-generated session ID.
    let opened;
    try { opened = await request('prefetch/open', session); }
    catch (error) {
        await request('prefetch/close', session).catch(() => {});
        throw error;
    }
    const width = Math.min(config.edgePrefetchConcurrency, opened.concurrency || 1);
    console.log(`[EDGE PREFETCH] job=${jobId} window=${width}`);

    function cancel() {
        closed = true;
        clearTimeout(timer);
        controller.abort();
        closePromise ||= request('prefetch/close', session, undefined, 30000)
            .catch(() => console.warn('[EDGE PREFETCH] Chưa đóng được phiên; cleanup của job sẽ hủy các file đang tải.'));
        return closePromise;
    }
    function watch() {
        timer = setTimeout(() => {
            checking = guard().catch(error => { interrupted = error; return cancel(); })
                .finally(() => { if (!closed) watch(); });
        }, 2000);
    }
    watch();
    function advance(index) {
        if (closed) return;
        // Discard settled handles behind the cursor; files/checkpoints own reuse.
        for (const key of pending.keys()) if (key < index) pending.delete(key);
        for (let i = index; i < Math.min(parts.length, index + width); i++) {
            if (pending.has(i) || !parts[i].text.trim() || skip(i)) continue;
            const promise = (async () => {
                await guard();
                if (closed) return;
                const body = await payload(parts[i], i);
                if (closed) return;
                // Reference bytes are not required until serialized conversion.
                delete body.reference_audio_url;
                await timed('edge_prefetch', () => request('prefetch', { ...body, session_id: session.session_id }, controller.signal, config.engineTimeout));
            })().then(() => ({}), error => ({ error }));
            // Always attach rejection handlers immediately, including future parts.
            pending.set(i, promise);
        }
    }
    return {
        advance,
        async ready(index) {
            if (interrupted) throw interrupted;
            advance(index);
            const result = await pending.get(index);
            if (interrupted) throw interrupted;
            if (result?.error) {
                // /book/part retains the existing bounded retry policy. A failed
                // speculative download never switches voice/provider or loses work.
                if (result.error.retryable === false) throw result.error;
                console.warn(`[EDGE PREFETCH] job=${jobId} part=${index + 1} retry_in_order`);
            }
            await guard();
        },
        async close() {
            const outstanding = [...pending.values()];
            await cancel();
            await Promise.allSettled(outstanding);
            if (checking) await checking;
        },
    };
};
