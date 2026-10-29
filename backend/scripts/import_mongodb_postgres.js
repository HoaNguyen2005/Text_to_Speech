// Read-only source migration. PostgreSQL writes are all committed together after reconciliation.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose'); // Source adapter only; not used by application runtime.
const db = require('../app/db/postgres');
const tables = require('../app/db/tables');
const { root } = require('./lib/postgres-local');
const quote = (value) => `"${value}"`;
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
function plain(value) {
    if (value == null) return value;
    if (value instanceof Date) return value.toISOString();
    if (value._bsontype === 'ObjectId') return String(value);
    if (Array.isArray(value)) return value.map(plain);
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,plain(item)]));
    return value;
}
function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key,stable(value[key])]));
    return value;
}
function digest(value) { return sha(JSON.stringify(stable(plain(value)))); }
function convert(spec, source) {
    const document = { ...structuredClone(spec.defaults || {}), ...plain(source) };
    const row = {};
    for (const column of spec.columns) row[column] = document[column] ?? null;
    row.legacy_data = Object.fromEntries(Object.entries(plain(source)).filter(([key]) => !spec.columns.includes(key)));
    return row;
}
async function sourceSnapshot(connection) {
    const collections = {};
    for (const { name, type } of await connection.db.listCollections().toArray()) {
        if (type !== 'collection' || name.startsWith('system.')) continue;
        collections[name] = { documents: await connection.db.collection(name).find({}).sort({ _id: 1 }).toArray(),
            indexes: await connection.db.collection(name).indexes() };
    }
    return { format: 'tts-mongodb-ejson-v1', createdAt: new Date().toISOString(), database: connection.db.databaseName, collections };
}
function contentDigest(snapshot) {
    return digest(Object.fromEntries(Object.entries(snapshot.collections).map(([name,value]) => [name,value.documents])));
}
async function main() {
    const execute = process.argv.includes('--execute');
    if (!process.env.MONGODB_URI) throw new Error('Thiếu URI MongoDB nguồn trong backend/.env.');
    await db.migrateSchema();
    const source = await mongoose.createConnection(process.env.MONGODB_URI, { family: 4, autoIndex: false, serverSelectionTimeoutMS: 30000, maxPoolSize: 2 }).asPromise();
    try {
        const snapshot = await sourceSnapshot(source);
        const sourceDigest = contentDigest(snapshot);
        const counts = Object.fromEntries(Object.entries(snapshot.collections).map(([name,value]) => [name,value.documents.length]));
        if (!execute) { console.log(JSON.stringify({ mode: 'read-only-preview', sourceCounts: counts, sourceDigest })); return; }
        if ((snapshot.collections.users?.documents || []).some((user) => user.password)) throw new Error('Nguồn còn mật khẩu legacy; cần xử lý trước khi nhập dữ liệu ứng dụng.');
        const leases = snapshot.collections.bookworkerleases?.documents || [];
        if (leases.some((lease) => lease.until && new Date(lease.until) > new Date())) throw new Error('Worker MongoDB còn lease hoạt động. Dừng Backend/worker nguồn và chờ lease hết hạn trước khi chuyển.');
        const directory = path.join(root,'keycloak/backups'); fs.mkdirSync(directory,{recursive:true});
        const backup = path.join(directory,`app-mongodb-before-postgres-${Date.now()}.json`);
        const raw = mongoose.mongo.BSON.EJSON.stringify(snapshot,{relaxed:false});
        fs.writeFileSync(backup,raw,{flag:'wx',mode:0o600});
        if (contentDigest(mongoose.mongo.BSON.EJSON.parse(fs.readFileSync(backup,'utf8'),{relaxed:false})) !== sourceDigest) throw new Error('Backup nguồn không khớp.');
        await db.transaction(async () => {
            await db.query("SELECT pg_advisory_xact_lock(hashtextextended('tts-data-migration',0))");
            const previous = (await db.query("SELECT source_digest FROM data_migrations WHERE id='mongodb-cutover-v1'")).rows[0];
            if (previous) {
                if (previous.source_digest !== sourceDigest) throw new Error('Đã nhập nguồn khác trước đó. Không ghi đè database đã chuyển.');
                console.log('Nguồn này đã nhập trước đó; giữ nguyên PostgreSQL hiện tại.'); return;
            }
            for (const table of [...Object.keys(tables),'legacy_documents']) {
                if ((await db.query(`SELECT 1 FROM ${quote(table)} LIMIT 1`)).rowCount) throw new Error('Database đích không trống; không ghi đè dữ liệu.');
            }
            const handled = new Set();
            for (const [table,spec] of Object.entries(tables)) {
                handled.add(spec.collection);
                const documents = snapshot.collections[spec.collection]?.documents || [];
                const expected = documents.map((sourceDocument) => convert(spec,sourceDocument)).sort((a,b) => a._id.localeCompare(b._id));
                const columns = [...spec.columns,'legacy_data'];
                for (const row of expected) {
                    const values = columns.map((column) => ['legacy_data',...(spec.json || [])].includes(column) && row[column] !== null ? JSON.stringify(row[column]) : row[column]);
                    await db.query(`INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map((c,i)=>`$${i+1}${['legacy_data',...(spec.json||[])].includes(c)?'::jsonb':''}`).join(',')})`,values);
                }
                const actual = (await db.query(`SELECT * FROM ${quote(table)} ORDER BY _id`)).rows;
                if (actual.length !== expected.length || digest(actual) !== digest(expected)) throw new Error(`Đối chiếu dữ liệu không khớp ở bảng ${table}; toàn bộ transaction sẽ rollback.`);
            }
            let archived = 0;
            for (const [collection,value] of Object.entries(snapshot.collections)) if (!handled.has(collection)) {
                for (const document of value.documents) {
                    const ejson = mongoose.mongo.BSON.EJSON.serialize(document,{relaxed:false});
                    await db.query('INSERT INTO legacy_documents(collection_name,document_id,source_ejson) VALUES($1,$2,$3::jsonb)',[collection,String(document._id),JSON.stringify(ejson)]);
                    const stored = (await db.query('SELECT source_ejson FROM legacy_documents WHERE collection_name=$1 AND document_id=$2',[collection,String(document._id)])).rows[0].source_ejson;
                    if (digest(stored) !== digest(ejson)) throw new Error('Không đối chiếu được collection legacy.');
                    archived++;
                }
            }
            if (contentDigest(await sourceSnapshot(source)) !== sourceDigest) throw new Error('MongoDB thay đổi trong lúc chuyển. Dừng các tiến trình ghi nguồn rồi chạy lại.');
            await db.query('INSERT INTO data_migrations(id,source_digest,backup_file,counts) VALUES($1,$2,$3,$4::jsonb)',
                ['mongodb-cutover-v1',sourceDigest,path.relative(root,backup),JSON.stringify({source:counts,archived})]);
        });
        console.log(JSON.stringify({ mode:'completed', backup:path.relative(root,backup), sourceCounts:counts, sourceDigest, sourceModified:false }));
    } finally { await source.close(); }
}
if (require.main === module) main().catch((error) => {
    const authored = /^(Còn |Worker |Nguồn |Đã nhập|Database |Backup |Đối chiếu|Không đối chiếu|MongoDB thay đổi|Thiếu )/.test(error.message);
    console.error(authored ? error.message : `Chưa chuyển được dữ liệu: ${error.pgCode || error.code || error.name}. Không xóa dữ liệu nguồn.`);
    process.exitCode=1;
}).finally(()=>db.close());
