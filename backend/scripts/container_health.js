const fs = require('fs/promises');
const database = require('../app/db/postgres');
async function main() {
    if (process.argv[2] === 'backend') {
        const response = await fetch('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('Backend not ready');
    } else if (process.argv[2] === 'worker') {
        const owner = (await fs.readFile(process.env.BOOK_WORKER_ID_FILE, 'utf8')).trim();
        const result = await database.query("SELECT 1 FROM worker_leases WHERE _id='book-audio' AND owner=$1 AND until>now()", [owner]);
        if (!result.rowCount) throw new Error('Worker lease not ready');
    } else throw new Error('Unknown service');
}
main().catch(() => { process.exitCode = 1; }).finally(() => database.close());
