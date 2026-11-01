// Real PostgreSQL + repository + HTTP smoke check; no Gemini, TTS or R2 calls.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
require('../app/config/env');
const db = require('../app/db/postgres');
const User = require('../app/models/user.model');
const Voice = require('../app/models/voice.model');
const { WorkerLease } = require('../app/models/book_cache.model');

async function main() {
    const url = new URL(process.env.DATABASE_URL);
    assert.match(url.hostname, /\.neon\.tech$/i, 'Check này chỉ dành cho Neon, không được kiểm tra nhầm database local.');
    await db.connect();
    const client = await db.getPool().connect();
    try {
        const stream = client.connection.stream;
        assert.equal(stream.encrypted, true, 'Neon connection must use TLS.');
        assert.equal(stream.authorized, true, 'Neon TLS certificate must be verified.');
        assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
        console.log('PASS Neon PostgreSQL: TLS encrypted, certificate verified');
    } finally { client.release(); }

    // Roll back even a successful check. These rows never become visible to users.
    const rollback = new Error('SMOKE_ROLLBACK');
    const id = crypto.randomBytes(12).toString('hex');
    const voiceId = crypto.randomBytes(12).toString('hex');
    const leaseId = `neon-check-${crypto.randomUUID()}`;
    try {
        await db.transaction(async () => {
            const user = await User.create({ _id: id, email: `neon-check-${id}@example.invalid`, fullName: 'Kiểm tra Neon' });
            const voice = await Voice.create({ _id: voiceId, voice_id: `neon-check-${voiceId}`, name: 'Giọng kiểm tra Neon',
                user_id: user._id, file_path: 'smoke-check/no-audio.wav', is_global: false });
            assert.equal((await Voice.findById(voice._id)).name, 'Giọng kiểm tra Neon');
            await Voice.updateOne({ _id: voice._id }, { $set: { name: 'Giọng đã cập nhật' } });
            assert.equal((await Voice.findById(voice._id)).name, 'Giọng đã cập nhật');
            await WorkerLease.findOneAndUpdate({ _id: leaseId }, { $set: { owner: leaseId, until: new Date(Date.now() + 10000) } }, { upsert: true });
            assert.equal(await WorkerLease.exists({ _id: leaseId, owner: leaseId, until: { $gt: new Date() } }), true);
            await Voice.deleteMany({ _id: voice._id });
            assert.equal(await Voice.exists({ _id: voice._id }), false);
            throw rollback;
        });
    } catch (error) { if (error !== rollback) throw error; }
    assert.equal(await User.exists({ _id: id }), false);
    assert.equal(await WorkerLease.exists({ _id: leaseId }), false);
    console.log('PASS repositories: create/read/update/delete, worker lease, transaction rollback');

    process.env.PORT = '0';
    process.env.HOST = '127.0.0.1';
    const server = await require('../server').start();
    try {
        if (!server.listening) await once(server, 'listening');
        const address = `http://127.0.0.1:${server.address().port}`;
        const health = await fetch(`${address}/api/health`, { signal: AbortSignal.timeout(30000) });
        assert.equal(health.status, 200);
        assert.equal((await health.json()).status, 'ok');
        console.log('PASS HTTP GET /api/health -> 200 {"status":"ok"}');
        const response = await fetch(`${address}/api/voices`, { signal: AbortSignal.timeout(30000) });
        assert.equal(response.status, 200);
        const actual = await response.json();
        const expected = await Voice.find({ is_active: true, is_global: true }).lean();
        assert.deepEqual(actual.map(voice => voice._id).sort(), expected.map(voice => voice._id).sort());
        assert.ok(actual.every(voice => voice.can_edit === false));
        console.log(`PASS HTTP GET /api/voices -> 200; ${actual.length} public voices match Neon; private voices excluded`);
        const protectedResponse = await fetch(`${address}/api/history`, { signal: AbortSignal.timeout(10000) });
        assert.equal(protectedResponse.status, 401);
        console.log('PASS HTTP GET /api/history without token -> 401');
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

main().catch(error => {
    // Drivers may include a connection URL in errors. Never print credentials.
    console.error('FAIL Neon smoke check:', error.code || error.name,
        String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted database URL]'));
    process.exitCode = 1;
}).finally(() => db.close());
