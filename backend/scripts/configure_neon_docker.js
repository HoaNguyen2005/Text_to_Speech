// Update only database variables; preserve R2/Gemini/Keycloak/Engine settings.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../..');
function main() {
    const filename = ['.env.local', '.env'].map(name => path.join(root, name)).find(file => fs.existsSync(file));
    if (!filename) throw new Error('Chạy neon deploy trước để lấy biến môi trường.');
    const neon = dotenv.parse(fs.readFileSync(filename));
    for (const name of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
        const url = new URL(neon[name]);
        if (!/\.neon\.tech$/i.test(url.hostname) || /[\r\n\0]/.test(neon[name])) throw new Error('URL đích Neon không hợp lệ.');
    }
    const runtime = path.join(root, 'deploy/backend.env');
    const original = fs.readFileSync(runtime, 'utf8');
    const current = dotenv.parse(original);
    if (current.DATABASE_URL === neon.DATABASE_URL && current.DATABASE_URL_UNPOOLED === neon.DATABASE_URL_UNPOOLED) {
        console.log('Docker đã dùng đúng DATABASE_URL và DATABASE_URL_UNPOOLED của Neon.');
        return;
    }
    if (current.PG_SSL_CA_FILE) throw new Error('Cần rà soát CA riêng đã cấu hình trước khi đổi PostgreSQL Docker.');
    const backup = path.join(root, `deploy/backend.pre-neon-${Date.now()}.env`);
    fs.writeFileSync(backup, original, { flag: 'wx', mode: 0o600 });
    const lines = original.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?DATABASE_URL(?:_UNPOOLED)?\s*=/.test(line));
    lines.push(`DATABASE_URL=${neon.DATABASE_URL}`, `DATABASE_URL_UNPOOLED=${neon.DATABASE_URL_UNPOOLED}`);
    fs.writeFileSync(runtime, lines.join('\n') + '\n', { mode: 0o600 });
    console.log('Đã đồng bộ hai biến PostgreSQL Neon vào deploy/backend.env; không in credentials.');
    console.log(`Cấu hình cũ: ${path.relative(root, backup)}`);
    console.log('Recreate Backend/worker để áp dụng env_file mới; restart đơn thuần không đọc lại env_file.');
}
try { main(); }
catch (error) {
    console.error('Không cấu hình được Neon cho Docker:', error.code || error.name,
        error.name === 'Error' ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]') : 'Kiểm tra file env private.');
    process.exitCode = 1;
}
