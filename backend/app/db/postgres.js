const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
require('../config/env');
const context = new AsyncLocalStorage();
let pool;
let directPool;
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
function createPool(connectionString, direct) {
    const { Pool } = require('pg');
    if (!connectionString) throw new Error('Cần cấu hình DATABASE_URL cho database PostgreSQL ứng dụng.');
    let url;
    try { url = new URL(connectionString); }
    catch { throw new Error('DATABASE_URL không phải URL PostgreSQL hợp lệ.'); }
    const name = decodeURIComponent(url.pathname.slice(1));
    const supabase = /\.supabase\.(co|com)$/i.test(url.hostname) || /pooler\.supabase\.com$/i.test(url.hostname);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !name
        || (!supabase && ['keycloak','postgres','template0','template1'].includes(name))
        || (!supabase && !name.startsWith('tts_'))) {
        throw new Error('DATABASE_URL phải trỏ tới database ứng dụng tts_* hoặc database Supabase riêng, tách khỏi Keycloak.');
    }
    let ssl;
    if (supabase || process.env.PG_SSL_CA_FILE) {
        // pg replaces an explicit ssl object when the URL also has SSL options.
        for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
        ssl = { rejectUnauthorized: !supabase };
        if (process.env.PG_SSL_CA_FILE) ssl.ca = fs.readFileSync(process.env.PG_SSL_CA_FILE, 'utf8');
    }
    const result = new Pool({ connectionString: url.toString(), max: direct ? 1 : 5,
        connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
        statement_timeout: 30000, application_name: 'text2speech',
        ...(ssl ? { ssl } : {}) });
    result.on('error', () => console.error('[PostgreSQL] Kết nối nền bị gián đoạn.'));
    return result;
}
function getPool({ direct = false } = {}) {
    if (direct) {
        directPool ||= createPool(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL, true);
        return directPool;
    }
    pool ||= createPool(process.env.DATABASE_URL, false);
    return pool;
}
async function query(sql, parameters = []) {
    try { return await (context.getStore() || getPool()).query(sql, parameters); }
    catch (error) {
        if (error.code === '23505') { error.pgCode = error.code; error.code = 11000; }
        throw error;
    }
}
async function transaction(work, options) {
    if (context.getStore()) return work(context.getStore());
    const client = await getPool(options).connect();
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
    }, { direct: true });
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
async function close() {
    const current = [pool, directPool].filter(Boolean);
    pool = directPool = undefined;
    await Promise.all(current.map(value => value.end()));
}
const isValidId = (value) => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
module.exports = { query, transaction, getPool, migrateSchema, connect, close, pruneExpired, isValidId };
