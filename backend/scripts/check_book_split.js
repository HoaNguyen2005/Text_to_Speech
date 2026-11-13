// Exercise the migration and legacy API in an isolated schema, never application rows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../app/db/postgres');
const Job = require('../app/models/book_job.model');
const queries = require('../app/db/book_queries');
const schema = 'test_split_' + crypto.randomBytes(8).toString('hex');
const migration = fs.readFileSync(path.join(__dirname,'../app/db/migrations/20261112030932_split_book_job_storage.sql'),'utf8');
const owner = 'a'.repeat(24);
const fixture = (id,status='queued') => ({user_id:owner,request_id:id,title:'Split test',source:'Nguồn kiểm thử',source_hash:'test',target_minutes:5,voice_mode:'standard',status});
async function invalid(work, code) {
    await db.query('SAVEPOINT invalid_case');
    try { await work(); await db.query('SET CONSTRAINTS ALL IMMEDIATE'); }
    catch(error) {
        await db.query('ROLLBACK TO SAVEPOINT invalid_case');
        assert.equal(error.pgCode || error.code,code);
        return;
    }
    assert.fail('Invalid data was accepted');
}
async function main() {
    try {
        await db.transaction(async()=>{
            await db.query(`CREATE SCHEMA "${schema}"`);
            await db.query(`SET LOCAL search_path TO "${schema}", public`);
            // Build the pre-split schema from immutable historical migrations.
            const dir=path.join(__dirname,'../app/db');
            await db.query(fs.readFileSync(path.join(dir,'schema.sql'),'utf8'));
            for(const file of fs.readdirSync(path.join(dir,'migrations')).filter(file=>/^00[2-9]-.*\.sql$/.test(file)).sort()) {
                await db.query(fs.readFileSync(path.join(dir,'migrations',file),'utf8'));
            }
            await db.query('ALTER TABLE book_jobs ALTER COLUMN "updatedAt" TYPE timestamptz(3)');
            await db.query('INSERT INTO users (_id,email,"fullName") VALUES ($1,$2,$3)',[owner,'split-test@example.invalid','Test']);
            await Job.create({...fixture('before'),draft:{sections:[{text:'Bản nháp'}]},checkpoint:{editorial:{source_duration_issue:{max_minutes:2}}}});
            const before=(await db.query('SELECT to_jsonb(j) AS value FROM book_jobs j')).rows;
            await db.query(migration);
            assert.deepEqual((await db.query('SELECT to_jsonb(j) AS value FROM book_jobs j')).rows,before);
        });
        await db.transaction(async()=>{
            await db.query(`SET LOCAL search_path TO "${schema}", public`);
            const created=await Job.create(fixture('after'));
            assert.ok(created._id);
            const claimed=await Job.findOneAndUpdate({_id:created._id,status:'queued'},{$set:{status:'processing',lease_owner:'test'}},{sort:{createdAt:1}});
            assert.equal(claimed.status,'processing');
            assert.equal((await Job.updateOne({_id:created._id,status:'queued'},{$set:{status:'failed'}})).matchedCount,0);
            await Job.updateOne({_id:created._id},{$inc:{runs:1},$set:{'progress.percent':50}});
            assert.equal((await Job.findById(created._id)).runs,1);
            assert.equal((await Job.findById(created._id)).progress.percent,50);
            await invalid(()=>Job.create(fixture('after')),'23505');
            await invalid(()=>Job.updateOne({_id:created._id},{$unset:{source:''}}),'23514');
            await invalid(()=>Job.updateOne({_id:created._id},{$set:{draft_revision:2,approved_revision:1,draft:{sections:[]}}}),'23514');
            await Job.updateOne({_id:created._id},{$set:{status:'review',draft_revision:1,approved_revision:1,draft:{sections:[{text:'Nội dung'}],estimated_seconds:300}}});
            assert.equal((await queries.listJobs(owner)).length,2);
            assert.deepEqual(await queries.listJobs('b'.repeat(24)),[]);
            await Job.updateOne({_id:created._id},{$set:{status:'completed',result:{audio_url:'test.mp3'}},$unset:{source:'',checkpoint:''}});
            assert.equal((await queries.cleanupCandidates()).length,1);
            const [candidate]=await queries.cleanupCandidates();
            assert.equal(await queries.cleanupUnchanged(candidate),true);
            await Job.updateOne({_id:created._id},{$set:{artifacts_cleaned:true}});
            assert.equal(await queries.cleanupUnchanged(candidate),false);
            await db.query('INSERT INTO generated_lectures (_id,book_job_id,user_id,text,audio_url) VALUES ($1,$2,$3,$4,$5)',['c'.repeat(24),created._id,owner,'Test','test.mp3']);
            await invalid(()=>Job.deleteMany({_id:created._id}),'23503');
            const removable=await Job.create(fixture('remove','cancelled'));
            await db.query('INSERT INTO book_previews (_id,user_id,job_id,signature,status,owner,lease_until,expires_at) VALUES ($1,$2,$3,$4,$5,$6,now(),now())',
                ['d'.repeat(24),owner,removable._id,'0'.repeat(64),'ready','test']);
            await Job.deleteMany({_id:removable._id});
            assert.equal((await db.query('SELECT 1 FROM book_previews WHERE job_id=$1',[removable._id])).rowCount,0);
            assert.equal((await db.query('SELECT 1 FROM book_job_sources WHERE job_id=$1',[removable._id])).rowCount,0);
            await invalid(()=>db.query('DELETE FROM book_job_drafts WHERE job_id=$1',[created._id]),'23514');
            await db.query('SET CONSTRAINTS ALL IMMEDIATE');
        });
        // Real concurrent clients: a second worker must skip the locked job.
        const clients=await Promise.all([db.getPool().connect(),db.getPool().connect()]);
        try {
            for(const client of clients){await client.query('BEGIN');await client.query(`SET LOCAL search_path TO "${schema}", public`);}
            const first=await clients[0].query("SELECT _id FROM book_jobs WHERE status='queued' FOR UPDATE SKIP LOCKED");
            assert.equal(first.rowCount,1);
            assert.equal((await clients[1].query("SELECT _id FROM book_jobs WHERE status='queued' FOR UPDATE SKIP LOCKED")).rowCount,0);
            const id=first.rows[0]._id;
            await clients[0].query("UPDATE book_jobs SET status='processing' WHERE _id=$1",[id]);
            const pending=clients[1].query("UPDATE book_jobs SET status='failed' WHERE _id IN (SELECT _id FROM book_jobs WHERE _id=$1 AND status='queued' FOR UPDATE) RETURNING _id",[id]);
            await clients[0].query('COMMIT');
            assert.equal((await pending).rowCount,0);
        } finally {for(const client of clients){await client.query('ROLLBACK');client.release();}}
        console.log('PASS: split migration preserves data; legacy CRUD, claims, approval, cleanup, owner filters, FK/cascade, deferred integrity and concurrent SKIP LOCKED');
    } finally { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.close());
