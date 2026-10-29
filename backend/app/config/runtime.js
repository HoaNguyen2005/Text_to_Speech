const path = require('path');

function getRuntimeConfig() {
    const engineUrl = (process.env.ENGINE_URL || process.env.BOOK_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
    const parsed = new URL(engineUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('ENGINE_URL phải là URL HTTP/HTTPS nội bộ, không chứa thông tin đăng nhập hoặc query.');
    }
    return {
        engineUrl,
        artifactRoot: path.resolve(process.env.BOOK_ARTIFACT_ROOT || path.join(__dirname, '../../data/book-audio')),
    };
}

module.exports = { getRuntimeConfig };
