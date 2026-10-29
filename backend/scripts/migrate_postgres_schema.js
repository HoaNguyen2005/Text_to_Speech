const db = require('../app/db/postgres');
db.migrateSchema().then(() => console.log('Đã áp dụng schema PostgreSQL ứng dụng.'))
    .catch((error) => { console.error('Không áp dụng được schema PostgreSQL:', error.code || error.name); process.exitCode = 1; })
    .finally(() => db.close());
