const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { root, loadLocalConfig, createAdminClient } = require('./lib/keycloak-local');

async function link({ execute = false, backupFile } = {}) {
    const config = dotenv.parse(fs.readFileSync(path.join(root, 'backend/.env')));
    const admin = createAdminClient(loadLocalConfig());
    const connection = await mongoose.createConnection(config.MONGODB_URI, {
        autoIndex: false, family: 4, serverSelectionTimeoutMS: 15000
    }).asPromise();
    try {
        const collection = connection.db.collection('users');
        const users = await collection.find({}).toArray();
        if (execute) {
            if (!backupFile) throw new Error('--execute requires --backup <full MongoDB snapshot>.');
            const filename = path.resolve(root, backupFile);
            const allowedDirectory = path.resolve(root, 'keycloak/backups') + path.sep;
            if (!filename.startsWith(allowedDirectory)) throw new Error('Backup must be inside keycloak/backups.');
            const snapshot = mongoose.mongo.BSON.EJSON.parse(fs.readFileSync(filename, 'utf8'), { relaxed: false });
            const saved = snapshot.collections?.users?.documents;
            if (snapshot.format !== 'tts-mongodb-ejson-v1' || snapshot.database !== connection.db.databaseName || saved?.length !== users.length) {
                throw new Error('Backup does not match application database.');
            }
            for (const user of users) {
                const previous = saved.find((entry) => String(entry._id) === String(user._id));
                if (!previous || ['email', 'role', 'status', 'password', 'keycloakId'].some((field) => previous[field] !== user[field])) {
                    throw new Error('Source changed since backup; create a fresh snapshot before linking.');
                }
            }
        }
        const links = [];
        for (const user of users) {
            const matches = (await admin.request(`/users?${new URLSearchParams({ username: user.email, exact: 'true' })}`)).body;
            const target = matches[0];
            if (matches.length !== 1 || target.attributes?.mongoUserId?.[0] !== String(user._id)
                || target.email !== user.email || (user.keycloakId && user.keycloakId !== target.id)) {
                throw new Error(`Unverified identity mapping for MongoDB user ${user._id}.`);
            }
            const roles = (await admin.request(`/users/${target.id}/role-mappings/realm/composite`)).body;
            if (target.enabled !== (user.status === 'active') || target.attributes?.legacyStatus?.[0] !== user.status
                || !roles.some((role) => role.name === user.role)) throw new Error('Source role/status differs from Keycloak; reconcile before linking.');
            links.push({ user, target });
        }
        console.log(JSON.stringify({ mode: execute ? 'link-application' : 'dry-run', accounts: users.length,
            alreadyLinked: users.filter((user) => user.keycloakId).length }));
        if (!execute) return;
        await collection.createIndex({ keycloakId: 1 }, { unique: true, sparse: true });
        for (const { user, target } of links) {
            const result = await collection.updateOne({ _id: user._id, email: user.email, role: user.role, status: user.status,
                $or: [{ keycloakId: { $exists: false } }, { keycloakId: target.id }] }, { $set: { keycloakId: target.id } });
            if (result.matchedCount !== 1) throw new Error('Source changed during linking; no identity was overwritten.');
        }
        console.log(`Linked ${links.length} application accounts; MongoDB IDs and password hashes retained.`);
    } finally { await connection.close(); }
}
if (require.main === module) {
    const args = process.argv.slice(2);
    const index = args.indexOf('--backup');
    const allowed = args.filter((_, position) => position !== index && position !== (index === -1 ? -1 : index + 1));
    if (allowed.some((arg) => arg !== '--execute')) { console.error('Usage: --execute --backup <snapshot> (default: dry-run)'); process.exitCode = 1; }
    else link({ execute: args.includes('--execute'), backupFile: index === -1 ? undefined : args[index + 1] })
        .catch((error) => { console.error(error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[MongoDB connection]')); process.exitCode = 1; });
}
module.exports = { link };
