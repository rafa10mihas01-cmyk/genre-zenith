ALTER TABLE public.spotify_apps ALTER COLUMN max_accounts SET DEFAULT 5;
UPDATE public.spotify_apps SET max_accounts = 5 WHERE max_accounts = 25;