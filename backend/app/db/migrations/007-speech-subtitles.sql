ALTER TABLE generated_lectures ADD COLUMN speech_config jsonb;
ALTER TABLE generated_lectures ADD COLUMN subtitle_url text;
ALTER TABLE generated_lectures ADD COLUMN subtitle_timing text
  CHECK (subtitle_timing IS NULL OR subtitle_timing = 'estimated-within-measured-segments');
