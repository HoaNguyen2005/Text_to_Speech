ALTER TABLE voices
    ADD COLUMN IF NOT EXISTS nation text NOT NULL DEFAULT 'vi'
    CHECK (nation ~ '^[a-z]{2}(?:-[A-Z]{2})?$');
