-- All fixtures are rolled back by the caller.
DO $$
DECLARE owner_id text := 'ed3900000000000000000001'; old_job text := 'ed3900000000000000000002';
        main_job text := 'ed3900000000000000000003'; claimed integer;
BEGIN
  INSERT INTO users(_id,email,"fullName") VALUES(owner_id,owner_id || '@example.invalid','Queue test');
  INSERT INTO book_jobs(_id,user_id,request_id,title,source,source_hash,target_minutes,voice_mode)
    VALUES(old_job,owner_id,'test-queue-legacy-001','test','test','test',10,'standard');
  INSERT INTO main_book_jobs(_id,user_id,request_id,title,source,source_hash,target_minutes,voice_mode)
    VALUES(main_job,owner_id,'main/test-queue-legacy-001','test','test','test',10,'standard');
  IF EXISTS (SELECT 1 FROM main_book_jobs WHERE _id=old_job) OR EXISTS (SELECT 1 FROM book_jobs WHERE _id=main_job)
    THEN RAISE EXCEPTION 'Cross-queue job visibility'; END IF;
  UPDATE main_book_jobs SET status='processing' WHERE _id IN (old_job,main_job);
  GET DIAGNOSTICS claimed = ROW_COUNT;
  IF claimed <> 1 OR NOT EXISTS(SELECT 1 FROM book_jobs WHERE _id=old_job AND status='queued')
    THEN RAISE EXCEPTION 'Incorrect queue claim'; END IF;
  INSERT INTO main_worker_leases(_id,owner) VALUES('queue-test-lock','main');
  INSERT INTO worker_leases(_id,owner) VALUES('queue-test-lock','legacy');
  INSERT INTO main_book_previews(_id,user_id,job_id,signature,status,owner,lease_until,expires_at)
    VALUES(main_job,owner_id,main_job,repeat('a',64),'ready','test',now(),now());
  IF EXISTS (SELECT 1 FROM book_previews WHERE _id=main_job)
    THEN RAISE EXCEPTION 'Cross-queue preview'; END IF;
END $$;
