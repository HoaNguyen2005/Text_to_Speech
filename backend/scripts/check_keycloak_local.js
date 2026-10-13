const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { loadLocalConfig, assertLocalMongoUri, createAdminClient } = require('./lib/keycloak-local');

async function check() {
    const config = loadLocalConfig();
    const admin = createAdminClient(config);
    const issuer = `${admin.base}/realms/${encodeURIComponent(admin.realm)}`;
    async function getJson(url) {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        assert.equal(response.status, 200, 'Local endpoint must return HTTP 200');
        return response.json();
    }
    const discovery = await getJson(`${issuer}/.well-known/openid-configuration`);
    assert.equal(discovery.issuer, issuer);
    assert.ok((await getJson(discovery.jwks_uri)).keys.length > 0, 'Realm must publish signing keys');
    const realm = (await admin.request('')).body;
    assert.equal(realm.smtpServer.host, 'mailpit');
    assert.equal(realm.smtpServer.port, '1025');
    const profile = (await admin.request('/users/profile')).body;
    assert.ok(profile.unmanagedAttributePolicy == null, 'Unmanaged attributes must be disabled');
    for (const name of ['mongoUserId', 'legacyStatus', 'migrationResetEmailSent']) {
        const attribute = profile.attributes.find((entry) => entry.name === name);
        assert.deepEqual(attribute?.permissions.edit, ['admin'], `${name} must be administrator controlled`);
    }
    const clients = (await admin.request('/clients')).body;
    const frontend = clients.find((client) => client.clientId === 'tts-frontend');
    const backend = clients.find((client) => client.clientId === 'tts-backend');
    assert.ok(frontend?.publicClient && frontend.standardFlowEnabled);
    assert.equal(frontend.directAccessGrantsEnabled, false);
    assert.equal(frontend.implicitFlowEnabled, false);
    assert.equal(frontend.attributes['pkce.code.challenge.method'], 'S256');
    assert.ok(backend?.bearerOnly && !backend.standardFlowEnabled);
    assert.ok(frontend.protocolMappers.some((mapper) => mapper.config['included.client.audience'] === 'tts-backend'
        && mapper.config['access.token.claim'] === 'true'));
    assert.ok(frontend.protocolMappers.some((mapper) => mapper.config['user.attribute'] === 'mongoUserId'
        && mapper.config['claim.name'] === 'mongoUserId' && mapper.config['access.token.claim'] === 'true'));

    // Read-only runtime checks: no accounts, passwords or sessions are created.
    const missingPkce = await fetch(`${issuer}/protocol/openid-connect/auth?${new URLSearchParams({
        client_id: 'tts-frontend', redirect_uri: 'http://localhost:5173/', response_type: 'code', scope: 'openid'
    })}`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const rejection = `${missingPkce.headers.get('location') || ''} ${await missingPkce.text()}`;
    assert.match(rejection, /code_challenge/i, 'Authorization must reject missing PKCE challenge');

    const connection = await mongoose.createConnection(assertLocalMongoUri(config.KEYCLOAK_MIGRATION_MONGODB_URI), {
        autoIndex: false, serverSelectionTimeoutMS: 10000
    }).asPromise();
    try {
        const users = await connection.db.collection('users').find({}, {
            projection: { _id: 1, keycloakId: 1, email: 1, fullName: 1, role: 1, status: 1, password: 1 }
        }).toArray();
        let active = 0, admins = 0;
        const inbox = await getJson('http://localhost:8025/api/v1/messages?limit=1000');
        for (const user of users) {
            assert.ok(user.keycloakId, 'Local account must have a Keycloak ID');
            assert.equal(user.password, undefined, 'Local metadata copy must exclude old password hashes');
            const target = (await admin.request(`/users/${encodeURIComponent(user.keycloakId)}`)).body;
            assert.equal(target.attributes?.mongoUserId?.[0], String(user._id));
            assert.equal(target.attributes?.legacyStatus?.[0], user.status);
            assert.equal(target.email, user.email);
            assert.equal(target.firstName, user.fullName.trim());
            assert.equal(target.enabled, user.status === 'active');
            const roles = (await admin.request(`/users/${target.id}/role-mappings/realm/composite`)).body;
            assert.ok(roles.some((role) => role.name === user.role), 'Migrated role must match');
            if (user.role !== 'admin') assert.ok(!roles.some((role) => role.name === 'admin'));
            if (user.role === 'admin') admins++;
            if (user.status === 'active') {
                active++;
                assert.equal(target.attributes?.migrationResetEmailSent?.[0], 'true');
                const email = inbox.messages.find((message) => message.To?.some((recipient) => recipient.Address === user.email));
                assert.ok(email, 'Password action email must exist in local Mailpit inbox');
                const message = await getJson(`http://localhost:8025/api/v1/message/${encodeURIComponent(email.ID)}`);
                assert.match(`${message.Text || ''} ${message.HTML || ''}`, /http:\/\/localhost:8080\/realms\/tts-local\/login-actions\/action-token/);
            }
        }
        console.log(JSON.stringify({ realm: admin.realm, accounts: users.length, active, admins,
            mapping: 'OK', roles: 'OK', mailpit: 'OK', pkce: 'S256 enforced', issuerAndJwks: 'OK' }, null, 2));
    } finally {
        await connection.close();
    }
}

if (require.main === module) check().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { check };
