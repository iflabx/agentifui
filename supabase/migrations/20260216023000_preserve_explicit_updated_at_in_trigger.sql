-- Preserve explicit updated_at values during controlled data sync operations.
-- For regular application updates (where updated_at is left unchanged), keep
-- the existing behavior and stamp updated_at to now().
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    RETURN NEW;
  END IF;

  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
