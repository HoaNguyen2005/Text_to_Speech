const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { root, loadLocalConfig, createAdminClient } = require('./lib/keycloak-local');

async function cleanup() {
    const filename = path.join(root, 'keycloak/backups/phase3-browser-fixture.json');
    const fixture = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const prefix = fixture.username?.replace(/-user$/, '');
    if (!/^phase3-[a-f0-9]{12}$/.test(prefix)) throw new Error('Invalid test fixture marker.');
    const api = new URL(fixture.apiUrl);
    if (api.hostname !== '127.0.0.1') throw new Error('Fixture must belong to localhost.');
    const admin = createAdminClient(loadLocalConfig());
    const connection = await mongoose.createConnection('mongodb://127.0.0.1:27018/tts_phase3_checks', { autoIndex: false }).asPromise();
    try {
        const users = await connection.db.collection('users').find({ email: new RegExp(`^${prefix}-.*@example\\.test$`) }).toArray();
        const ids = users.map((user) => user._id);
        await connection.db.collection('voices').deleteMany({ user_id: { $in: ids } });
        await connection.db.collection('generatedlectures').deleteMany({ user_id: { $in: ids } });
        await connection.db.collection('users').deleteMany({ _id: { $in: ids } });
        const accounts = (await admin.request(`/users?username=${prefix}&max=100`)).body;
        let removed = 0;
        for (const user of accounts) {
            if (!user.username.startsWith(`${prefix}-`) || !user.email?.endsWith('@example.test')) continue;
            await admin.request(`/users/${user.id}`, { method: 'DELETE' }); removed++;
        }
        const clientId = `${prefix}-expiry`;
        const client = (await admin.request(`/clients?clientId=${clientId}`)).body[0];
        if (client?.clientId === clientId) await admin.request(`/clients/${client.id}`, { method: 'DELETE' });
        fs.unlinkSync(filename);
        console.log(JSON.stringify({ removedLocalProfiles: users.length, removedKeycloakFixtures: removed, prefix }));
    } finally { await connection.close(); }
}
if (require.main === module) cleanup().catch((error) => { console.error(error.message); process.exitCode = 1; });
