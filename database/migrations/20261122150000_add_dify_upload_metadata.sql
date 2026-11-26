SET search_path = public;

ALTER TABLE dify_upload_access
  ADD COLUMN file_name TEXT,
  ADD COLUMN byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
  ADD COLUMN mime_type TEXT;
