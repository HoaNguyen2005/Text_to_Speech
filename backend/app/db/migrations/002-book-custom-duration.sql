-- Keep schema.sql (001) unchanged: its digest is already recorded on existing databases.
ALTER TABLE book_jobs
  DROP CONSTRAINT book_jobs_target_minutes_check,
  ADD CONSTRAINT book_jobs_target_minutes_check CHECK (target_minutes BETWEEN 1 AND 59);

ALTER TABLE generated_lectures
  ADD CONSTRAINT generated_lectures_target_minutes_check
  CHECK (target_minutes IS NULL OR target_minutes BETWEEN 1 AND 59);
