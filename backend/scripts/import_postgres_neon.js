// Copy the existing app DB into an empty Neon DB. Source is always read-only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const dotenv = require('dotenv');
const db = require('../app/db/postgres');
const root = path.resolve(__dirname, '../..');
const tables = ['users', 'voices', 'book_jobs', 'generated_lectures', 'book_caches',
    'reading_profiles', 'book_previews', 'worker_leases', 'legacy_documents', 'data_migrations'];
const quote = name => `"${name}"`;
const order = name => name === 'legacy_documents' ? 'collection_name,document_id' : name === 'data_migrations' ? 'id' : '_id';
const hash = rows => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
async function rows(client, name) {
    return (await client.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY ${order(name)}),'[]'::jsonb) AS rows FROM public.${quote(name)} t`)).rows[0].rows;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--execute')) throw new Error('Chỉ hỗ trợ --execute; mặc định chỉ xem trước.');
    const destination = new URL(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
    if (!/\.neon\.tech$/i.test(destination.hostname) || destination.hostname.includes('-pooler.')) {
        throw new Error('Đích phải là DATABASE_URL_UNPOOLED trực tiếp của Neon.');
    }
    const sourceEnv = dotenv.parse(fs.readFileSync(path.join(root, 'backend/.env.postgres.local')));
    const sourceUrl = new URL(sourceEnv.DATABASE_URL);
    if (!['localhost', '127.0.0.1'].includes(sourceUrl.hostname) || sourceUrl.pathname !== '/tts_app') {
        throw new Error('Nguồn phải là database local tts_app; không đọc nhầm dữ liệu cloud.');
    }
    const source = new Client({ connectionString: sourceUrl.toString(), connectionTimeoutMillis: 10000 });
    const target = await db.getPool({ direct: true }).connect();
    try {
        await source.connect();
        await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const sourceTables = (await source.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename);
        assert.deepEqual(sourceTables, [...tables, 'schema_migrations'].sort(), 'Nguồn có bảng khác danh sách sao chép; cần rà soát trước.');
        const sourceSchema = (await source.query('SELECT version,digest FROM schema_migrations ORDER BY version')).rows;
        const targetSchema = (await target.query('SELECT version,digest FROM schema_migrations ORDER BY version')).rows;
        assert.deepEqual(targetSchema, sourceSchema, 'Schema/migration đích phải trùng nguồn. Chạy npm run db:migrate trước.');
        const snapshot = {};
        for (const name of tables) snapshot[name] = await rows(source, name);
        const counts = Object.fromEntries(tables.map(name => [name, snapshot[name].length]));
        const activity = { jobs: snapshot.book_jobs.filter(job => ['queued', 'processing'].includes(job.status)).length,
            previews: snapshot.book_previews.filter(preview => ['processing', 'pruning'].includes(preview.status)).length,
            identitySync: snapshot.users.filter(user => user.authSyncPending).length };
        console.log(JSON.stringify({ source: 'local/tts_app', destination: 'Neon', counts, activity, execute: args.includes('--execute') }, null, 2));
        if (!args.includes('--execute')) return;
        if (Object.values(activity).some(Boolean)
            || snapshot.worker_leases.some(lease => lease._id === 'book-audio' && Date.parse(lease.until) > Date.now())) {
            throw new Error('Còn tác vụ/worker/đồng bộ đang chạy. Hoàn tất tác vụ và dừng Backend/worker trước khi chuyển.');
        }
        const directory = path.join(root, 'backend/data/neon-backups');
        fs.mkdirSync(directory, { recursive: true });
        const backup = path.join(directory, `local-postgres-${Date.now()}.json`);
        fs.writeFileSync(backup, JSON.stringify({ schema: sourceSchema, tables: snapshot }), { flag: 'wx', mode: 0o600 });
        const digest = hash(snapshot);
        // Old process leases must not prevent the cloud worker from starting.
        snapshot.worker_leases = snapshot.worker_leases.map(lease => ({ ...lease, owner: null, until: '1970-01-01T00:00:00+00:00' }));
        await target.query('BEGIN');
        try {
            await target.query(`LOCK TABLE ${tables.map(name => `public.${quote(name)}`).join(',')} IN ACCESS EXCLUSIVE MODE`);
            for (const name of tables) {
                if ((await target.query(`SELECT 1 FROM public.${quote(name)} LIMIT 1`)).rowCount) {
                    throw new Error('Database Neon đã có dữ liệu; dừng để tránh ghi đè hoặc trộn dữ liệu.');
                }
            }
            for (const name of tables) {
                if (snapshot[name].length) {
                    await target.query(`INSERT INTO public.${quote(name)} SELECT * FROM jsonb_populate_recordset(NULL::public.${quote(name)},$1::jsonb)`, [JSON.stringify(snapshot[name])]);
                }
                assert.equal(hash(await rows(target, name)), hash(snapshot[name]), `Nội dung bảng ${name} lệch sau khi nhập.`);
            }
            await target.query('INSERT INTO data_migrations(id,source_digest,backup_file,counts) VALUES($1,$2,$3,$4::jsonb)',
                ['neon-postgres-cutover-v1', digest, path.relative(root, backup), JSON.stringify(counts)]);
            await target.query('COMMIT');
            console.log('PASS copied all application tables; IDs, Keycloak mappings, R2 keys and row digests verified');
            console.log(`Backup: ${path.relative(root, backup)}`);
        } catch (error) { await target.query('ROLLBACK'); throw error; }
    } finally {
        await source.end();
        target.release();
    }
}
main().catch(error => {
    console.error('Neon import:', error.code || error.name,
        error.name === 'Error' ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]') : 'Không hoàn tất; kiểm tra schema/kết nối và điều kiện chuyển dữ liệu.');
    process.exitCode = 1;
}).finally(() => db.close());
