const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const decode = (text) => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, value) => String.fromCharCode(Number(value)));
function attribute(tag, name) {
    const match = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'));
    return match ? decode(match[1]) : undefined;
}
function form(html, wantedId) {
    const tags = html.match(/<form\b[^>]*>/gi) || [];
    const tag = wantedId ? tags.find((entry) => attribute(entry, 'id') === wantedId) : tags[0];
    if (!tag || !attribute(tag, 'action')) throw new Error('Expected Keycloak form was not returned.');
    const content = html.slice(html.indexOf(tag) + tag.length).split('</form>')[0];
    const fields = {};
    for (const input of content.match(/<input\b[^>]*>/gi) || []) {
        const name = attribute(input, 'name');
        if (name && attribute(input, 'type') === 'hidden') fields[name] = attribute(input, 'value') || '';
    }
    return { action: attribute(tag, 'action'), fields, content };
}
function browser(config) {
    const cookies = new Map();
    async function page(url, options = {}) {
        for (let redirects = 0; redirects < 12; redirects++) {
            const current = new URL(url);
            if (current.origin === 'http://localhost:5173') return { callback: current, html: '', status: 302 };
            assert.equal(current.origin, new URL(config.base).origin, 'Unexpected OIDC redirect origin');
            const response = await fetch(current, { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000),
                headers: { ...options.headers, Cookie: [...cookies.values()].filter((cookie) => current.pathname.startsWith(cookie.path)).map((cookie) => cookie.value).join('; ') } });
            for (const value of response.headers.getSetCookie()) {
                const entry = value.split(';')[0];
                const name = entry.split('=')[0];
                const cookiePath = value.match(/;\s*Path=([^;]+)/i)?.[1] || '/';
                const key = `${name}:${cookiePath}`;
                if (/;\s*Max-Age=0(?:;|$)/i.test(value)) cookies.delete(key);
                else cookies.set(key, { path: cookiePath, value: entry });
            }
            if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get('location')) {
                url = new URL(response.headers.get('location'), current).href;
                if (![307, 308].includes(response.status)) options = {};
                continue;
            }
            return { html: await response.text(), status: response.status, url: current.href };
        }
        throw new Error('Too many OIDC redirects.');
    }
    return { page };
}
function authorization(config, clientId = 'tts-frontend', action = 'auth') {
    const verifier = crypto.randomBytes(40).toString('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: 'http://localhost:5173/', response_type: 'code',
        scope: 'openid profile email', state, nonce: crypto.randomBytes(16).toString('hex'),
        code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    return { verifier, state, clientId, url: `${config.base}/realms/${config.realm}/protocol/openid-connect/${action}?${query}` };
}
async function exchange(config, authorizationRequest, callback) {
    assert.equal(callback?.searchParams.get('state'), authorizationRequest.state, 'OIDC state mismatch');
    assert.ok(callback.searchParams.get('code'), 'Authorization code missing');
    const response = await fetch(`${config.base}/realms/${config.realm}/protocol/openid-connect/token`, {
        method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: authorizationRequest.clientId,
            redirect_uri: 'http://localhost:5173/', code: callback.searchParams.get('code'), code_verifier: authorizationRequest.verifier })
    });
    if (!response.ok) throw new Error(`OIDC code exchange failed (${response.status}).`);
    return response.json();
}
async function login(config, username, password, clientId = 'tts-frontend') {
    const instance = browser(config);
    const request = authorization(config, clientId);
    const first = await instance.page(request.url);
    const loginForm = form(first.html, 'kc-form-login');
    const result = await instance.page(loginForm.action, { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...loginForm.fields, username, password, credentialId: '' }) });
    if (!result.callback?.searchParams.get('code')) throw new Error('Keycloak login did not return an authorization code.');
    return exchange(config, request, result.callback);
}
async function register(config, username, password) {
    const instance = browser(config);
    const request = authorization(config, 'tts-frontend', 'registrations');
    const first = await instance.page(request.url);
    const registration = form(first.html, 'kc-register-form');
    const genderName = [...registration.content.matchAll(/<(?:select|input)\b[^>]*>/gi)]
        .map((entry) => attribute(entry[0], 'name')).find((name) => name?.endsWith('gender'));
    const fields = { ...registration.fields, username, email: `${username}@example.test`,
        firstName: 'Người dùng mới', lastName: '', password, 'password-confirm': password };
    if (genderName) fields[genderName] = 'female';
    const result = await instance.page(registration.action, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
    if (!result.callback?.searchParams.get('code')) throw new Error('Keycloak registration did not complete.');
    return exchange(config, request, result.callback);
}
module.exports = { login, register, browser, authorization, exchange, form };
