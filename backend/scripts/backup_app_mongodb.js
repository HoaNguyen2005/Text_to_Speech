const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { root } = require('./lib/keycloak-local');

async function backup() {
    const config = dotenv.parse(fs.readFileSync(path.join(root, 'backend/.env')));
    if (!config.MONGODB_URI) throw new Error('Missing application MONGODB_URI.');
    const connection = await mongoose.createConnection(config.MONGODB_URI, {
        autoIndex: false, family: 4, serverSelectionTimeoutMS: 15000
    }).asPromise();
    try {
        const collections = {};
        for (const { name, type } of await connection.db.listCollections().toArray()) {
            if (type !== 'collection' || name.startsWith('system.')) continue;
            const collection = connection.db.collection(name);
            collections[name] = { documents: await collection.find({}).toArray(), indexes: await collection.indexes() };
        }
        const directory = path.join(root, 'keycloak/backups');
        fs.mkdirSync(directory, { recursive: true });
        const filename = path.join(directory, `app-mongodb-${Date.now()}.json`);
        const snapshot = { format: 'tts-mongodb-ejson-v1', createdAt: new Date().toISOString(),
            database: connection.db.databaseName, collections };
        fs.writeFileSync(filename, mongoose.mongo.BSON.EJSON.stringify(snapshot, { relaxed: false }), { flag: 'wx', mode: 0o600 });
        const saved = mongoose.mongo.BSON.EJSON.parse(fs.readFileSync(filename, 'utf8'), { relaxed: false });
        if (saved.format !== snapshot.format) throw new Error('Backup readback failed.');
        console.log(JSON.stringify({ backup: path.relative(root, filename),
            collections: Object.fromEntries(Object.entries(collections).map(([name, value]) => [name, value.documents.length])) }));
        return filename;
    } finally { await connection.close(); }
}
if (require.main === module) backup().catch((error) => {
    console.error(error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[MongoDB connection]'));
    process.exitCode = 1;
});
module.exports = { backup };
