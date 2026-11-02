const path = require('path');

function validateEngineUrl(rawUrl, name = 'ENGINE_URL') {
    const cleaned = String(rawUrl || '').trim().replace(/\/+$/, '');
    let parsed;
    try {
        parsed = new URL(cleaned);
    } catch {
        throw new Error(`${name} phải là URL HTTP/HTTPS hợp lệ.`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error(`${name} phải là URL HTTP/HTTPS nội bộ, không chứa thông tin đăng nhập hoặc query.`);
    }
    return cleaned;
}

function getRuntimeConfig() {
    const engineUrl = validateEngineUrl(process.env.ENGINE_URL || process.env.BOOK_ENGINE_URL || 'http://127.0.0.1:8000', 'ENGINE_URL');
    const rawFallback = (process.env.ENGINE_FALLBACK_URL || '').trim();
    const engineFallbackUrl = rawFallback ? validateEngineUrl(rawFallback, 'ENGINE_FALLBACK_URL') : null;
    return {
        engineUrl,
        engineFallbackUrl,
        artifactRoot: path.resolve(process.env.BOOK_ARTIFACT_ROOT || path.join(__dirname, '../../data/book-audio')),
    };
}

module.exports = { getRuntimeConfig, validateEngineUrl };
