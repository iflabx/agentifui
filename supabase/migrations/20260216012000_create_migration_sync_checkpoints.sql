-- M7 incremental migration checkpoint state
CREATE TABLE IF NOT EXISTS public.migration_sync_checkpoints (
  pipeline_name text NOT NULL,
  table_name text NOT NULL,
  watermark_column text NOT NULL,
  last_watermark timestamp with time zone,
  last_primary_key text,
  rows_processed bigint NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (pipeline_name, table_name)
);

CREATE INDEX IF NOT EXISTS idx_migration_sync_checkpoints_table_name
  ON public.migration_sync_checkpoints(table_name);
