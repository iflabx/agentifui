SET search_path = public;

ALTER TABLE backend_runs
  ADD COLUMN deliverables JSONB CHECK (
    deliverables IS NULL OR (
      jsonb_typeof(deliverables) = 'object' AND
      octet_length(deliverables::text) <= 32768
    )
  );
