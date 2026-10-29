const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { root, dockerCommand } = require('./lib/postgres-local');
async function main() {
    const configFile = path.join(root,'backend/.env.postgres.local');
    let password;
    if (fs.existsSync(configFile)) {
        const config = dotenv.parse(fs.readFileSync(configFile));
        const url = new URL(config.DATABASE_URL);
        if (url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/tts_app' || url.username !== 'tts_app') {
            throw new Error('Cấu hình PostgreSQL hiện có khác môi trường local dự kiến; giữ nguyên và kiểm tra lại.');
        }
        password = decodeURIComponent(url.password);
        if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Giữ nguyên cấu hình riêng hiện có. Dùng công cụ PostgreSQL để cấp quyền theo tài liệu.');
    } else password = crypto.randomBytes(32).toString('hex');
    // Save the generated credential before provisioning so a partially completed setup is recoverable.
    if (!fs.existsSync(configFile)) fs.writeFileSync(configFile, `DATABASE_URL=postgresql://tts_app:${password}@127.0.0.1:5433/tts_app\n`, { flag: 'wx', mode: 0o600 });
    // The statement travels on stdin, never in command arguments or console output.
    const sql = `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tts_app') THEN
        CREATE ROLE tts_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}';
      END IF;
    END $$;
    SELECT 'CREATE DATABASE tts_app OWNER tts_app' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='tts_app')
    \\gexec
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='tts_app' AND pg_get_userbyid(datdba)='tts_app') THEN
        RAISE EXCEPTION 'Unexpected application database owner';
      END IF;
    END $$;
    `;
    dockerCommand(['exec','-T','postgres','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','keycloak','-d','postgres'], { input: sql, encoding: 'utf8' });
    console.log('Database tts_app và role riêng đã sẵn sàng. Cấu hình nằm trong backend/.env.postgres.local (không hiển thị mật khẩu).');
}
if (require.main === module) main().catch(() => { console.error('Chưa tạo được database ứng dụng. Kiểm tra Docker Desktop, cổng 5433 và quyền database; không đổi cấu hình Keycloak.'); process.exitCode = 1; });
