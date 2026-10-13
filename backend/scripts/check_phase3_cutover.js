const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const assert = require('node:assert/strict');
const { root, loadLocalConfig, createAdminClient } = require('./lib/keycloak-local');

async function check(backupFile) {
    if (!backupFile) throw new Error('Use --backup <pre-cutover snapshot>.');
    const snapshot = mongoose.mongo.BSON.EJSON.parse(fs.readFileSync(path.resolve(root, backupFile), 'utf8'), { relaxed: false });
    const config = dotenv.parse(fs.readFileSync(path.join(root, 'backend/.env')));
    const admin = createAdminClient(loadLocalConfig());
    const connection = await mongoose.createConnection(config.MONGODB_URI, { autoIndex: false, family: 4, serverSelectionTimeoutMS: 15000 }).asPromise();
    try {
        assert.equal(snapshot.format, 'tts-mongodb-ejson-v1');
        assert.equal(snapshot.database, connection.db.databaseName);
        const users = await connection.db.collection('users').find({}).toArray();
        assert.equal(await connection.db.collection('users').countDocuments({ password: { $exists: true } }), 0);
        assert.equal(config.JWT_SECRET, undefined);
        let admins = 0;
        for (const previous of snapshot.collections.users.documents) {
            const user = users.find((entry) => String(entry._id) === String(previous._id));
            assert.ok(user?.keycloakId, 'Original MongoDB ID must remain linked');
            const target = (await admin.request(`/users/${user.keycloakId}`)).body;
            assert.equal(target.attributes.mongoUserId[0], String(user._id));
            assert.equal(target.email, user.email);
            const roles = (await admin.request(`/users/${user.keycloakId}/role-mappings/realm/composite`)).body;
            assert.equal(roles.some((role) => role.name === 'admin') ? 'admin' : 'user', user.role);
            assert.equal(target.enabled, user.status === 'active');
            if (user.role === 'admin') admins++;
        }
        const hash = (documents) => crypto.createHash('sha256').update(mongoose.mongo.BSON.EJSON.stringify(
            documents.sort((left, right) => String(left._id).localeCompare(String(right._id))), { relaxed: false })).digest('hex');
        const preserved = {};
        for (const name of ['voices', 'generatedlectures']) {
            const documents = await connection.db.collection(name).find({}).toArray();
            assert.equal(hash(documents), hash(snapshot.collections[name].documents), `${name} changed during auth cutover`);
            preserved[name] = documents.length;
        }
        const realmUsers = (await admin.request('/users?max=1000')).body;
        assert.equal(realmUsers.filter((user) => /^phase3-[a-f0-9]{12}-/.test(user.username)).length, 0, 'Temporary accounts must be cleaned');
        console.log(JSON.stringify({ applicationAccounts: users.length, originalAccountsLinked: snapshot.collections.users.documents.length,
            admins, legacyPasswordHashes: 0, dataUnchanged: preserved, temporaryKeycloakAccounts: 0 }, null, 2));
    } finally { await connection.close(); }
}
if (require.main === module) {
    const args = process.argv.slice(2), index = args.indexOf('--backup');
    check(index === -1 ? undefined : args[index + 1]).catch((error) => {
        console.error(error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[MongoDB connection]')); process.exitCode = 1;
    });
}
module.exports = { check };
