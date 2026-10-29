const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const dotenv = require('dotenv');
for (const file of ['.env.postgres.local', '.env.keycloak.local', '.env.books.local', '.env']) {
    dotenv.config({ path: path.join(__dirname, '../..', file), quiet: true });
}
const context = new AsyncLocalStorage();
let pool;
const MIGRATIONS = [
    { version: '001-app-postgres', file: 'schema.sql' },
    { version: '002-book-custom-duration', file: 'migrations/002-book-custom-duration.sql' },
    { version: '003-book-selected-voice', file: 'migrations/003-book-selected-voice.sql' },
    { version: '004-book-editorial-review', file: 'migrations/004-book-editorial-review.sql' },
    { version: '005-book-ai-retry', file: 'migrations/005-book-ai-retry.sql' },
    { version: '006-book-discard', file: 'migrations/006-book-discard.sql' },
    { version: '007-speech-subtitles', file: 'migrations/007-speech-subtitles.sql' },
    { version: '008-book-preview-cache', file: 'migrations/008-book-preview-cache.sql' },
    { version: '009-profiles-voice-library', file: 'migrations/009-profiles-voice-library.sql' },
];
const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
function getPool() {
    if (!pool) {
        const { Pool } = require('pg');
        if (!process.env.DATABASE_URL) throw new Error('Cần cấu hình DATABASE_URL cho database PostgreSQL ứng dụng.');
        const url = new URL(process.env.DATABASE_URL);
        if (!url.pathname.slice(1).startsWith('tts_') || ['keycloak','postgres','template0','template1'].includes(url.pathname.slice(1))) {
            throw new Error('DATABASE_URL phải trỏ tới database ứng dụng tts_*, tách riêng Keycloak.');
        }
        pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5,
            connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
            statement_timeout: 30000, application_name: 'text2speech',
            ...(process.env.PG_SSL_CA_FILE ? { ssl: { ca: fs.readFileSync(process.env.PG_SSL_CA_FILE, 'utf8'), rejectUnauthorized: true } } : {}) });
        pool.on('error', () => console.error('[PostgreSQL] Kết nối nền bị gián đoạn.'));
    }
    return pool;
}
async function query(sql, parameters = []) {
    try { return await (context.getStore() || getPool()).query(sql, parameters); }
    catch (error) {
        if (error.code === '23505') { error.pgCode = error.code; error.code = 11000; }
        throw error;
    }
}
async function transaction(work) {
    if (context.getStore()) return work(context.getStore());
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const result = await context.run(client, () => work(client));
        await client.query('COMMIT');
        return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
}
async function migrateSchema() {
    await transaction(async () => {
        await query("SELECT pg_advisory_xact_lock(hashtextextended('tts-schema', 0))");
        await query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
        for (const { version, file } of MIGRATIONS) {
            const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
            const digest = crypto.createHash('sha256').update(source).digest('hex');
            const previous = (await query('SELECT digest FROM schema_migrations WHERE version=$1', [version])).rows[0];
            if (previous) {
                if (previous.digest !== digest) throw new Error('Schema đã áp dụng có nội dung khác. Cần migration mới, không sửa schema cũ.');
                continue;
            }
            await query(source);
            await query('INSERT INTO schema_migrations(version,digest) VALUES($1,$2)', [version,digest]);
        }
    });
}
async function connect() {
    await query('SELECT 1');
    if (!(await query('SELECT 1 FROM schema_migrations WHERE version=$1', [SCHEMA_VERSION])).rowCount) {
        throw new Error('Chưa áp dụng schema PostgreSQL. Chạy npm run db:migrate.');
    }
    const migrated = await query("SELECT 1 FROM data_migrations WHERE id='mongodb-cutover-v1'");
    if (!migrated.rowCount && process.env.PG_ALLOW_EMPTY_DATABASE !== 'true') {
        throw new Error('Chưa chuyển dữ liệu MongoDB. Chạy npm run db:import trước khi bật Backend/worker.');
    }
}
let lastPrune = 0;
async function pruneExpired() {
    if (Date.now() - lastPrune < 60000) return;
    await query('DELETE FROM book_caches WHERE expires_at <= now()');
    await query('DELETE FROM reading_profiles WHERE expires_at <= now()');
    await require('../services/book_preview.service').prune();
    lastPrune = Date.now();
}
async function close() { if (pool) { const current = pool; pool = undefined; await current.end(); } }
const isValidId = (value) => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
module.exports = { query, transaction, getPool, migrateSchema, connect, close, pruneExpired, isValidId };
