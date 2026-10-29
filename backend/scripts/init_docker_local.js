// Generate runtime env files from this machine's private configuration, without
// printing secrets or changing the native Windows env files/database.
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../..');
function main() {
    const refresh = process.argv.slice(2);
    if (refresh.some(arg => arg !== '--refresh')) throw new Error('Chỉ hỗ trợ tùy chọn --refresh.');
    const destinations = ['backend.env', 'engine.env'].map(file => path.join(root, 'deploy', file));
    if (!refresh.length && destinations.some(file => fs.existsSync(file))) {
        throw new Error('Đã có env Docker. Dùng --refresh khi muốn đồng bộ lại cấu hình Windows; restart các service sau đó.');
    }
    const source = {};
    for (const file of ['.env.postgres.local', '.env.keycloak.local', '.env.books.local', '.env']) {
        const values = dotenv.parse(fs.readFileSync(path.join(root, 'backend', file)));
        for (const [key, value] of Object.entries(values)) if (!(key in source)) source[key] = value;
    }
    const url = new URL(source.DATABASE_URL);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5433' || url.pathname !== '/tts_app' || url.username !== 'tts_app') {
        throw new Error('Công cụ này chỉ chuyển cấu hình PostgreSQL local tts_app cổng 5433 sang mạng Compose.');
    }
    if (source.PG_SSL_CA_FILE) throw new Error('Cần cấu hình mount CA PostgreSQL trước khi dùng Docker.');
    if (!/^[a-f0-9]{64}$/.test(source.BOOK_ENGINE_SECRET || '') || !source.KEYCLOAK_SERVICE_CLIENT_SECRET) {
        throw new Error('Thiếu khóa Engine hoặc service account Keycloak trong cấu hình local.');
    }
    if (source.KEYCLOAK_REALM && source.KEYCLOAK_REALM !== 'tts-local') throw new Error('Cần realm local tts-local cho Compose này.');
    url.hostname = 'postgres'; url.port = '5432';
    const backend = {};
    for (const key of ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_MIN_INTERVAL_MS', 'GEMINI_MAX_AUTO_RETRIES', 'GEMINI_RETRY_WINDOW_MINUTES', 'R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_BASE_URL', 'R2_PRESIGN_EXPIRY', 'BOOK_ANALYSIS_CONCURRENCY', 'KEYCLOAK_AUDIENCE', 'KEYCLOAK_SERVICE_CLIENT_ID', 'KEYCLOAK_SERVICE_CLIENT_SECRET']) {
        if (source[key]) backend[key] = source[key];
    }
    Object.assign(backend, {
        HOST: '0.0.0.0', PORT: '3000', NODE_ENV: 'production', DATABASE_URL: url.href,
        KEYCLOAK_URL: 'http://localhost:8080', KEYCLOAK_INTERNAL_URL: 'http://keycloak:8080', KEYCLOAK_REALM: 'tts-local',
        FRONTEND_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173', ENGINE_URL: 'http://engine:8000',
        BOOK_ARTIFACT_ROOT: '/app/backend/data/book-audio', BOOK_ENGINE_SECRET: source.BOOK_ENGINE_SECRET,
        PUBLIC_BACKEND_URL: 'http://localhost:3000',
    });
    const engine = { ENGINE_HOST: '0.0.0.0', BOOK_ENGINE_SECRET: source.BOOK_ENGINE_SECRET,
        PUBLIC_BACKEND_URL: 'http://localhost:3000', BOOK_ARTIFACT_ROOT: backend.BOOK_ARTIFACT_ROOT,
        AUDIO_ROOT: '/app/backend/public/audio', OPENVOICE_CHECKPOINT_DIR: '/app/engine/checkpoints/converter',
        OPENVOICE_MODEL_REVISION: 'ea66dc9353e660b1dbbe0bebebd4c2d8b105483c', SILERO_VAD_BACKEND: 'package',
        HF_HOME: '/home/tts/.cache/huggingface', TORCH_HOME: '/home/tts/.cache/torch',
        NUMBA_CACHE_DIR: '/home/tts/.cache/numba', XDG_CACHE_HOME: '/home/tts/.cache' };
    const contents = [backend, engine].map(values => Object.entries(values).map(([key, value]) => {
        if (/[\r\n\0]/.test(value)) throw new Error('Env Docker không hỗ trợ giá trị nhiều dòng.');
        return `${key}=${value}`;
    }).join('\n') + '\n');
    for (const directory of ['backend/data/book-audio', 'backend/public/audio/samples', 'backend/public/audio/generated', 'engine/checkpoints/converter']) {
        fs.mkdirSync(path.join(root, directory), { recursive: true });
    }
    // Compose env_file format: raw preserves literal $, # and quotes in secrets.
    for (let index = 0; index < destinations.length; index++) fs.writeFileSync(destinations[index], contents[index], { mode: 0o600, flag: refresh.length ? 'w' : 'wx' });
    console.log('Đã chuẩn bị deploy/backend.env và deploy/engine.env (Git bỏ qua). Giữ nguyên cấu hình Windows và dữ liệu.');
}
try { main(); } catch (error) {
    // Never echo parser errors which could contain a connection string.
    const authored = /^(Đã có|Chỉ hỗ|Công cụ|Cần |Thiếu |Env Docker)/.test(error.message);
    console.error(authored ? error.message : 'Không tạo được env Docker. Kiểm tra bốn file cấu hình private của Backend.');
    process.exitCode = 1;
}
