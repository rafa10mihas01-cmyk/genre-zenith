
CREATE TABLE public.clients (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  contact text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own clients" ON public.clients
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own clients" ON public.clients
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own clients" ON public.clients
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own clients" ON public.clients
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.curator_deal_songs
  ADD COLUMN client_id uuid,
  ADD COLUMN smartlink_url text,
  ADD COLUMN client_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(12), 'hex');

CREATE UNIQUE INDEX curator_deal_songs_client_token_key
  ON public.curator_deal_songs (client_token);

CREATE INDEX curator_deal_songs_client_id_idx
  ON public.curator_deal_songs (client_id);
