const crypto = require('crypto');
const db = require('../db/postgres');
const config = require('../config/book');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const queues = new Map();
const modelName = () => (process.env.GEMINI_MODEL || 'gemini-flash-latest').replace(/[^a-zA-Z0-9/_.-]/g, '').slice(0, 120);
const scope = () => 'gemini-limit-' + crypto.createHash('sha256').update(`${process.env.GEMINI_API_KEY || ''}:${modelName()}`).digest('hex');

class GeminiRequestError extends Error {
    constructor(code, message, data = {}) {
        super(message);
        this.name = 'GeminiRequestError'; this.provider = 'gemini'; this.code = code;
        Object.assign(this, data);
    }
}
const messages = {
    RATE_LIMIT: 'Gemini đang giới hạn số yêu cầu hoặc token trong thời gian ngắn.',
    DAILY_QUOTA: 'Gemini đã hết hạn mức ngày. Kiểm tra Usage/Rate limits trong Google AI Studio; thử lại sau khi hạn mức được cấp lại hoặc thay đổi gói.',
    QUOTA_CONFIG: 'Gemini báo hạn mức bằng 0. Kiểm tra quyền dùng mô hình, API project và cấu hình thanh toán trước khi thử lại.',
    OVERLOADED: 'Gemini đang quá tải hoặc tạm không sẵn sàng.',
    TIMEOUT: 'Gemini xử lý quá thời gian chờ.',
    NETWORK: 'Không kết nối ổn định được tới Gemini. Kiểm tra kết nối mạng của Docker.',
    SERVER_ERROR: 'Gemini gặp lỗi máy chủ tạm thời.',
    AUTH: 'Gemini từ chối xác thực hoặc quyền truy cập. Kiểm tra API key và quyền dùng mô hình.',
    MODEL_NOT_FOUND: 'Không tìm thấy GEMINI_MODEL. Kiểm tra tên và quyền dùng mô hình.',
    BAD_REQUEST: 'Gemini từ chối nội dung hoặc cấu hình yêu cầu. Kiểm tra mô hình, structured output và giới hạn nội dung.',
    INPUT_TOO_LARGE: 'Phần nội dung vượt giới hạn đầu vào của Gemini. Hệ thống sẽ chia nhóm nhỏ hơn.',
    REQUEST_FAILED: 'Gemini trả lỗi yêu cầu chưa được phân loại. Xem mã HTTP và bước xử lý trong log worker.',
};
function seconds(value) {
    if (typeof value === 'string' && /^\d+(?:\.\d+)?s$/.test(value)) return Number.parseFloat(value) * 1000;
    if (value && typeof value === 'object') {
        const milliseconds = Number(value.seconds || 0) * 1000 + Number(value.nanos || 0) / 1000000;
        if (Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds;
    }
    return 0;
}
function classify(error, stage) {
    if (error instanceof GeminiRequestError) return error;
    const status = Number(error.status || error.statusCode) || null;
    const details = Array.isArray(error.errorDetails) ? error.errorDetails : [];
    const violations = details.flatMap(item => Array.isArray(item.violations) ? item.violations : []);
    const quotaIds = [...new Set(violations.map(item => String(item.quotaId || item.quotaMetric || '')
        .replace(/[^a-zA-Z0-9/_.-]/g, '').slice(0, 160)).filter(Boolean))].slice(0, 8);
    // Only use explicit quota identifiers/descriptions for daily classification.
    // A generic 429 does not prove the daily quota has been exhausted.
    const daily = status === 429 && (violations.some(item => /per[_ -]?day|daily|\/day\b/i.test(`${item.quotaId || ''} ${item.quotaMetric || ''} ${item.description || ''}`))
        || /requests? per day|tokens? per day|daily quota|perdayper/i.test(error.message || ''));
    const zero = status === 429 && violations.length > 0 && violations.every(item => String(item.quotaValue) === '0');
    let code;
    if (daily) code = 'DAILY_QUOTA';
    else if (zero) code = 'QUOTA_CONFIG';
    else if (status === 429) code = 'RATE_LIMIT';
    else if (status === 503) code = 'OVERLOADED';
    else if (status === 504 || status === 408 || (!status && /timeout|timed out|aborted|AbortError/i.test(`${error.name} ${error.message}`))) code = 'TIMEOUT';
    else if ([500, 502].includes(status)) code = 'SERVER_ERROR';
    else if (status === 401 || status === 403) code = 'AUTH';
    else if (status === 404) code = 'MODEL_NOT_FOUND';
    else if (status === 400 && /input.*token.*(?:exceed|limit|maximum)|(?:exceed|maximum).*input.*token|context.*(?:length|window).*(?:exceed|limit)/i.test(error.message || '')) code = 'INPUT_TOO_LARGE';
    else if (status === 400) code = 'BAD_REQUEST';
    else if (!status && /fetch failed|network|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket/i.test(`${error.message} ${error.cause?.code || ''}`)) code = 'NETWORK';
    else if (status) code = 'REQUEST_FAILED';
    else return null; // Internal validation/SQL/cancellation errors retain their type.
    let retryDelayMs = Math.max(0, ...details.filter(item => /(?:^|\.)RetryInfo$/.test(item['@type'] || '')).map(item => seconds(item.retryDelay)));
    // Older SDK versions expose RetryInfo but omit response headers. Honour
    // Retry-After as well when an SDK/transport supplies it; never scrape URLs.
    const retryAfter = error.headers?.get?.('retry-after') || error.headers?.['retry-after'];
    if (retryAfter) {
        const parsed = /^\d+(?:\.\d+)?$/.test(String(retryAfter)) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(parsed)) retryDelayMs = Math.max(retryDelayMs, parsed);
    }
    return new GeminiRequestError(code, messages[code], { httpStatus: status, stage, model: modelName(), quotaIds,
        retryable: ['RATE_LIMIT', 'OVERLOADED', 'TIMEOUT', 'NETWORK', 'SERVER_ERROR'].includes(code),
        retryDelayMs: Number.isFinite(retryDelayMs) ? retryDelayMs : 0, scope: scope() });
}
function nextPacificMidnight(now = Date.now()) {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
    const today = formatter.format(now);
    let low = now, high = now + 27 * 3600000;
    while (high - low > 1000) {
        const mid = Math.floor((low + high) / 2);
        if (formatter.format(mid) === today) low = mid; else high = mid;
    }
    return high + 1000; // Handles both PST/PDT; never guess the reset in UTC.
}
function retryPlan(error, previous = {}, successfulGenerations = 0) {
    const now = Date.now();
    const recovered = successfulGenerations > 0;
    const attempts = error.blocked ? (previous.attempts || 0) : (recovered ? 0 : previous.attempts || 0) + 1;
    const first = recovered || !previous.first_failure_at ? now : Date.parse(previous.first_failure_at);
    const total = (previous.total_attempts || 0) + 1;
    const exponential = Math.min(300000, (error.code === 'RATE_LIMIT' ? 30000 : 15000) * 2 ** Math.max(0, attempts - 1));
    const jitter = Math.floor(exponential * Math.random() * 0.2);
    const next = error.retryAt ? Date.parse(error.retryAt) : now + Math.max(exponential + jitter, error.retryDelayMs || 0);
    const withinBudget = attempts <= config.geminiMaxAutoRetries && total <= config.geminiMaxTotalRetries
        && next - first <= config.geminiRetryWindowMs;
    return { allowed: error.retryable && withinBudget, next: new Date(next), state: {
        provider: 'gemini', code: error.code, http_status: error.httpStatus, provider_stage: error.stage, model: error.model,
        scope: error.scope, quota_ids: error.quotaIds || [], attempts, total_attempts: total,
        first_failure_at: new Date(first).toISOString(), last_failure_at: new Date(now).toISOString(),
        retry_at: new Date(next).toISOString(), message: error.message, automatic: Boolean(error.retryable && withinBudget),
    } };
}
async function recordGate(error) {
    if (!error.retryAt) return;
    await db.query(`INSERT INTO worker_leases(_id,owner,"until") VALUES($1,$2,$3)
        ON CONFLICT (_id) DO UPDATE SET "until"=GREATEST(worker_leases."until",EXCLUDED."until"),
        owner=CASE WHEN worker_leases."until">EXCLUDED."until" THEN worker_leases.owner ELSE EXCLUDED.owner END`,
    [error.scope, error.code, error.retryAt]);
}
async function activeGate() {
    const row = (await db.query('SELECT owner,"until" FROM worker_leases WHERE _id=$1 AND "until">now()', [scope()])).rows[0];
    if (!row) return null;
    const code = Object.hasOwn(messages, row.owner) ? row.owner : 'OVERLOADED';
    return new GeminiRequestError(code, messages[code], { retryable: !['DAILY_QUOTA', 'QUOTA_CONFIG'].includes(code), blocked: true,
        retryAt: new Date(row.until).toISOString(), scope: scope(), model: modelName(), quotaIds: [], httpStatus: code === 'RATE_LIMIT' || code === 'DAILY_QUOTA' ? 429 : null });
}
async function clearDailyGate(expectedScope) {
    if (expectedScope !== scope()) return;
    await db.query('UPDATE worker_leases SET "until"=$2 WHERE _id=$1 AND owner IN ($3,$4)',
        [expectedScope, new Date(0), 'DAILY_QUOTA', 'QUOTA_CONFIG']);
}
async function request(stage, guard, operation) {
    const id = scope();
    const queue = queues.get(id) || { tail: Promise.resolve(), lastStart: 0 };
    queues.set(id, queue);
    const previous = queue.tail;
    let release;
    queue.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
        await guard();
        const blocked = await activeGate();
        if (blocked) { blocked.stage = stage; throw blocked; }
        while (Date.now() < queue.lastStart + config.geminiMinIntervalMs) {
            await delay(Math.min(1000, queue.lastStart + config.geminiMinIntervalMs - Date.now()));
            await guard();
        }
        queue.lastStart = Date.now();
        try { return await operation(); }
        catch (original) {
            const error = classify(original, stage);
            if (!error) throw original;
            const progress = guard.aiProgress || {};
            if (error.code === 'DAILY_QUOTA') error.retryAt = new Date(nextPacificMidnight()).toISOString();
            else if (error.code === 'QUOTA_CONFIG') error.retryAt = new Date(Date.now() + 15 * 60000).toISOString();
            else if (error.retryable) error.retryAt = retryPlan(error, progress.retryState, progress.successes).next.toISOString();
            await recordGate(error);
            // Never log raw SDK messages, request URLs, credentials or source text.
            console.warn('[BOOK GEMINI ERROR] ' + JSON.stringify({ code: error.code, http_status: error.httpStatus,
                stage, model: error.model, quota_ids: error.quotaIds, retry_at: error.retryAt || null,
                elapsed_ms: Date.now() - queue.lastStart }));
            throw error;
        }
    } finally { release(); }
}
module.exports = { GeminiRequestError, request, retryPlan, clearDailyGate };
