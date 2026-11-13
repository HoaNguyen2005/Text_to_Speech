SET LOCAL lock_timeout = '5s';
LOCK TABLE book_jobs IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE _book_jobs_before ON COMMIT DROP AS TABLE book_jobs;
CREATE TEMP TABLE _book_job_defaults ON COMMIT DROP AS
  SELECT a.attname, a.attnum, pg_get_expr(d.adbin,d.adrelid) AS expression
  FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid='book_jobs'::regclass AND a.attnum>0 AND NOT a.attisdropped;

ALTER TABLE book_jobs RENAME TO book_job_requests;

CREATE TABLE book_job_sources (
  job_id text PRIMARY KEY REFERENCES book_job_requests(_id) ON DELETE CASCADE,
  LIKE book_job_requests INCLUDING DEFAULTS INCLUDING CONSTRAINTS
);
DO $$
DECLARE col record;
BEGIN
  FOR col IN SELECT attname FROM _book_job_defaults WHERE attname NOT IN ('source','source_hash') LOOP
    EXECUTE format('ALTER TABLE book_job_sources DROP COLUMN %I',col.attname);
  END LOOP;
END $$;
INSERT INTO book_job_sources (job_id,"source","source_hash") SELECT _id,"source","source_hash" FROM book_job_requests;
ALTER TABLE book_job_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON book_job_sources FROM PUBLIC, anon, authenticated;

CREATE TABLE book_job_drafts (
  job_id text PRIMARY KEY REFERENCES book_job_requests(_id) ON DELETE CASCADE,
  LIKE book_job_requests INCLUDING DEFAULTS INCLUDING CONSTRAINTS
);
DO $$
DECLARE col record;
BEGIN
  FOR col IN SELECT attname FROM _book_job_defaults WHERE attname NOT IN ('draft','draft_revision','approved_revision','edit_request') LOOP
    EXECUTE format('ALTER TABLE book_job_drafts DROP COLUMN %I',col.attname);
  END LOOP;
END $$;
INSERT INTO book_job_drafts (job_id,"draft","draft_revision","approved_revision","edit_request") SELECT _id,"draft","draft_revision","approved_revision","edit_request" FROM book_job_requests;
ALTER TABLE book_job_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON book_job_drafts FROM PUBLIC, anon, authenticated;

CREATE TABLE book_job_runtime (
  job_id text PRIMARY KEY REFERENCES book_job_requests(_id) ON DELETE CASCADE,
  LIKE book_job_requests INCLUDING DEFAULTS INCLUDING CONSTRAINTS
);
DO $$
DECLARE col record;
BEGIN
  FOR col IN SELECT attname FROM _book_job_defaults WHERE attname NOT IN ('workflow_version','work_action','progress','checkpoint','result','error','next_attempt_at','retry_state','lease_owner','lease_until','runs','cancel_requested','delete_requested','artifacts_cleaned') LOOP
    EXECUTE format('ALTER TABLE book_job_runtime DROP COLUMN %I',col.attname);
  END LOOP;
END $$;
INSERT INTO book_job_runtime (job_id,"workflow_version","work_action","progress","checkpoint","result","error","next_attempt_at","retry_state","lease_owner","lease_until","runs","cancel_requested","delete_requested","artifacts_cleaned") SELECT _id,"workflow_version","work_action","progress","checkpoint","result","error","next_attempt_at","retry_state","lease_owner","lease_until","runs","cancel_requested","delete_requested","artifacts_cleaned" FROM book_job_requests;
ALTER TABLE book_job_runtime ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON book_job_runtime FROM PUBLIC, anon, authenticated;

ALTER TABLE book_job_requests DROP COLUMN "source", DROP COLUMN "source_hash", DROP COLUMN "draft", DROP COLUMN "draft_revision", DROP COLUMN "approved_revision", DROP COLUMN "edit_request", DROP COLUMN "workflow_version", DROP COLUMN "work_action", DROP COLUMN "progress", DROP COLUMN "checkpoint", DROP COLUMN "result", DROP COLUMN "error", DROP COLUMN "next_attempt_at", DROP COLUMN "retry_state", DROP COLUMN "lease_owner", DROP COLUMN "lease_until", DROP COLUMN "runs", DROP COLUMN "cancel_requested", DROP COLUMN "delete_requested", DROP COLUMN "artifacts_cleaned";

