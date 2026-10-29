-- Keep a small submission tombstone so a network retry cannot recreate a discarded job.
ALTER TABLE book_jobs ADD COLUMN delete_requested boolean NOT NULL DEFAULT false;
CREATE INDEX book_jobs_visible_owner_created ON book_jobs (user_id, "createdAt" DESC)
  WHERE delete_requested = false;
