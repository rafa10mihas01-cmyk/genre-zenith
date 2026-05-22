-- 1. Tabela de subgêneros
CREATE TABLE IF NOT EXISTS public.subgenres (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_genre_id UUID NOT NULL REFERENCES public.genres(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  nome TEXT NOT NULL,
  descricao TEXT,
  palavras_chave JSONB NOT NULL DEFAULT '[]'::jsonb,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(parent_genre_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_subgenres_parent ON public.subgenres(parent_genre_id);
CREATE INDEX IF NOT EXISTS idx_subgenres_ativo ON public.subgenres(ativo) WHERE ativo = true;

ALTER TABLE public.subgenres ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_subgenres" ON public.subgenres
  FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_subgenres" ON public.subgenres
  FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_subgenres" ON public.subgenres
  FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_subgenres" ON public.subgenres
  FOR DELETE TO authenticated USING (has_team_access());

CREATE TRIGGER trg_subgenres_set_updated_at
  BEFORE UPDATE ON public.subgenres
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Extensão de search_terms (Search Terms Vivos)
ALTER TABLE public.search_terms
  ADD COLUMN IF NOT EXISTS subgenre_id UUID REFERENCES public.subgenres(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quality_score NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trend_score NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS search_velocity NUMERIC(8,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS growth_rate NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_evaluated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('emergente','ativo','saturado','morto'));

CREATE INDEX IF NOT EXISTS idx_search_terms_subgenre ON public.search_terms(subgenre_id);
CREATE INDEX IF NOT EXISTS idx_search_terms_status ON public.search_terms(status) WHERE status != 'morto';
CREATE INDEX IF NOT EXISTS idx_search_terms_quality ON public.search_terms(genre_id, quality_score DESC);

-- 3. Seed inicial de subgêneros do mercado BR
-- Funk
INSERT INTO public.subgenres (parent_genre_id, slug, nome, palavras_chave) VALUES
  ('ef75ef4d-24a0-4249-94be-5881f3a1b9ea','mandelao','Funk Mandelão','["mandelão","mandelao","montagem","beat seco"]'::jsonb),
  ('ef75ef4d-24a0-4249-94be-5881f3a1b9ea','consciente','Funk Consciente','["consciente","funk consciente","mensagem"]'::jsonb),
  ('ef75ef4d-24a0-4249-94be-5881f3a1b9ea','automotivo','Funk Automotivo','["automotivo","som automotivo","paredão","grave"]'::jsonb),
  ('ef75ef4d-24a0-4249-94be-5881f3a1b9ea','putaria','Funk Putaria','["putaria","proibidão","proibidao","18+"]'::jsonb),
  ('ef75ef4d-24a0-4249-94be-5881f3a1b9ea','rave','Rave Funk','["rave funk","ravefunk","brazilian phonk"]'::jsonb),
  ('ef75ef4d-24a0-4249-94be-5881f3a1b9ea','paulista','Beat Paulista','["beat paulista","paulista","beatbox","sp"]'::jsonb),
  ('ef75ef4d-24a0-4249-94be-5881f3a1b9ea','viral','Funk Viral','["viral","tiktok","trend","2026"]'::jsonb),
  ('ef75ef4d-24a0-4249-94be-5881f3a1b9ea','trap-funk','Trap Funk','["trap funk","funk trap","trap brasileiro"]'::jsonb)
ON CONFLICT (parent_genre_id, slug) DO NOTHING;

-- Sertanejo
INSERT INTO public.subgenres (parent_genre_id, slug, nome, palavras_chave) VALUES
  ('eaa75c4e-e37d-4070-98cd-4db8f3fba1b8','universitario','Sertanejo Universitário','["universitário","universitario","sertanejo universitário"]'::jsonb),
  ('eaa75c4e-e37d-4070-98cd-4db8f3fba1b8','raiz','Sertanejo Raiz','["raiz","sertanejo raiz","viola","caipira"]'::jsonb),
  ('eaa75c4e-e37d-4070-98cd-4db8f3fba1b8','sofrencia','Sertanejo Sofrência','["sofrência","sofrencia","sofrer","chorar"]'::jsonb),
  ('eaa75c4e-e37d-4070-98cd-4db8f3fba1b8','boiadeiro','Sertanejo Boiadeiro','["boiadeiro","modão","modao","boiadeira"]'::jsonb),
  ('eaa75c4e-e37d-4070-98cd-4db8f3fba1b8','paredao','Sertanejo de Paredão','["paredão","paredao","som automotivo"]'::jsonb),
  ('eaa75c4e-e37d-4070-98cd-4db8f3fba1b8','feminejo','Feminejo','["feminejo","sertaneja","dueto feminino"]'::jsonb)
ON CONFLICT (parent_genre_id, slug) DO NOTHING;

-- Trap
INSERT INTO public.subgenres (parent_genre_id, slug, nome, palavras_chave) VALUES
  ('4e25057e-c69a-4508-885b-5882518c2716','triste','Trap Triste','["trap triste","sad trap","melancólico"]'::jsonb),
  ('4e25057e-c69a-4508-885b-5882518c2716','melodico','Trap Melódico','["trap melódico","melodico","autotune"]'::jsonb),
  ('4e25057e-c69a-4508-885b-5882518c2716','drill','Drill BR','["drill","drill brasileiro","brazilian drill"]'::jsonb),
  ('4e25057e-c69a-4508-885b-5882518c2716','old-school','Trap Old School','["old school","clássico","trap antigo"]'::jsonb),
  ('4e25057e-c69a-4508-885b-5882518c2716','hype','Trap Hype','["hype","banger","trap hype"]'::jsonb)
ON CONFLICT (parent_genre_id, slug) DO NOTHING;

-- Pagode
INSERT INTO public.subgenres (parent_genre_id, slug, nome, palavras_chave) VALUES
  ('a2aca119-434b-4161-b8b9-98cf4c7b1f68','90','Pagode dos 90','["pagode 90","anos 90","antigo","raiz do pagode"]'::jsonb),
  ('a2aca119-434b-4161-b8b9-98cf4c7b1f68','atual','Pagode Atual','["pagode atual","2025","2026","novo pagode"]'::jsonb),
  ('a2aca119-434b-4161-b8b9-98cf4c7b1f68','romantico','Pagode Romântico','["romântico","romantico","amor","apaixonado"]'::jsonb),
  ('a2aca119-434b-4161-b8b9-98cf4c7b1f68','baiano','Pagode Baiano','["pagode baiano","bahia","arrocha"]'::jsonb)
ON CONFLICT (parent_genre_id, slug) DO NOTHING;

-- Piseiro
INSERT INTO public.subgenres (parent_genre_id, slug, nome, palavras_chave) VALUES
  ('121377cd-9f84-4275-bfca-e5813738d1bc','pe-de-serra','Piseiro Pé de Serra','["pé de serra","pe de serra","forró pé de serra"]'::jsonb),
  ('121377cd-9f84-4275-bfca-e5813738d1bc','atual','Piseiro Atual','["piseiro atual","2025","2026","novo piseiro"]'::jsonb),
  ('121377cd-9f84-4275-bfca-e5813738d1bc','vaquejada','Piseiro de Vaquejada','["vaquejada","peão","peao","arena"]'::jsonb)
ON CONFLICT (parent_genre_id, slug) DO NOTHING;

-- Forró
INSERT INTO public.subgenres (parent_genre_id, slug, nome, palavras_chave) VALUES
  ('cd0a0ff5-9720-4452-beaf-824f86b4294b','pe-de-serra','Forró Pé de Serra','["pé de serra","pe de serra","sanfona","triângulo"]'::jsonb),
  ('cd0a0ff5-9720-4452-beaf-824f86b4294b','eletronico','Forró Eletrônico','["forró eletrônico","eletronico","banda forró"]'::jsonb),
  ('cd0a0ff5-9720-4452-beaf-824f86b4294b','universitario','Forró Universitário','["universitário","universitario","forró universitário"]'::jsonb)
ON CONFLICT (parent_genre_id, slug) DO NOTHING;

-- Agro
INSERT INTO public.subgenres (parent_genre_id, slug, nome, palavras_chave) VALUES
  ('c3a247ea-f748-48f7-a473-a81182dce2f6','rave','Agro Rave','["agro rave","agrorave","rave do agro"]'::jsonb),
  ('c3a247ea-f748-48f7-a473-a81182dce2f6','boiadeiro','Agro Boiadeiro','["boiadeiro","boiadeira","modão","modao"]'::jsonb),
  ('c3a247ea-f748-48f7-a473-a81182dce2f6','peao','Música de Peão','["peão","peao","rodeio","vaquejada"]'::jsonb)
ON CONFLICT (parent_genre_id, slug) DO NOTHING;

-- Pop
INSERT INTO public.subgenres (parent_genre_id, slug, nome, palavras_chave) VALUES
  ('c88a7e28-4e7c-4be5-8b9d-ba83f263294a','br','Pop BR','["pop br","pop brasileiro","mpb"]'::jsonb),
  ('c88a7e28-4e7c-4be5-8b9d-ba83f263294a','internacional','Pop Internacional','["pop internacional","international","hits"]'::jsonb),
  ('c88a7e28-4e7c-4be5-8b9d-ba83f263294a','indie','Indie Pop','["indie","indie pop","alternative"]'::jsonb)
ON CONFLICT (parent_genre_id, slug) DO NOTHING;