DO $$
DECLARE fields text; col record;
BEGIN
  SELECT string_agg(format('%I.%I',
    CASE
      WHEN attname IN ('source','source_hash') THEN 'book_job_sources'
      WHEN attname IN ('draft','draft_revision','approved_revision','edit_request') THEN 'book_job_drafts'
      WHEN attname IN ('workflow_version','work_action','progress','checkpoint','result','error','next_attempt_at','retry_state','lease_owner','lease_until','runs','cancel_requested','delete_requested','artifacts_cleaned') THEN 'book_job_runtime'
      ELSE 'book_job_requests' END,attname),', ' ORDER BY attnum)
  INTO fields FROM _book_job_defaults;
  EXECUTE 'CREATE VIEW book_jobs WITH (security_invoker=true) AS SELECT ' || fields ||
    ' FROM book_job_requests JOIN book_job_sources ON book_job_sources.job_id=book_job_requests._id
      JOIN book_job_drafts ON book_job_drafts.job_id=book_job_requests._id
      JOIN book_job_runtime ON book_job_runtime.job_id=book_job_requests._id';
  FOR col IN SELECT * FROM _book_job_defaults WHERE expression IS NOT NULL LOOP
    EXECUTE format('ALTER VIEW book_jobs ALTER COLUMN %I SET DEFAULT %s',col.attname,col.expression);
  END LOOP;
END $$;
REVOKE ALL ON book_jobs FROM PUBLIC, anon, authenticated;

CREATE INDEX book_job_requests_status_created_idx ON book_job_requests(status,"createdAt");
CREATE INDEX book_job_runtime_lease_idx ON book_job_runtime(lease_until);
CREATE INDEX book_job_runtime_retry_idx ON book_job_runtime(next_attempt_at);

-- Old API/worker versions keep the same flat row interface, without duplicate storage.
CREATE FUNCTION write_book_jobs() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    DELETE FROM book_job_requests WHERE _id=OLD._id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW._id IS DISTINCT FROM OLD._id THEN RAISE EXCEPTION 'Job ID cannot change' USING ERRCODE='23514'; END IF;
    PERFORM _id FROM book_job_requests WHERE _id=OLD._id FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;
  IF TG_OP='INSERT' THEN
    INSERT INTO book_job_requests ("_id","user_id","request_id","title","book_metadata","ai_assisted","target_minutes","voice_mode","selected_voice","status","createdAt","updatedAt") VALUES (NEW."_id",NEW."user_id",NEW."request_id",NEW."title",NEW."book_metadata",NEW."ai_assisted",NEW."target_minutes",NEW."voice_mode",NEW."selected_voice",NEW."status",NEW."createdAt",NEW."updatedAt");
  ELSIF ROW(NEW."user_id",NEW."request_id",NEW."title",NEW."book_metadata",NEW."ai_assisted",NEW."target_minutes",NEW."voice_mode",NEW."selected_voice",NEW."status",NEW."createdAt",NEW."updatedAt") IS DISTINCT FROM ROW(OLD."user_id",OLD."request_id",OLD."title",OLD."book_metadata",OLD."ai_assisted",OLD."target_minutes",OLD."voice_mode",OLD."selected_voice",OLD."status",OLD."createdAt",OLD."updatedAt") THEN
    UPDATE book_job_requests SET "user_id"=NEW."user_id", "request_id"=NEW."request_id", "title"=NEW."title", "book_metadata"=NEW."book_metadata", "ai_assisted"=NEW."ai_assisted", "target_minutes"=NEW."target_minutes", "voice_mode"=NEW."voice_mode", "selected_voice"=NEW."selected_voice", "status"=NEW."status", "createdAt"=NEW."createdAt", "updatedAt"=NEW."updatedAt" WHERE _id=OLD._id;
  END IF;
  IF TG_OP='INSERT' THEN
    INSERT INTO book_job_sources ("job_id","source","source_hash") VALUES (NEW."_id",NEW."source",NEW."source_hash");
  ELSIF ROW(NEW."source",NEW."source_hash") IS DISTINCT FROM ROW(OLD."source",OLD."source_hash") THEN
    UPDATE book_job_sources SET "source"=NEW."source", "source_hash"=NEW."source_hash" WHERE job_id=OLD._id;
  END IF;
  IF TG_OP='INSERT' THEN
    INSERT INTO book_job_drafts ("job_id","draft","draft_revision","approved_revision","edit_request") VALUES (NEW."_id",NEW."draft",NEW."draft_revision",NEW."approved_revision",NEW."edit_request");
  ELSIF ROW(NEW."draft",NEW."draft_revision",NEW."approved_revision",NEW."edit_request") IS DISTINCT FROM ROW(OLD."draft",OLD."draft_revision",OLD."approved_revision",OLD."edit_request") THEN
    UPDATE book_job_drafts SET "draft"=NEW."draft", "draft_revision"=NEW."draft_revision", "approved_revision"=NEW."approved_revision", "edit_request"=NEW."edit_request" WHERE job_id=OLD._id;
  END IF;
  IF TG_OP='INSERT' THEN
    INSERT INTO book_job_runtime ("job_id","workflow_version","work_action","progress","checkpoint","result","error","next_attempt_at","retry_state","lease_owner","lease_until","runs","cancel_requested","delete_requested","artifacts_cleaned") VALUES (NEW."_id",NEW."workflow_version",NEW."work_action",NEW."progress",NEW."checkpoint",NEW."result",NEW."error",NEW."next_attempt_at",NEW."retry_state",NEW."lease_owner",NEW."lease_until",NEW."runs",NEW."cancel_requested",NEW."delete_requested",NEW."artifacts_cleaned");
  ELSIF ROW(NEW."workflow_version",NEW."work_action",NEW."progress",NEW."checkpoint",NEW."result",NEW."error",NEW."next_attempt_at",NEW."retry_state",NEW."lease_owner",NEW."lease_until",NEW."runs",NEW."cancel_requested",NEW."delete_requested",NEW."artifacts_cleaned") IS DISTINCT FROM ROW(OLD."workflow_version",OLD."work_action",OLD."progress",OLD."checkpoint",OLD."result",OLD."error",OLD."next_attempt_at",OLD."retry_state",OLD."lease_owner",OLD."lease_until",OLD."runs",OLD."cancel_requested",OLD."delete_requested",OLD."artifacts_cleaned") THEN
    UPDATE book_job_runtime SET "workflow_version"=NEW."workflow_version", "work_action"=NEW."work_action", "progress"=NEW."progress", "checkpoint"=NEW."checkpoint", "result"=NEW."result", "error"=NEW."error", "next_attempt_at"=NEW."next_attempt_at", "retry_state"=NEW."retry_state", "lease_owner"=NEW."lease_owner", "lease_until"=NEW."lease_until", "runs"=NEW."runs", "cancel_requested"=NEW."cancel_requested", "delete_requested"=NEW."delete_requested", "artifacts_cleaned"=NEW."artifacts_cleaned" WHERE job_id=OLD._id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER book_jobs_write INSTEAD OF INSERT OR UPDATE OR DELETE ON book_jobs
  FOR EACH ROW EXECUTE FUNCTION write_book_jobs();

