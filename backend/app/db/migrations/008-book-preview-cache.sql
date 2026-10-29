-- Independent preview requests never take the book worker's queue/lease.
CREATE TABLE book_previews (
    _id text PRIMARY KEY CHECK (_id ~ '^[a-f0-9]{24}$'),
    user_id text NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
    job_id text NOT NULL REFERENCES book_jobs(_id) ON DELETE CASCADE,
    signature text NOT NULL CHECK (signature ~ '^[a-f0-9]{64}$'),
    status text NOT NULL CHECK (status IN ('processing','ready','failed','pruning')),
    owner text NOT NULL,
    lease_until timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    result jsonb,
    error text NOT NULL DEFAULT ''
);
CREATE INDEX book_previews_lookup_idx ON book_previews(job_id, signature, expires_at DESC);
CREATE INDEX book_previews_expiry_idx ON book_previews(expires_at);
