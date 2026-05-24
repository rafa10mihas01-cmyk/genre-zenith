ALTER TABLE public.label_spreadsheet_uploads
ADD COLUMN IF NOT EXISTS is_baseline boolean NOT NULL DEFAULT false;