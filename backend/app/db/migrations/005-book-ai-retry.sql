ALTER TABLE book_jobs ADD COLUMN next_attempt_at timestamptz;
ALTER TABLE book_jobs ADD COLUMN retry_state jsonb;
CREATE INDEX book_jobs_retry_idx ON book_jobs(next_attempt_at, "createdAt") WHERE status = 'queued';
