const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const files = [
    [path.join(root, 'keycloak/.env'), [
        'KEYCLOAK_VERSION=26.8.0',
        'MAILPIT_VERSION=1.31.4',
        `KEYCLOAK_DB_PASSWORD=${crypto.randomBytes(32).toString('hex')}`,
        'KEYCLOAK_ADMIN_USERNAME=local-admin',
        `KEYCLOAK_ADMIN_PASSWORD=${crypto.randomBytes(32).toString('hex')}`
    ].join('\n') + '\n'],
    [path.join(root, 'backend/.env.migration.local'), [
        'KEYCLOAK_URL=http://localhost:8080',
        'KEYCLOAK_REALM=tts-local',
        'KEYCLOAK_MIGRATION_MONGODB_URI=mongodb://127.0.0.1:27018/tts_phase2_local',
        'KEYCLOAK_RESET_EMAIL_CLIENT_ID=tts-frontend',
        'KEYCLOAK_RESET_EMAIL_REDIRECT_URI=http://localhost:5173/'
    ].join('\n') + '\n']
];
for (const [filename, content] of files) {
    try {
        fs.writeFileSync(filename, content, { flag: 'wx', mode: 0o600 });
        console.log(`Created ${path.relative(root, filename)} (ignored by Git).`);
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        console.log(`Kept existing ${path.relative(root, filename)}.`);
    }
}
