-- Both deployments keep their accounts and history. Old clients can only submit
-- alphanumeric request IDs with hyphens; the server owns the reserved prefix.
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE source text; col record;
BEGIN
  IF EXISTS (SELECT 1 FROM book_job_requests WHERE request_id LIKE 'main/%') THEN
    RAISE EXCEPTION 'Reserved main queue prefix already in use';
  END IF;
  source := rtrim(pg_get_viewdef('book_jobs'::regclass), E'; \n\r\t');
  EXECUTE 'CREATE VIEW main_book_jobs WITH (security_invoker=true) AS ' || source
    || ' WHERE book_job_requests.request_id LIKE ''main/%''';
  EXECUTE 'CREATE OR REPLACE VIEW book_jobs WITH (security_invoker=true) AS ' || source
    || ' WHERE book_job_requests.request_id NOT LIKE ''main/%''';
  FOR col IN SELECT a.attname,pg_get_expr(d.adbin,d.adrelid) AS expr
      FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='book_jobs'::regclass LOOP
    EXECUTE format('ALTER VIEW main_book_jobs ALTER COLUMN %I SET DEFAULT %s',col.attname,col.expr);
  END LOOP;
END $$;
CREATE TRIGGER main_book_jobs_write INSTEAD OF INSERT OR UPDATE OR DELETE ON main_book_jobs
  FOR EACH ROW EXECUTE FUNCTION write_book_jobs();
CREATE TABLE main_worker_leases (LIKE worker_leases INCLUDING ALL);
CREATE TABLE main_book_previews (LIKE book_previews INCLUDING ALL,
  FOREIGN KEY (user_id) REFERENCES users(_id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES book_job_requests(_id) ON DELETE CASCADE);
ALTER TABLE main_worker_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE main_book_previews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON main_book_jobs, main_book_previews, main_worker_leases FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
    EXECUTE format('REVOKE ALL ON main_book_jobs, main_book_previews, main_worker_leases FROM %I',role_name);
  END LOOP;
END $$;
