-- ============ TABLES ============
CREATE TABLE public.genres (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  ativo BOOLEAN DEFAULT true,
  total_termos INTEGER DEFAULT 0,
  total_playlists INTEGER DEFAULT 0,
  total_musicas INTEGER DEFAULT 0,
  ultima_coleta TIMESTAMPTZ,
  status TEXT DEFAULT 'pendente',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.search_terms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  genre_id UUID REFERENCES public.genres(id) ON DELETE CASCADE,
  termo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  executado BOOLEAN DEFAULT false,
  total_resultados INTEGER DEFAULT 0,
  ultima_execucao TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.search_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  genre_id UUID REFERENCES public.genres(id) ON DELETE CASCADE,
  term_id UUID REFERENCES public.search_terms(id) ON DELETE CASCADE,
  nome_playlist TEXT NOT NULL,
  posicao INTEGER NOT NULL,
  spotify_url TEXT,
  seguidores INTEGER,
  imagem_url TEXT,
  descricao TEXT,
  total_musicas INTEGER,
  apify_run_id TEXT,
  coletado_em TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.search_tracks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  genre_id UUID REFERENCES public.genres(id) ON DELETE CASCADE,
  result_id UUID REFERENCES public.search_results(id) ON DELETE CASCADE,
  nome_musica TEXT NOT NULL,
  artista TEXT NOT NULL,
  spotify_track_id TEXT,
  posicao_na_playlist INTEGER,
  coletado_em TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.genre_models (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  genre_id UUID REFERENCES public.genres(id) ON DELETE CASCADE UNIQUE,
  palavras_chave JSONB DEFAULT '[]',
  padroes_nome JSONB DEFAULT '[]',
  playlists_dominantes JSONB DEFAULT '[]',
  musicas_recorrentes JSONB DEFAULT '[]',
  insights JSONB DEFAULT '{}',
  ultima_analise TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.collection_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  genre_id UUID REFERENCES public.genres(id) ON DELETE SET NULL,
  term_id UUID REFERENCES public.search_terms(id) ON DELETE SET NULL,
  acao TEXT NOT NULL,
  status TEXT NOT NULL,
  mensagem TEXT,
  duracao_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_search_terms_genre ON public.search_terms(genre_id);
CREATE INDEX idx_search_results_genre ON public.search_results(genre_id);
CREATE INDEX idx_search_results_term ON public.search_results(term_id);
CREATE INDEX idx_search_tracks_genre ON public.search_tracks(genre_id);
CREATE INDEX idx_search_tracks_result ON public.search_tracks(result_id);
CREATE INDEX idx_collection_logs_genre ON public.collection_logs(genre_id);
CREATE INDEX idx_collection_logs_created ON public.collection_logs(created_at DESC);

-- ============ RLS ============
ALTER TABLE public.genres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.genre_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_logs ENABLE ROW LEVEL SECURITY;

-- Authenticated full access (internal team tool)
CREATE POLICY "auth_all_genres" ON public.genres FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_search_terms" ON public.search_terms FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_search_results" ON public.search_results FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_search_tracks" ON public.search_tracks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_genre_models" ON public.genre_models FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_collection_logs" ON public.collection_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============ SEED GENRES ============
INSERT INTO public.genres (nome, slug) VALUES
('funk','funk'),('sertanejo','sertanejo'),('trap','trap'),('pagode','pagode'),
('axé','axe'),('forró','forro'),('baile funk','baile-funk'),('funk carioca','funk-carioca'),
('funk ostentação','funk-ostentacao'),('funk melody','funk-melody'),('gospel','gospel'),
('samba','samba'),('MPB','mpb'),('rock nacional','rock-nacional'),('pop nacional','pop-nacional'),
('hip hop','hip-hop'),('rap nacional','rap-nacional'),('eletrônica','eletronica'),
('house','house'),('pagofunk','pagofunk'),('reggaeton','reggaeton'),('piseiro','piseiro'),
('brega funk','brega-funk'),('arrocha','arrocha'),('romântico','romantico'),('indie','indie'),
('R&B','rnb'),('reggae','reggae'),('drill','drill'),('lo-fi','lo-fi'),('phonk','phonk'),
('samba rock','samba-rock'),('pagodão','pagodao'),('forró universitário','forro-universitario'),
('forró pé de serra','forro-pe-de-serra'),('sertanejo universitário','sertanejo-universitario'),
('sertanejo raiz','sertanejo-raiz'),('funk 150 bpm','funk-150-bpm'),('funk consciente','funk-consciente'),
('tecnobrega','tecnobrega'),('bossa nova','bossa-nova'),('blues','blues'),('jazz','jazz'),
('soul','soul'),('k-pop','k-pop'),('afrobeats','afrobeats'),('amapiano','amapiano'),
('dancehall','dancehall'),('trap beat','trap-beat'),('vapo trap','vapo-trap'),
('jersey club','jersey-club'),('choro','choro'),('música gaúcha','musica-gaucha'),
('vanerão','vaneirao'),('carimbó','carimbo');