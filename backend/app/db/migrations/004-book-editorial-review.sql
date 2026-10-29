-- Existing jobs retain their original workflow. New jobs opt into review-v1.
ALTER TABLE book_jobs DROP CONSTRAINT book_jobs_status_check;
ALTER TABLE book_jobs ADD CONSTRAINT book_jobs_status_check
  CHECK (status IN ('queued','processing','review','completed','failed','cancelled'));
ALTER TABLE book_jobs ADD COLUMN workflow_version text
  CHECK (workflow_version IS NULL OR workflow_version = 'review-v1');
ALTER TABLE book_jobs ADD COLUMN work_action text NOT NULL DEFAULT 'summary'
  CHECK (work_action IN ('summary','revise','preview','audio'));
ALTER TABLE book_jobs ADD COLUMN draft jsonb;
ALTER TABLE book_jobs ADD COLUMN draft_revision integer NOT NULL DEFAULT 0 CHECK (draft_revision >= 0);
ALTER TABLE book_jobs ADD COLUMN approved_revision integer;
ALTER TABLE book_jobs ADD COLUMN edit_request jsonb;
ALTER TABLE book_jobs ADD CONSTRAINT book_jobs_approved_revision_check
  CHECK (approved_revision IS NULL OR (approved_revision = draft_revision AND draft IS NOT NULL));
