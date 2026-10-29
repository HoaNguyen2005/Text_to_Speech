const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
require('./lib/legacy-mongo-tool');
const mongoose = require('mongoose');
const { root, loadLocalConfig, assertLocalMongoUri } = require('./lib/keycloak-local');

async function copyUsers({ execute = false } = {}) {
    // The application database is read only. Passwords and old Keycloak IDs are excluded.
    const sourceConfig = dotenv.parse(fs.readFileSync(path.join(root, 'backend/.env')));
    if (!sourceConfig.MONGODB_URI) throw new Error('Missing application MONGODB_URI.');
    const targetUri = assertLocalMongoUri(loadLocalConfig().KEYCLOAK_MIGRATION_MONGODB_URI);
    if (sourceConfig.MONGODB_URI === targetUri) throw new Error('Source and local copy must be separate databases.');
    let source, target;
    try {
        source = await mongoose.createConnection(sourceConfig.MONGODB_URI, {
            autoIndex: false, family: 4, serverSelectionTimeoutMS: 15000
        }).asPromise();
        const users = await source.db.collection('users').find({}, {
            projection: { _id: 1, email: 1, fullName: 1, gender: 1, role: 1, status: 1 }
        }).sort({ _id: 1 }).toArray();
        const emails = new Set();
        for (const user of users) {
            if (typeof user.email !== 'string' || user.email !== user.email.trim().toLowerCase() || emails.has(user.email)) {
                throw new Error('Source emails must be unique and normalized before copying.');
            }
            emails.add(user.email);
        }
        console.log(JSON.stringify({ sourceAccounts: users.length, mode: execute ? 'copy-local' : 'dry-run' }));
        if (!execute) return;
        target = await mongoose.createConnection(targetUri, { autoIndex: false, serverSelectionTimeoutMS: 10000 }).asPromise();
        const collection = target.db.collection('users');
        for (const user of users) {
            const existing = await collection.findOne({ email: user.email });
            if (existing && String(existing._id) !== String(user._id)) throw new Error('Local email belongs to another MongoDB ID.');
            const byId = await collection.findOne({ _id: user._id });
            if (byId && byId.email !== user.email) throw new Error('Local MongoDB ID has a different email.');
        }
        const backupDir = path.join(root, 'keycloak/backups');
        fs.mkdirSync(backupDir, { recursive: true });
        const backup = path.join(backupDir, `users-metadata-${Date.now()}.json`);
        fs.writeFileSync(backup, JSON.stringify(users, null, 2), { flag: 'wx', mode: 0o600 });
        await collection.createIndex({ email: 1 }, { unique: true });
        if (users.length) await collection.bulkWrite(users.map(({ _id, ...metadata }) => ({ updateOne: {
            filter: { _id }, update: { $set: metadata }, upsert: true
        } })));
        console.log(`Copied ${users.length} accounts locally; original IDs preserved. Metadata snapshot: ${path.relative(root, backup)}`);
    } finally {
        await Promise.allSettled([source?.close(), target?.close()]);
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== '--execute')) {
        console.error('Usage: node backend/scripts/copy_users_for_keycloak_local.js [--execute]');
        process.exitCode = 1;
    } else copyUsers({ execute: args.includes('--execute') }).catch((error) => {
        // Avoid including an application connection string in terminal output.
        const message = error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[MongoDB connection]');
        console.error(message);
        process.exitCode = 1;
    });
}
module.exports = { copyUsers };
