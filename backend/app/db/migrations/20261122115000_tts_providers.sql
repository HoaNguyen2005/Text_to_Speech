CREATE TABLE IF NOT EXISTS tts_providers (
  _id text PRIMARY KEY CHECK (_id ~ '^[0-9a-f]{24}$'),
  provider_id text NOT NULL UNIQUE CHECK (provider_id IN ('edge','vieneu')),
  name text NOT NULL CHECK (length(btrim(name)) > 0 AND length(name) <= 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  engine_label text NOT NULL DEFAULT '' CHECK (length(engine_label) <= 120),
  model_revision text NOT NULL DEFAULT '' CHECK (length(model_revision) <= 160),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tts_providers ENABLE ROW LEVEL SECURITY;

INSERT INTO tts_providers (_id, provider_id, name, description, engine_label, model_revision, is_active, sort_order)
VALUES
  (
    '00000000000000000000ed6e',
    'edge',
    'Edge-TTS + OpenVoice',
    'Tổng hợp giọng đọc tiếng Việt tốc độ cao kết hợp chuyển đổi âm sắc OpenVoice V2.',
    'Microsoft Neural + OpenVoice V2',
    'openvoice-v2',
    true,
    1
  ),
  (
    '00000000000000000071e9e0',
    'vieneu',
    'VieNeu-TTS',
    'Mô hình tổng hợp và nhân bản giọng đọc tiếng Việt tự nhiên VieNeu v3 Turbo.',
    'VieNeu v3 Turbo',
    'vieneu-3.8.3-v3turbo-61b85e3d937fbbacb387714180e8182823512523',
    true,
    2
  )
ON CONFLICT (provider_id) DO NOTHING;
