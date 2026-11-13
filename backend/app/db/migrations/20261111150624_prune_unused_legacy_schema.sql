SET LOCAL lock_timeout = '5s';
-- Abort instead of discarding legacy contents on a different installation.
DO $$
DECLARE name text; populated boolean;
BEGIN
  FOREACH name IN ARRAY ARRAY['users','voices','book_jobs','generated_lectures','book_caches','reading_profiles'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=name AND column_name='legacy_data') THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE legacy_data IS NOT NULL AND legacy_data <> ''{}''::jsonb)', name) INTO populated;
      IF populated THEN RAISE EXCEPTION 'Back up and review %.legacy_data before removing it', name; END IF;
      EXECUTE format('ALTER TABLE public.%I DROP COLUMN legacy_data', name);
    END IF;
  END LOOP;
  IF to_regclass('public.legacy_documents') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.legacy_documents) THEN RAISE EXCEPTION 'legacy_documents contains data; archive it first'; END IF;
    DROP TABLE public.legacy_documents;
  END IF;
END $$;
-- Older workers compare this value through JavaScript Date (millisecond precision).
ALTER TABLE public.book_jobs ALTER COLUMN "updatedAt" TYPE timestamptz(3);
-- All preview access goes through the backend's authenticated owner checks.
ALTER TABLE public.book_previews ENABLE ROW LEVEL SECURITY;
