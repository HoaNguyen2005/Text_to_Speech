const db = require('./postgres');
const { book_jobs: spec } = require('./tables');

async function cleanupCandidates() {
    // Keep PostgreSQL microseconds intact; JavaScript Date truncates them.
    return (await db.query(`SELECT _id, status, delete_requested, "updatedAt"::text AS revision
        FROM book_jobs WHERE artifacts_cleaned IS DISTINCT FROM true
        AND status IN ('completed','cancelled') ORDER BY "updatedAt", _id LIMIT 10`)).rows;
}
async function cleanupUnchanged(job) {
    return (await db.query(`SELECT 1 FROM book_jobs WHERE _id=$1 AND status=$2
        AND "updatedAt"=$3::timestamptz AND artifacts_cleaned IS DISTINCT FROM true`,
    [job._id, job.status, job.revision])).rowCount > 0;
}
async function listJobs(userId) {
    const fields = spec.columns.filter(key => !['source','checkpoint','draft','result'].includes(key))
        .map(key => `j."${key}"`).join(',');
    return (await db.query(`SELECT ${fields},
        CASE WHEN draft IS NOT NULL THEN jsonb_build_object('has_draft',true,'estimated_seconds',draft->'estimated_seconds') END AS draft,
        result - 'summary' AS result,
        checkpoint #> '{editorial,source_duration_issue}' AS source_duration_issue
        FROM book_jobs j WHERE user_id=$1 AND delete_requested=false AND
        (status IN ('queued','processing','review') OR _id IN
            (SELECT _id FROM book_jobs WHERE user_id=$1 AND delete_requested=false ORDER BY "createdAt" DESC LIMIT 30))
        ORDER BY (status IN ('queued','processing','review')) DESC, "createdAt" DESC`, [userId])).rows;
}
module.exports = { cleanupCandidates, cleanupUnchanged, listJobs };
