const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '../../..');
function loadLocalConfig(overrides = {}) {
    const env = {};
    for (const filename of ['keycloak/.env', 'backend/.env.migration.local']) {
        const absolute = path.join(root, filename);
        if (fs.existsSync(absolute)) Object.assign(env, dotenv.parse(fs.readFileSync(absolute)));
    }
    return { ...env, ...process.env, ...overrides };
}

function assertLocalUrl(value) {
    const url = new URL(value);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        throw new Error('Phase 2 tools only support a local Keycloak URL.');
    }
    return url.toString().replace(/\/$/, '');
}

function assertLocalMongoUri(value) {
    if (!value || !/^mongodb:\/\/(localhost|127\.0\.0\.1|\[::1\]):27018\/tts_phase2_(local|checks)(\?.*)?$/.test(value)) {
        throw new Error('Use KEYCLOAK_MIGRATION_MONGODB_URI pointing to localhost:27018/tts_phase2_local (or tts_phase2_checks). Application MONGODB_URI is never used for migration.');
    }
    return value;
}

function createAdminClient(config) {
    const base = assertLocalUrl(config.KEYCLOAK_URL || 'http://localhost:8080');
    const realm = config.KEYCLOAK_REALM || 'tts-local';
    if (!config.KEYCLOAK_ADMIN_USERNAME || !config.KEYCLOAK_ADMIN_PASSWORD) {
        throw new Error('Run node backend/scripts/init_keycloak_local.js to create local administrator settings.');
    }
    let accessToken;
    let tokenExpiry = 0;

    async function fetchResponse(url, options) {
        const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
        const raw = await response.text();
        let body;
        try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
        if (!response.ok) {
            const error = new Error(`Keycloak API returned ${response.status}: ${body?.errorMessage || body?.error_description || body?.error || 'request failed'}`);
            error.status = response.status;
            throw error;
        }
        return { response, body };
    }

    async function token() {
        if (accessToken && Date.now() < tokenExpiry) return accessToken;
        const { body } = await fetchResponse(`${base}/realms/master/protocol/openid-connect/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'password', client_id: 'admin-cli',
                username: config.KEYCLOAK_ADMIN_USERNAME,
                password: config.KEYCLOAK_ADMIN_PASSWORD
            })
        });
        if (!body?.access_token) throw new Error('No administrator access token returned.');
        accessToken = body.access_token;
        tokenExpiry = Date.now() + Math.max(1, body.expires_in - 15) * 1000;
        return accessToken;
    }

    async function request(endpoint, options = {}) {
        const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` };
        return fetchResponse(`${base}/admin/realms/${encodeURIComponent(realm)}${endpoint}`, { ...options, headers });
    }
    return { base, realm, request };
}

module.exports = { root, loadLocalConfig, assertLocalMongoUri, createAdminClient };