-- Validate cross-table invariants at commit, including direct SQL/Table Editor changes.
CREATE FUNCTION check_book_job_parts() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE job text; ids text[];
BEGIN
  IF TG_TABLE_NAME='book_job_requests' THEN
    IF TG_OP<>'INSERT' THEN ids:=array_append(ids,OLD._id); END IF;
    IF TG_OP<>'DELETE' THEN ids:=array_append(ids,NEW._id); END IF;
  ELSE
    IF TG_OP<>'INSERT' THEN ids:=array_append(ids,OLD.job_id); END IF;
    IF TG_OP<>'DELETE' THEN ids:=array_append(ids,NEW.job_id); END IF;
  END IF;
  FOREACH job IN ARRAY ids LOOP
    IF EXISTS (SELECT 1 FROM book_job_requests WHERE _id=job)
       AND NOT EXISTS (
         SELECT 1 FROM book_job_requests j
         JOIN book_job_sources s ON s.job_id=j._id
         JOIN book_job_drafts d ON d.job_id=j._id
         JOIN book_job_runtime r ON r.job_id=j._id
         WHERE j._id=job AND (j.status IN ('completed','cancelled') OR s.source IS NOT NULL)
       ) THEN
      RAISE EXCEPTION 'Missing job parts or source for job %',job USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER book_job_requests_integrity AFTER INSERT OR UPDATE OR DELETE ON book_job_requests
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_book_job_parts();
CREATE CONSTRAINT TRIGGER book_job_sources_integrity AFTER INSERT OR UPDATE OR DELETE ON book_job_sources
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_book_job_parts();
CREATE CONSTRAINT TRIGGER book_job_drafts_integrity AFTER INSERT OR UPDATE OR DELETE ON book_job_drafts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_book_job_parts();
CREATE CONSTRAINT TRIGGER book_job_runtime_integrity AFTER INSERT OR UPDATE OR DELETE ON book_job_runtime
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_book_job_parts();

DO $$
BEGIN
  EXECUTE format('ALTER FUNCTION write_book_jobs() SET search_path TO %I, pg_temp',current_schema());
  EXECUTE format('ALTER FUNCTION check_book_job_parts() SET search_path TO %I, pg_temp',current_schema());
  IF EXISTS (SELECT to_jsonb(b) FROM _book_jobs_before b EXCEPT ALL SELECT to_jsonb(j) FROM book_jobs j)
     OR EXISTS (SELECT to_jsonb(j) FROM book_jobs j EXCEPT ALL SELECT to_jsonb(b) FROM _book_jobs_before b) THEN
    RAISE EXCEPTION 'Job data changed during split; rolling back';
  END IF;
END $$;
REVOKE ALL ON FUNCTION write_book_jobs(), check_book_job_parts() FROM PUBLIC, anon, authenticated;

