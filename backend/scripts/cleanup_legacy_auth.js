const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
require('./lib/legacy-mongo-tool');
const mongoose = require('mongoose');
const { root, loadLocalConfig, createAdminClient } = require('./lib/keycloak-local');

async function cleanup({ execute = false, backupFile } = {}) {
    const envFile = path.join(root, 'backend/.env');
    const config = dotenv.parse(fs.readFileSync(envFile));
    const connection = await mongoose.createConnection(config.MONGODB_URI, { family: 4, autoIndex: false, serverSelectionTimeoutMS: 15000 }).asPromise();
    try {
        const collection = connection.db.collection('users');
        const users = await collection.find({ password: { $exists: true } }).toArray();
        console.log(JSON.stringify({ legacyPasswordHashes: users.length, mode: execute ? 'remove-backed-up-hashes' : 'dry-run' }));
        if (!execute) return;
        if (!backupFile) throw new Error('--execute requires --backup <full MongoDB snapshot>.');
        const filename = path.resolve(root, backupFile);
        if (!filename.startsWith(path.resolve(root, 'keycloak/backups') + path.sep)) throw new Error('Backup must be inside keycloak/backups.');
        const snapshot = mongoose.mongo.BSON.EJSON.parse(fs.readFileSync(filename, 'utf8'), { relaxed: false });
        if (snapshot.format !== 'tts-mongodb-ejson-v1' || snapshot.database !== connection.db.databaseName) throw new Error('Invalid source backup.');
        const admin = createAdminClient(loadLocalConfig());
        // Verify every account and hash backup before removing any legacy field.
        for (const user of users) {
            const saved = snapshot.collections.users.documents.find((entry) => String(entry._id) === String(user._id));
            if (!saved || saved.password !== user.password || saved.email !== user.email || !user.keycloakId) throw new Error('Legacy credential is not safely backed up and linked.');
            const target = (await admin.request(`/users/${encodeURIComponent(user.keycloakId)}`)).body;
            if (target.attributes?.mongoUserId?.[0] !== String(user._id) || target.email !== user.email) throw new Error('Identity mapping mismatch.');
        }
        const privateBackup = path.join(root, `keycloak/backups/backend-env-before-phase3-${Date.now()}.env`);
        fs.copyFileSync(envFile, privateBackup, fs.constants.COPYFILE_EXCL);
        let removed = 0;
        for (const user of users) {
            const result = await collection.updateOne({ _id: user._id, keycloakId: user.keycloakId, password: user.password }, { $unset: { password: '' } });
            if (result.matchedCount !== 1) throw new Error('Legacy credential changed concurrently; cleanup stopped.');
            removed += result.modifiedCount;
        }
        const remaining = fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((line) => !/^\s*(?:export\s+)?JWT_SECRET\s*=/.test(line)).join('\n');
        fs.writeFileSync(envFile, remaining, { mode: 0o600 });
        console.log(JSON.stringify({ removedPasswordHashes: removed, configBackup: path.relative(root, privateBackup) }));
    } finally { await connection.close(); }
}
if (require.main === module) {
    const args = process.argv.slice(2), position = args.indexOf('--backup');
    const flags = args.filter((_, index) => index !== position && index !== (position === -1 ? -1 : position + 1));
    if (flags.some((flag) => flag !== '--execute')) { console.error('Usage: --execute --backup <snapshot> (default: dry-run)'); process.exitCode = 1; }
    else cleanup({ execute: args.includes('--execute'), backupFile: position === -1 ? undefined : args[position + 1] }).catch((error) => {
        console.error(error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[MongoDB connection]')); process.exitCode = 1;
    });
}
module.exports = { cleanup };
