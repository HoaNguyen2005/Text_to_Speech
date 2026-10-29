require('./lib/legacy-mongo-tool');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const { root, loadLocalConfig, createAdminClient } = require('./lib/keycloak-local');
const oidc = require('./lib/oidc-check-client');

async function check({ serve = false } = {}) {
    if (serve && !process.stdin.isTTY) throw new Error('--serve requires an interactive terminal (exec tty=true).');
    const local = loadLocalConfig();
    const config = { ...local, base: local.KEYCLOAK_URL || 'http://localhost:8080', realm: local.KEYCLOAK_REALM || 'tts-local' };
    const admin = createAdminClient(config);
    const prefix = `phase3-${crypto.randomBytes(6).toString('hex')}`;
    const password = `Check!${crypto.randomBytes(24).toString('hex')}`;
    const runtime = dotenv.parse(fs.readFileSync(path.join(root, 'backend/.env.keycloak.local')));
    Object.assign(process.env, runtime, { MONGODB_URI: 'mongodb://127.0.0.1:27018/tts_phase3_checks', PORT: '0',
        R2_ACCOUNT_ID: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET: '' });
    let server, clientId, fixtureFile;
    const accountIds = [], mongoIds = [], voiceIds = [], historyIds = [];
    let tests = 0;
    const pass = (name) => { tests++; console.log(`OK: ${name}`); };
    try {
        const { start } = require('../server');
        server = await start();
        await new Promise((resolve) => { if (server.listening) resolve(); else server.once('listening', resolve); });
        const base = `http://127.0.0.1:${server.address().port}`;
        const users = mongoose.connection.db.collection('users');
        const userRole = (await admin.request('/roles/user')).body;
        const adminRole = (await admin.request('/roles/admin')).body;
        async function account(label, role = 'user', linked = true) {
            const mongoId = new mongoose.Types.ObjectId();
            const username = `${prefix}-${label}`;
            const representation = { username, email: `${username}@example.test`, firstName: 'Người dùng kiểm tra',
                enabled: true, emailVerified: true, credentials: [{ type: 'password', value: password, temporary: false }],
                attributes: { phase3CheckRun: [prefix], ...(linked ? { mongoUserId: [String(mongoId)], legacyStatus: ['active'] } : {}) } };
            const response = (await admin.request('/users', { method: 'POST', body: JSON.stringify(representation) })).response;
            const id = response.headers.get('location').split('/').pop();
            accountIds.push(id);
            await admin.request(`/users/${id}/role-mappings/realm`, { method: 'POST', body: JSON.stringify(role === 'admin' ? [userRole, adminRole] : [userRole]) });
            if (linked) {
                mongoIds.push(mongoId);
                await users.insertOne({ _id: mongoId, keycloakId: id, email: representation.email, fullName: representation.firstName,
                    gender: 'other', role, status: 'active', authSyncVersion: 0, authSyncPending: false });
            }
            return { id, mongoId, username };
        }
        const actor = await account('admin', 'admin');
        const subject = await account('user');
        const actorTokens = await oidc.login(config, actor.username, password);
        const subjectTokens = await oidc.login(config, subject.username, password);
        async function api(endpoint, token, { method = 'GET', body } = {}) {
            const response = await fetch(`${base}${endpoint}`, { method, signal: AbortSignal.timeout(20000),
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: body === undefined ? undefined : JSON.stringify(body) });
            let data; try { data = await response.json(); } catch { data = null; }
            return { status: response.status, data };
        }
        let result = await api('/api/auth/me', subjectTokens.access_token);
        assert.equal(result.status, 200, `Valid token rejected: ${result.data?.code}`);
        assert.equal(result.data.user._id, String(subject.mongoId));
        assert.equal(result.data.user.role, 'user');
        assert.equal(result.data.user.password, undefined);
        pass('Authorization Code + PKCE and MongoDB identity mapping');
        assert.equal((await api('/api/auth/me')).status, 401);
        assert.equal((await api('/api/auth/me', 'old-jwt-token')).status, 401);
        const oldHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const oldPayload = Buffer.from(JSON.stringify({ userId: String(subject.mongoId), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
        const oldSignature = crypto.createHmac('sha256', password).update(`${oldHeader}.${oldPayload}`).digest('base64url');
        assert.equal((await api('/api/auth/me', `${oldHeader}.${oldPayload}.${oldSignature}`)).status, 401);
        assert.equal((await api('/api/auth/login', undefined, { method: 'POST', body: {} })).status, 404);
        assert.equal((await api('/api/auth/register', undefined, { method: 'POST', body: {} })).status, 404);
        const pieces = subjectTokens.access_token.split('.');
        pieces[2] = (pieces[2][0] === 'A' ? 'B' : 'A') + pieces[2].slice(1);
        assert.equal((await api('/api/auth/me', pieces.join('.'))).status, 401);
        assert.equal((await api('/api/voices', 'invalid-token')).status, 401);
        assert.equal((await api('/api/generate-lecture', undefined, { method: 'POST', body: {} })).status, 401);
        assert.equal((await api('/api/summarize-book', undefined, { method: 'POST', body: {} })).status, 401);
        pass('Missing, legacy and tampered tokens rejected; generation requires login');
        assert.equal((await api('/api/auth/users', subjectTokens.access_token)).status, 403);
        assert.equal((await api('/api/auth/users', actorTokens.access_token)).status, 200);
        pass('Admin API permissions');
        const voices = mongoose.connection.db.collection('voices');
        for (const owner of [actor, subject]) {
            const id = new mongoose.Types.ObjectId(); voiceIds.push(id);
            await voices.insertOne({ _id: id, voice_id: `${prefix}-${owner.username}`, user_id: owner.mongoId,
                name: 'Giọng kiểm tra', gender: 'male', is_active: true, is_global: false, file_path: 'check-only.wav' });
        }
        const lectureId = new mongoose.Types.ObjectId(); historyIds.push(lectureId);
        await mongoose.connection.db.collection('generatedlectures').insertOne({ _id: lectureId, user_id: subject.mongoId,
            text: 'Nội dung kiểm tra', teacher_id: `${prefix}-${subject.username}`, style_id: 'normal',
            audio_url: 'http://localhost/check-only.wav', createdAt: new Date() });
        result = await api('/api/voices', subjectTokens.access_token);
        assert.equal(result.status, 200);
        assert.ok(result.data.some((voice) => voice._id === String(voiceIds[1])));
        assert.ok(!result.data.some((voice) => voice._id === String(voiceIds[0])));
        assert.equal((await api(`/api/voices/${voiceIds[0]}`, subjectTokens.access_token, { method: 'PUT', body: { name: 'Không được sửa' } })).status, 403);
        assert.equal((await api('/api/generate-lecture', subjectTokens.access_token, { method: 'POST',
            body: { text: 'Kiểm tra', teacher_id: `${prefix}-${actor.username}` } })).status, 403);
        result = await api('/api/history', subjectTokens.access_token);
        assert.equal(result.status, 200);
        assert.equal(result.data[0]._id, String(lectureId));
        assert.equal((await api('/api/history', actorTokens.access_token)).data.length, 0);
        pass('Voice ownership, private voice selection and history preserved');

        assert.equal((await api(`/api/auth/users/${subject.mongoId}/role`, actorTokens.access_token, { method: 'PUT', body: { role: 'admin' } })).status, 200);
        assert.ok([401, 403].includes((await api('/api/auth/users', subjectTokens.access_token)).status));
        const promoted = await oidc.login(config, subject.username, password);
        assert.equal((await api('/api/auth/users', promoted.access_token)).status, 200);
        assert.equal((await api(`/api/auth/users/${subject.mongoId}/role`, actorTokens.access_token, { method: 'PUT', body: { role: 'user' } })).status, 200);
        assert.ok([401, 403].includes((await api('/api/auth/users', promoted.access_token)).status));
        pass('Role promotion requires fresh token; demotion blocks old admin token');
        for (const status of ['inactive', 'banned']) {
            assert.equal((await api(`/api/auth/users/${subject.mongoId}/status`, actorTokens.access_token, { method: 'PUT', body: { status } })).status, 200);
            assert.equal((await api('/api/auth/me', subjectTokens.access_token)).status, 403);
            const saved = (await admin.request(`/users/${subject.id}`)).body;
            assert.equal(saved.enabled, false); assert.equal(saved.attributes.legacyStatus[0], status);
            assert.equal((await api(`/api/auth/users/${subject.mongoId}/status`, actorTokens.access_token, { method: 'PUT', body: { status: 'active' } })).status, 200);
        }
        assert.equal((await api(`/api/auth/users/${actor.mongoId}/role`, actorTokens.access_token, { method: 'PUT', body: { role: 'user' } })).status, 409);
        pass('Inactive/banned accounts blocked and administrator self-lockout prevented');

        const { keycloakService, problem } = require('../app/services/keycloak.service');
        const service = keycloakService(), originalUpdate = service.updateAccount;
        try {
            service.updateAccount = async () => { throw problem(503, 'Injected sync failure', 'AUTH_SYNC_FAILED'); };
            assert.equal((await api(`/api/auth/users/${subject.mongoId}/role`, actorTokens.access_token, { method: 'PUT', body: { role: 'admin' } })).status, 503);
            assert.equal((await api('/api/auth/me', subjectTokens.access_token)).data.code, 'AUTH_SYNC_PENDING');
        } finally { service.updateAccount = originalUpdate; }
        assert.equal((await api(`/api/auth/users/${subject.mongoId}/role`, actorTokens.access_token, { method: 'PUT', body: { role: 'user' } })).status, 200);
        assert.equal((await users.findOne({ _id: subject.mongoId })).authSyncPending, false);
        pass('Partial sync failure blocks account; retry repairs synchronization');

        const registrationName = `${prefix}-registered`;
        const registered = await oidc.register(config, registrationName, password);
        const registeredUser = (await admin.request(`/users?username=${registrationName}&exact=true`)).body[0];
        accountIds.push(registeredUser.id);
        result = await api('/api/auth/me', registered.access_token);
        assert.equal(result.status, 200, `Registration profile rejected: ${result.data?.code}`);
        const newId = new mongoose.Types.ObjectId(result.data.user._id); mongoIds.push(newId);
        assert.equal(result.data.user.role, 'user');
        assert.equal(result.data.user.gender, 'female');
        assert.equal((await users.findOne({ _id: newId })).password, undefined);
        assert.equal((await admin.request(`/users/${registeredUser.id}`)).body.attributes.mongoUserId[0], String(newId));
        pass('Browser registration provisions profile without password hash in MongoDB');

        // Explicit collision fixture: a new Keycloak subject must not claim an old MongoDB email.
        const collision = await account('collision', 'user', false);
        const collisionId = new mongoose.Types.ObjectId(); mongoIds.push(collisionId);
        await users.insertOne({ _id: collisionId, email: `${collision.username}@example.test`, fullName: 'Tài khoản cũ', role: 'user', status: 'active' });
        const collisionTokens = await oidc.login(config, collision.username, password);
        result = await api('/api/auth/me', collisionTokens.access_token);
        assert.equal(result.status, 409); assert.equal(result.data.code, 'IDENTITY_CONFLICT');
        assert.equal((await users.findOne({ _id: collisionId })).keycloakId, undefined);
        pass('Email collisions cannot take over legacy accounts');

        clientId = `${prefix}-expiry`;
        await admin.request('/clients', { method: 'POST', body: JSON.stringify({ clientId, enabled: true,
            protocol: 'openid-connect', publicClient: true, standardFlowEnabled: true, fullScopeAllowed: true,
            redirectUris: ['http://localhost:5173/'], attributes: { 'pkce.code.challenge.method': 'S256', 'access.token.lifespan': '1' },
            protocolMappers: [{ name: 'audience', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper',
                config: { 'included.client.audience': 'tts-backend', 'access.token.claim': 'true' } }] }) });
        const shortToken = await oidc.login(config, subject.username, password, clientId);
        await new Promise((resolve) => setTimeout(resolve, 7500));
        assert.equal((await api('/api/auth/me', shortToken.access_token)).status, 401);
        const temporaryClient = (await admin.request(`/clients?clientId=${clientId}`)).body[0];
        for (const mapper of temporaryClient.protocolMappers || []) {
            if (mapper.name === 'audience') await admin.request(`/clients/${temporaryClient.id}/protocol-mappers/models/${mapper.id}`, { method: 'DELETE' });
        }
        await admin.request(`/clients/${temporaryClient.id}`, { method: 'PUT', body: JSON.stringify({
            attributes: { 'pkce.code.challenge.method': 'S256', 'access.token.lifespan': '300' }
        }) });
        const wrongAudience = await oidc.login(config, subject.username, password, clientId);
        assert.equal((await api('/api/auth/me', wrongAudience.access_token)).status, 401);
        const masterResponse = await fetch(`${config.base}/realms/master/protocol/openid-connect/token`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
                grant_type: 'password', client_id: 'admin-cli', username: config.KEYCLOAK_ADMIN_USERNAME, password: config.KEYCLOAK_ADMIN_PASSWORD }) });
        assert.equal(masterResponse.status, 200);
        const master = await masterResponse.json();
        assert.equal((await api('/api/auth/me', master.access_token)).status, 401);
        pass('Expired tokens and wrong audience/realm rejected');
        const fresh = await oidc.login(config, subject.username, password);
        const refreshedResponse = await fetch(`${config.KEYCLOAK_URL}/realms/tts-local/protocol/openid-connect/token`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
                grant_type: 'refresh_token', client_id: 'tts-frontend', refresh_token: fresh.refresh_token }) });
        assert.equal(refreshedResponse.status, 200);
        const refreshed = await refreshedResponse.json();
        assert.equal((await api('/api/auth/me', refreshed.access_token)).status, 200);
        const logout = await fetch(`${config.KEYCLOAK_URL}/realms/tts-local/protocol/openid-connect/logout`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
                client_id: 'tts-frontend', refresh_token: refreshed.refresh_token }) });
        assert.equal(logout.status, 204);
        const afterLogout = await fetch(`${config.KEYCLOAK_URL}/realms/tts-local/protocol/openid-connect/token`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
                grant_type: 'refresh_token', client_id: 'tts-frontend', refresh_token: refreshed.refresh_token }) });
        assert.equal(afterLogout.status, 400);
        assert.equal((await api('/api/auth/me', refreshed.access_token)).status, 401);
        pass('Refresh and logout revoke the refresh session');
        console.log(JSON.stringify({ checks: tests, database: 'tts_phase3_checks', realPasswordsChanged: false }));
        if (serve) {
            fixtureFile = path.join(root, 'keycloak/backups/phase3-browser-fixture.json');
            fs.writeFileSync(fixtureFile, JSON.stringify({ apiUrl: base, username: subject.username, password, adminUsername: actor.username }), { mode: 0o600 });
            console.log('Browser fixture ready; private details in keycloak/backups/phase3-browser-fixture.json. Send ENTER to clean up.');
            await new Promise((resolve) => { process.stdin.resume(); process.stdin.once('data', resolve); });
            process.stdin.pause();
        }
    } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.db.collection('users').deleteMany({ $or: [
                { _id: { $in: mongoIds } }, { email: new RegExp(`^${prefix}-.*@example\\.test$`) }
            ] });
            await mongoose.connection.db.collection('voices').deleteMany({ _id: { $in: voiceIds } });
            await mongoose.connection.db.collection('generatedlectures').deleteMany({ _id: { $in: historyIds } });
            await mongoose.disconnect();
        }
        const leftovers = (await admin.request(`/users?username=${prefix}&max=100`)).body;
        for (const user of leftovers) {
            if (user.username.startsWith(`${prefix}-`) && user.email?.endsWith('@example.test')) {
                await admin.request(`/users/${user.id}`, { method: 'DELETE' });
            }
        }
        if (clientId) {
            const client = (await admin.request(`/clients?clientId=${clientId}`)).body[0];
            if (client?.clientId === clientId) await admin.request(`/clients/${client.id}`, { method: 'DELETE' });
        }
        if (fixtureFile && fs.existsSync(fixtureFile)) fs.unlinkSync(fixtureFile);
    }
}
if (require.main === module) check({ serve: process.argv.includes('--serve') }).catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { check };
