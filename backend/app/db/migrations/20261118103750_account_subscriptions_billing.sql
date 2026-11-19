SET LOCAL lock_timeout = '5s';
ALTER TABLE users ADD COLUMN subscription_expires_at timestamptz;
ALTER TABLE users ADD COLUMN subscription_cycle text CHECK (subscription_cycle IN ('monthly','yearly','manual'));

CREATE TABLE account_usage_daily (
  user_id text NOT NULL REFERENCES users(_id) ON DELETE RESTRICT,
  usage_date date NOT NULL,
  lectures integer NOT NULL DEFAULT 0 CHECK (lectures >= 0),
  books integer NOT NULL DEFAULT 0 CHECK (books >= 0),
  previews integer NOT NULL DEFAULT 0 CHECK (previews >= 0),
  PRIMARY KEY (user_id, usage_date)
);
-- Counters survive deletion of history and discarded books.
INSERT INTO account_usage_daily (user_id,usage_date,lectures,books)
SELECT user_id,day,sum(lectures),sum(books) FROM (
  SELECT user_id,("createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,count(*)::int AS lectures,0 AS books
  FROM generated_lectures WHERE book_job_id IS NULL AND user_id IS NOT NULL AND "createdAt" IS NOT NULL GROUP BY user_id,day
  UNION ALL
  SELECT user_id,("createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,0,count(*)::int
  FROM book_job_requests WHERE "createdAt" IS NOT NULL GROUP BY user_id,day
) AS usage GROUP BY user_id,day;

CREATE TABLE payment_orders (
  _id text PRIMARY KEY CHECK (_id ~ '^[0-9a-f]{24}$'),
  user_id text NOT NULL REFERENCES users(_id) ON DELETE RESTRICT,
  payment_code text NOT NULL UNIQUE CHECK (payment_code ~ '^TTS[0-9A-F]{8}$'),
  plan_class text NOT NULL CHECK (plan_class IN ('gold','diamond')),
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  duration_days integer NOT NULL CHECK ((billing_cycle='monthly' AND duration_days=30) OR (billing_cycle='yearly' AND duration_days=365)),
  amount_vnd integer NOT NULL CHECK (amount_vnd > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','cancelled','review_required')),
  bank_details jsonb NOT NULL,
  sepay_transaction_id text UNIQUE,
  bank_reference_code text NOT NULL DEFAULT '',
  paid_amount_vnd bigint CHECK (paid_amount_vnd >= 0),
  gateway_payload jsonb NOT NULL DEFAULT '{}',
  paid_at timestamptz,
  expires_at timestamptz NOT NULL,
  last_checked_at timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > "createdAt"),
  CHECK (status <> 'paid' OR (sepay_transaction_id IS NOT NULL AND paid_at IS NOT NULL AND paid_amount_vnd >= amount_vnd))
);
CREATE INDEX payment_orders_user_idx ON payment_orders(user_id,"createdAt" DESC);
CREATE INDEX payment_orders_pending_idx ON payment_orders(expires_at) WHERE status='pending';
ALTER TABLE account_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_usage_daily,payment_orders FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON account_usage_daily,payment_orders FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON account_usage_daily,payment_orders FROM authenticated; END IF;
END $$;
