// Real PostgreSQL regression test, isolated in temporary tables and always rolled back.
const assert = require('node:assert/strict');
const db = require('../app/db/postgres');
const Job = require('../app/models/book_job.model');
const queries = require('../app/db/book_queries');
async function main() {
    const rollback = new Error('rollback-test');
    try {
        await db.transaction(async () => {
            await db.query('CREATE TEMP TABLE book_jobs (LIKE public.book_jobs INCLUDING ALL) ON COMMIT DROP');
            await db.query('SET LOCAL search_path TO pg_temp, public');
            // Keep microseconds to reproduce the historical cleanup failure.
            await db.query('ALTER TABLE book_jobs ALTER COLUMN "updatedAt" TYPE timestamptz');
            const owner = 'a'.repeat(24), other = 'b'.repeat(24);
            const job = await Job.create({user_id:owner,request_id:'egress-test',title:'Test',source:'x'.repeat(100000),
                source_hash:'test',target_minutes:5,voice_mode:'standard',status:'completed',
                draft:{sections:[{text:'x'.repeat(100000)}],estimated_seconds:300},
                checkpoint:{editorial:{source_duration_issue:{max_minutes:2}},large:'x'.repeat(100000)},
                result:{summary:'x'.repeat(100000),audio_url:'test.mp3'}});
            await db.query('UPDATE book_jobs SET "updatedAt"=$1::timestamptz WHERE _id=$2',['2026-11-11 00:00:00.123456+00',job._id]);
            const [candidate] = await queries.cleanupCandidates();
            assert.equal(await queries.cleanupUnchanged(candidate),true);
            assert.equal('checkpoint' in candidate,false);
            const rows = await queries.listJobs(owner);
            assert.equal(rows.length,1);
            assert.equal(JSON.stringify(rows).length < 5000,true);
            assert.equal(rows[0].source_duration_issue.max_minutes,2);
            assert.equal(rows[0].draft.estimated_seconds,300);
            assert.equal(rows[0].result.audio_url,'test.mp3');
            assert.deepEqual(await queries.listJobs(other),[]);
            assert.equal((await Job.updateOne({_id:job._id,status:'processing'},{$inc:{runs:1}})).matchedCount,0);
            assert.equal((await Job.updateOne({_id:job._id},{$inc:{runs:1},$set:{'progress.percent':75}})).matchedCount,1);
            assert.equal(await queries.cleanupUnchanged(candidate),false);
            const updated=await Job.findById(job._id);
            assert.equal(updated.runs,1);
            assert.equal(updated.progress.percent,75);
            assert.equal((await Job.updateOne({_id:job._id},{$set:{artifacts_cleaned:true},$unset:{source:'',checkpoint:''}})).matchedCount,1);
            assert.deepEqual(await queries.cleanupCandidates(),[]);
            await db.query(`INSERT INTO book_jobs (_id,user_id,request_id,title,source_hash,target_minutes,voice_mode,status,artifacts_cleaned,"createdAt","updatedAt")
                SELECT left(md5(n::text),24),$1,n::text,'Recent','',5,'standard','completed',true,now()+interval '1 day',now()
                FROM generate_series(1,31) n`, [owner]);
            const active = await Job.create({user_id:owner,request_id:'old-active',title:'Review',source:'Test',source_hash:'',target_minutes:5,
                voice_mode:'standard',status:'review',createdAt:new Date('2000-01-01')});
            await Job.create({user_id:owner,request_id:'deleted',title:'Deleted',source:'Test',source_hash:'',target_minutes:5,
                voice_mode:'standard',status:'review',delete_requested:true});
            const recent = await queries.listJobs(owner);
            assert.equal(recent.length,31);
            assert.equal(recent[0]._id,active._id);
            assert.ok(recent.every(row=>!row.delete_requested));
            console.log('PASS: microsecond cleanup, stale guard, owner isolation, compact list, active job retention, atomic updates, cleanup completion');
            throw rollback;
        });
    } catch(error) { if(error!==rollback)throw error; }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.close());
