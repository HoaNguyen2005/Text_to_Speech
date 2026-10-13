const fs = require('node:fs');
const path = require('node:path');
const { root, loadLocalConfig, createAdminClient } = require('./lib/keycloak-local');
const { configure } = require('./configure_keycloak_local');
const { configureTheme } = require('./configure_keycloak_theme');

async function provision() {
    const config = loadLocalConfig();
    const admin = createAdminClient(config);
    await configure(config);
    const { body: profile } = await admin.request('/users/profile');
    const gender = profile.attributes.find((entry) => entry.name === 'gender');
    gender.displayName = 'Giới tính';
    gender.permissions = { view: ['admin', 'user'], edit: ['admin', 'user'] };
    gender.validations = { options: { options: ['male', 'female', 'other'] } };
    await admin.request('/users/profile', { method: 'PUT', body: JSON.stringify(profile) });
    await configureTheme(config);
    const clientId = 'tts-admin-service';
    let client = (await admin.request(`/clients?${new URLSearchParams({ clientId })}`)).body[0];
    const representation = { clientId, name: 'TTS backend account management', enabled: true, protocol: 'openid-connect',
        publicClient: false, bearerOnly: false, serviceAccountsEnabled: true, standardFlowEnabled: false,
        directAccessGrantsEnabled: false, implicitFlowEnabled: false, fullScopeAllowed: false };
    if (!client) {
        await admin.request('/clients', { method: 'POST', body: JSON.stringify(representation) });
        client = (await admin.request(`/clients?${new URLSearchParams({ clientId })}`)).body[0];
    } else await admin.request(`/clients/${client.id}`, { method: 'PUT', body: JSON.stringify({ ...client, ...representation }) });
    const serviceUser = (await admin.request(`/clients/${client.id}/service-account-user`)).body;
    const management = (await admin.request('/clients?clientId=realm-management')).body[0];
    const permissions = [];
    for (const name of ['view-users', 'query-users', 'manage-users', 'view-realm']) {
        permissions.push((await admin.request(`/clients/${management.id}/roles/${name}`)).body);
    }
    await admin.request(`/users/${serviceUser.id}/role-mappings/clients/${management.id}`, { method: 'POST', body: JSON.stringify(permissions) });
    await admin.request(`/clients/${client.id}/scope-mappings/clients/${management.id}`, { method: 'POST', body: JSON.stringify(permissions) });
    const userRole = (await admin.request('/roles/user')).body;
    // Preserve account-console permissions for administrators as well as ordinary users.
    for (const user of (await admin.request('/users?max=1000')).body) {
        if (user.attributes?.mongoUserId) await admin.request(`/users/${user.id}/role-mappings/realm`, {
            method: 'POST', body: JSON.stringify([userRole])
        });
    }
    const secret = (await admin.request(`/clients/${client.id}/client-secret`)).body.value;
    if (!secret) throw new Error('No service client secret returned.');
    const filename = path.join(root, 'backend/.env.keycloak.local');
    fs.writeFileSync(filename, [
        `KEYCLOAK_URL=${admin.base}`, `KEYCLOAK_REALM=${admin.realm}`, 'KEYCLOAK_AUDIENCE=tts-backend',
        `KEYCLOAK_SERVICE_CLIENT_ID=${clientId}`, `KEYCLOAK_SERVICE_CLIENT_SECRET=${secret}`
    ].join('\n') + '\n', { mode: 0o600 });
    console.log('Configured backend service account and registration profile; private settings saved to backend/.env.keycloak.local.');
}
if (require.main === module) provision().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { provision };
