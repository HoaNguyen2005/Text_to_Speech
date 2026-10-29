const db = require('../app/db/postgres');
const tables = require('../app/db/tables');

async function main() {
    await db.connect();
    const database = (await db.query(`SELECT current_database() AS database,
        current_user AS role, rolsuper AS superuser, rolcreatedb AS can_create_database
        FROM pg_roles WHERE rolname = current_user`)).rows[0];
    const counts = {};
    for (const table of [...Object.keys(tables), 'legacy_documents']) {
        // Identifiers come from fixed application metadata, never user input.
        counts[table] = Number((await db.query(`SELECT count(*) AS count FROM "${table}"`)).rows[0].count);
    }
    const users = (await db.query(`SELECT count(*) FILTER (WHERE "keycloakId" IS NOT NULL)::int AS linked,
        count(*) FILTER (WHERE role = 'admin')::int AS admins,
        count(*) FILTER (WHERE "authSyncPending")::int AS pending FROM users`)).rows[0];
    const migration = (await db.query(`SELECT id, source_digest, counts, completed_at
        FROM data_migrations WHERE id = 'mongodb-cutover-v1'`)).rows[0];
    const worker = Boolean((await db.query(`SELECT 1 FROM worker_leases
        WHERE _id = 'book-audio' AND until > now()`)).rowCount);
    console.log(JSON.stringify({ database, counts, users, worker_active: worker, migration }, null, 2));
}
main().catch((error) => {
    console.error('[PostgreSQL status]', error.code || error.name);
    process.exitCode = 1;
}).finally(() => db.close());
