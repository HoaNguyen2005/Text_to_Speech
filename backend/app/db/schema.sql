CREATE TABLE users (
  _id text PRIMARY KEY CHECK (_id ~ '^[0-9a-f]{24}$'),
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  "fullName" text NOT NULL CHECK (length(btrim("fullName")) > 0),
  gender text NOT NULL DEFAULT 'other' CHECK (gender IN ('male','female','other')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','banned')),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  "authProvisioning" boolean NOT NULL DEFAULT false,
  "authSyncPending" boolean NOT NULL DEFAULT false,
  "authSyncError" text NOT NULL DEFAULT '',
  "authSyncVersion" integer NOT NULL DEFAULT 0,
  "authSyncStartedAt" timestamptz,
  "keycloakId" text UNIQUE,
  legacy_data jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE voices (
  _id text PRIMARY KEY CHECK (_id ~ '^[0-9a-f]{24}$'),
  voice_id text NOT NULL UNIQUE, name text NOT NULL CHECK (length(btrim(name)) > 0),
  gender text NOT NULL DEFAULT 'male' CHECK (gender IN ('male','female')),
  file_path text NOT NULL, is_active boolean NOT NULL DEFAULT true,
  user_id text NOT NULL REFERENCES users(_id) ON DELETE RESTRICT,
  is_global boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz, "updatedAt" timestamptz,
  legacy_data jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX voices_owner_idx ON voices(user_id);
CREATE TABLE book_jobs (
  _id text PRIMARY KEY CHECK (_id ~ '^[0-9a-f]{24}$'),
  user_id text NOT NULL REFERENCES users(_id) ON DELETE RESTRICT,
  request_id text NOT NULL, title text NOT NULL,
  book_metadata jsonb, ai_assisted boolean NOT NULL DEFAULT true,
  source text, source_hash text NOT NULL,
  target_minutes integer NOT NULL CHECK (target_minutes IN (10,20,30)),
  voice_mode text NOT NULL CHECK (voice_mode IN ('standard','clone')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  cancel_requested boolean NOT NULL DEFAULT false,
  progress jsonb NOT NULL DEFAULT '{"phase":"queued","percent":0,"message":"Đang chờ worker."}',
  checkpoint jsonb, result jsonb, error text NOT NULL DEFAULT '',
  lease_owner text, lease_until timestamptz,
  runs integer NOT NULL DEFAULT 0, artifacts_cleaned boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  legacy_data jsonb NOT NULL DEFAULT '{}',
  UNIQUE(user_id, request_id),
  CHECK (status IN ('completed','cancelled') OR source IS NOT NULL)
);
CREATE INDEX book_jobs_owner_idx ON book_jobs(user_id,"createdAt" DESC);
CREATE INDEX book_jobs_claim_idx ON book_jobs(status,lease_until,"createdAt");
CREATE TABLE generated_lectures (
  _id text PRIMARY KEY CHECK (_id ~ '^[0-9a-f]{24}$'),
  book_job_id text UNIQUE REFERENCES book_jobs(_id) ON DELETE RESTRICT,
  user_id text REFERENCES users(_id) ON DELETE RESTRICT,
  title text, book_metadata jsonb, ai_assisted boolean,
  target_minutes integer, duration_seconds double precision, voice_mode text,
  text text NOT NULL, teacher_id text NOT NULL DEFAULT '', style_id text NOT NULL DEFAULT 'normal',
  audio_url text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  legacy_data jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX generated_lectures_owner_idx ON generated_lectures(user_id,"createdAt" DESC);
CREATE TABLE book_caches (
  _id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(_id) ON DELETE RESTRICT,
  source_hash text NOT NULL, version text NOT NULL, notes jsonb NOT NULL DEFAULT '[]',
  overview text, expires_at timestamptz NOT NULL,
  legacy_data jsonb NOT NULL DEFAULT '{}', UNIQUE(user_id,source_hash,version)
);
CREATE INDEX book_caches_expiry_idx ON book_caches(expires_at);
CREATE TABLE reading_profiles (
  _id text PRIMARY KEY, units_per_minute double precision, seconds double precision, expires_at timestamptz,
  legacy_data jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX reading_profiles_expiry_idx ON reading_profiles(expires_at);
CREATE TABLE worker_leases (
  _id text PRIMARY KEY, owner text, until timestamptz,
  legacy_data jsonb NOT NULL DEFAULT '{}'
);
-- Preserve unmapped MongoDB collections instead of silently dropping their contents.
CREATE TABLE legacy_documents (
  collection_name text NOT NULL, document_id text NOT NULL, source_ejson jsonb NOT NULL,
  PRIMARY KEY(collection_name,document_id)
);
CREATE TABLE data_migrations (
  id text PRIMARY KEY, source_digest text NOT NULL, backup_file text NOT NULL,
  counts jsonb NOT NULL, completed_at timestamptz NOT NULL DEFAULT now()
);
