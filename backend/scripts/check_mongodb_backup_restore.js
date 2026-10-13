const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { root } = require('./lib/keycloak-local');

async function check(filename) {
    if (!filename) throw new Error('Use --backup <MongoDB EJSON snapshot>.');
    const snapshot = mongoose.mongo.BSON.EJSON.parse(fs.readFileSync(path.resolve(root, filename), 'utf8'), { relaxed: false });
    assert.equal(snapshot.format, 'tts-mongodb-ejson-v1');
    // Hardcoded isolated destination: never restore over the application database.
    const connection = await mongoose.createConnection('mongodb://127.0.0.1:27018/tts_phase3_restore_checks', { autoIndex: false }).asPromise();
    let created = false;
    try {
        assert.equal((await connection.db.listCollections().toArray()).length, 0, 'Restore check database must be empty');
        created = true;
        const counts = {};
        for (const [name, collection] of Object.entries(snapshot.collections)) {
            assert.ok(!name.startsWith('system.') && !name.includes('\0'));
            await connection.db.createCollection(name);
            const target = connection.db.collection(name);
            if (collection.documents.length) await target.insertMany(collection.documents);
            for (const index of collection.indexes) {
                if (index.name === '_id_') continue;
                const options = {};
                for (const key of ['name', 'unique', 'sparse', 'expireAfterSeconds', 'partialFilterExpression', 'collation', 'hidden']) {
                    if (index[key] !== undefined) options[key] = index[key];
                }
                await target.createIndex(index.key, options);
            }
            const restored = await target.find({}).toArray();
            const sorted = (documents) => mongoose.mongo.BSON.EJSON.stringify(documents.sort((a, b) => String(a._id).localeCompare(String(b._id))), { relaxed: false });
            if (sorted(restored) !== sorted(collection.documents)) throw new Error('Restored BSON content differs');
            counts[name] = restored.length;
        }
        console.log(JSON.stringify({ restoreVerified: true, destination: 'tts_phase3_restore_checks', collections: counts }));
    } finally {
        if (created) await connection.db.dropDatabase();
        await connection.close();
    }
}
if (require.main === module) {
    const args = process.argv.slice(2), index = args.indexOf('--backup');
    check(index === -1 ? undefined : args[index + 1]).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { check };
