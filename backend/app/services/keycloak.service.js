const { getKeycloakConfig } = require('../config/keycloak');

function problem(status, message, code) { return Object.assign(new Error(message), { status, code }); }

function createService(config = getKeycloakConfig()) {
    let token, expiresAt = 0, tokenRequest;
    async function serviceToken() {
        if (token && Date.now() < expiresAt) return token;
        if (!config.clientSecret) throw problem(503, 'Chưa cấu hình kết nối quản trị Keycloak cho backend.', 'KEYCLOAK_NOT_CONFIGURED');
        if (!tokenRequest) tokenRequest = (async () => {
            const response = await fetch(config.tokenUrl || `${config.issuer}/protocol/openid-connect/token`, {
                method: 'POST', signal: AbortSignal.timeout(10000),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret })
            });
            if (!response.ok) throw problem(503, 'Không xác thực được service account Keycloak.', 'KEYCLOAK_UNAVAILABLE');
            const data = await response.json();
            if (!data.access_token) throw problem(503, 'Keycloak không trả token quản trị.', 'KEYCLOAK_UNAVAILABLE');
            token = data.access_token;
            expiresAt = Date.now() + Math.max(1, data.expires_in - 15) * 1000;
            return token;
        })().finally(() => { tokenRequest = undefined; });
        return tokenRequest;
    }
    async function request(endpoint, { method = 'GET', body } = {}, retry = true) {
        try {
            const response = await fetch(`${config.internalBase || config.base}/admin/realms/${encodeURIComponent(config.realm)}${endpoint}`, {
                method, signal: AbortSignal.timeout(15000),
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await serviceToken()}` },
                body: body === undefined ? undefined : JSON.stringify(body)
            });
            if (response.status === 401 && retry) { token = undefined; return request(endpoint, { method, body }, false); }
            if (response.status === 404) throw problem(403, 'Tài khoản Keycloak không tồn tại.', 'IDENTITY_NOT_FOUND');
            if (response.status === 409) throw problem(409, 'Thông tin tài khoản Keycloak bị trùng.', 'IDENTITY_CONFLICT');
            if (!response.ok) throw problem(503, 'Không thể cập nhật hoặc đọc dữ liệu Keycloak.', 'KEYCLOAK_UNAVAILABLE');
            const raw = await response.text();
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            if (error.status) throw error;
            throw problem(503, 'Không kết nối được Keycloak. Hãy kiểm tra Docker Desktop và thử lại.', 'KEYCLOAK_UNAVAILABLE');
        }
    }
    const userPath = (id) => `/users/${encodeURIComponent(id)}`;
    async function identity(id) {
        const [user, roles] = await Promise.all([request(userPath(id)), request(`${userPath(id)}/role-mappings/realm/composite`)]);
        return { user, roles, role: roles.some((entry) => entry.name === 'admin') ? 'admin' : 'user' };
    }
    async function attributes(id, values) {
        const user = await request(userPath(id));
        await request(userPath(id), { method: 'PUT', body: { ...user, attributes: { ...user.attributes, ...values } } });
    }
    async function updateAccount(id, { role, status }) {
        const user = await request(userPath(id));
        await request(userPath(id), { method: 'PUT', body: { ...user, enabled: status === 'active',
            attributes: { ...user.attributes, legacyStatus: [status] } } });
        const [userRole, adminRole, current] = await Promise.all([
            request('/roles/user'), request('/roles/admin'), request(`${userPath(id)}/role-mappings/realm`)
        ]);
        if (role === 'user' && current.some((entry) => entry.name === 'admin')) {
            await request(`${userPath(id)}/role-mappings/realm`, { method: 'DELETE', body: [adminRole] });
        }
        await request(`${userPath(id)}/role-mappings/realm`, { method: 'POST', body: role === 'admin' ? [userRole, adminRole] : [userRole] });
        const saved = await identity(id);
        if (saved.role !== role || saved.user.enabled !== (status === 'active')
            || saved.user.attributes?.legacyStatus?.[0] !== status) {
            throw problem(503, 'Keycloak chưa đồng bộ đúng quyền/trạng thái; hãy thử lại thao tác.', 'AUTH_SYNC_FAILED');
        }
        await request(`${userPath(id)}/logout`, { method: 'POST' });
    }
    return { request, identity, attributes, updateAccount };
}
let instance;
function keycloakService() { return instance ||= createService(); }
module.exports = { createService, keycloakService, problem };
