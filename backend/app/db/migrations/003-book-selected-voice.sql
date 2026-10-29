ALTER TABLE book_jobs ADD COLUMN selected_voice jsonb;

-- Preserve an already chosen legacy voice; never choose a new voice during migration.
UPDATE book_jobs SET selected_voice = checkpoint->'voice'
WHERE jsonb_typeof(checkpoint->'voice') = 'object'
  AND (checkpoint->'voice') ?& ARRAY['voice_id','name','gender','file_path'];

ALTER TABLE book_jobs ADD CONSTRAINT book_jobs_selected_voice_check CHECK (
  selected_voice IS NULL OR COALESCE(
    jsonb_typeof(selected_voice) = 'object'
    AND selected_voice ?& ARRAY['voice_id','name','gender','file_path']
    AND jsonb_typeof(selected_voice->'voice_id') = 'string'
    AND (selected_voice->>'voice_id') ~ '^[a-zA-Z0-9_-]{1,80}$'
    AND jsonb_typeof(selected_voice->'name') = 'string'
    AND length(btrim(selected_voice->>'name')) > 0
    AND (selected_voice->>'gender') IN ('male','female')
    AND jsonb_typeof(selected_voice->'file_path') = 'string', false)
);
