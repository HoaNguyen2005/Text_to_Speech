const { loadLocalConfig, createAdminClient } = require('./lib/keycloak-local');

async function prepare({ execute = false } = {}) {
    const admin = createAdminClient(loadLocalConfig());
    const realm = (await admin.request('')).body;
    if (realm.smtpServer?.host !== 'mailpit' || realm.smtpServer.port !== '1025') throw new Error('Only local Mailpit delivery is allowed.');
    const users = (await admin.request('/users?max=1000')).body.filter((user) => user.enabled && user.attributes?.mongoUserId);
    const pending = [];
    for (const user of users) {
        const credentials = (await admin.request(`/users/${user.id}/credentials`)).body;
        if (!credentials.some((credential) => credential.type === 'password')) pending.push(user);
    }
    let sent = 0;
    if (execute) for (const user of pending) {
        const query = new URLSearchParams({ client_id: 'tts-frontend', redirect_uri: 'http://localhost:5173/', lifespan: '43200' });
        await admin.request(`/users/${user.id}/execute-actions-email?${query}`, { method: 'PUT', body: JSON.stringify(['UPDATE_PASSWORD']) });
        sent++;
    }
    console.log(JSON.stringify({ activeMappedAccounts: users.length, accountsNeedingPassword: pending.length, localEmailsSent: sent }));
}
if (require.main === module) {
    if (process.argv.slice(2).some((argument) => argument !== '--execute')) { console.error('Usage: [--execute] (default: dry-run)'); process.exitCode = 1; }
    else prepare({ execute: process.argv.includes('--execute') }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { prepare };
