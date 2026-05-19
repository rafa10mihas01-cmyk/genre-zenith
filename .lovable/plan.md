# Fase 2 — Aprendizado SEO (experimentos editoriais com memória)

**Princípio**: continua aditivo. Nenhuma playlist é alterada sem aprovação humana explícita. O sistema só **sugere**, **mede** e **aprende**. Quem aplica é o operador (ou auto-apply opt-in por playlist no futuro).

---

## Conceito

Para cada playlist em `lifecycle_stage IN ('testing','mature')`, a NexEngine propõe **1 micro-mudança por ciclo** (título OU descrição, nunca ambos). Aplica, mede crescimento real por N dias, calcula delta vs baseline, e grava como "experimento". O cérebro do nicho agrega resultados de todos os experimentos da família e aprende padrões reais — não opinião.

```
playlist madura → sugestão → aprovação humana → aplica via Spotify →
mede 14d → delta vs baseline → grava resultado → cérebro do nicho aprende
```

---

## Banco (1 migration, só ADD)

```sql
-- 1) Experimentos individuais por playlist
CREATE TABLE public.playlist_seo_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES managed_playlists(id) ON DELETE CASCADE,
  genre_id uuid REFERENCES genres(id),
  field text NOT NULL CHECK (field IN ('name','description')),
  version_before text NOT NULL,
  version_after text NOT NULL,
  reasoning text,
  suggestion_source text NOT NULL DEFAULT 'ai',
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','active','completed','rolled_back','rejected')),
  baseline_followers bigint,
  baseline_at timestamptz,
  applied_at timestamptz,
  measure_due_at timestamptz,        -- applied_at + 14d
  measured_followers bigint,
  measured_at timestamptz,
  delta_followers bigint,
  delta_pct numeric,
  outcome text CHECK (outcome IN ('positive','neutral','negative')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_seo_exp_playlist ON playlist_seo_experiments(playlist_id);
CREATE INDEX idx_seo_exp_status ON playlist_seo_experiments(status) WHERE status IN ('proposed','active');
CREATE INDEX idx_seo_exp_genre_outcome ON playlist_seo_experiments(genre_id, outcome) WHERE outcome IS NOT NULL;

-- RLS team-only
ALTER TABLE playlist_seo_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_all" ON playlist_seo_experiments TO authenticated
  USING (has_team_access()) WITH CHECK (has_team_access());

-- 2) Lições agregadas por nicho (cérebro aprendido)
CREATE TABLE public.seo_genre_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id uuid NOT NULL REFERENCES genres(id),
  pattern_key text NOT NULL,           -- ex: "emoji_in_title", "keyword_TOP_in_funk"
  pattern_label text NOT NULL,         -- legível
  field text NOT NULL CHECK (field IN ('name','description')),
  samples_count integer NOT NULL DEFAULT 0,
  positive_count integer NOT NULL DEFAULT 0,
  neutral_count integer NOT NULL DEFAULT 0,
  negative_count integer NOT NULL DEFAULT 0,
  avg_delta_pct numeric,
  confidence numeric,                  -- 0..1 baseado em samples
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (genre_id, pattern_key)
);

ALTER TABLE seo_genre_lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_read" ON seo_genre_lessons FOR SELECT TO authenticated USING (has_team_access());
```

**Frequência de experimento por playlist**: 1 a cada 14 dias mínimo (evita ruído). Controlado em runtime — sem cron novo por enquanto.

---

## Edge functions (3 novas)

### `seo-experiment-suggest`
- Input: `{ playlist_id }`
- Verifica `lifecycle_stage != 'onboarding'` e que não há experimento `active` em andamento
- Verifica último experimento completed >= 14d atrás
- Consulta `seo_genre_lessons` do nicho pra escolher padrão com maior `avg_delta_pct` ainda não testado nessa playlist
- Chama Lovable AI Gateway pra gerar `version_after` aplicando o padrão
- Cria registro com `status='proposed'`
- Output: experiment row

### `seo-experiment-apply`
- Input: `{ experiment_id }`
- Captura `baseline_followers` no momento (do `managed_playlists` ou via Spotify)
- Chama Spotify Web API `PUT /v1/playlists/{id}` mudando só o field do experimento
- Marca `status='active'`, `applied_at=now()`, `measure_due_at=now()+14d`
- Output: ok

### `seo-experiment-measure`
- Sem input (varre todos `status='active' AND measure_due_at <= now()`)
- Pra cada um: lê followers atuais (via `sync-managed-playlists` que já roda), calcula `delta_followers`, `delta_pct`
- `outcome`: positive se `delta_pct >= +2%`, negative se `<= -2%`, neutral entre
- Marca `status='completed'`
- Atualiza `seo_genre_lessons` (recalcula contagens e `avg_delta_pct` do `pattern_key` correspondente)
- Cron 1×/dia às 04:30

---

## Frontend (3 adições)

### `<SeoExperimentCard />` — nova aba "SEO" no PlaylistCockpit
Mostra:
- Experimento ativo (se houver): título antes/depois + dias restantes pra medir
- Próxima sugestão (botão "Gerar sugestão" → `seo-experiment-suggest`)
- Histórico dos últimos 5 experimentos com badges de outcome
- Botão "Aplicar agora" (chama `seo-experiment-apply`, com confirmação)

Só renderiza se `lifecycle_stage !== 'onboarding'`.

### Aba "Aprendizado SEO" em `/sistema`
- Tabela de `seo_genre_lessons` agrupada por nicho
- Mostra: padrão, samples, % positivo, avg delta, confidence
- Filtro por gênero

### Hook `useSeoExperiments(managedId)` + `useSeoLessons(genreId)`

---

## Cron

```sql
SELECT cron.schedule(
  'seo-experiment-measure-daily',
  '30 4 * * *',
  $$ SELECT net.http_post(
    url:='<URL>/functions/v1/seo-experiment-measure',
    headers:='{"x-cron-secret":"<SECRET>","Content-Type":"application/json"}'::jsonb,
    body:='{}'::jsonb
  ); $$
);
```

---

## Garantias de não-quebra

- Playlists em `onboarding` ficam fora — usam Fase 1
- Nenhuma mudança automática no Spotify sem operador clicar em "Aplicar"
- Spotify API só é chamada via `seo-experiment-apply` com `experiment_id` válido
- Se Spotify falhar, o experimento volta pra `status='rejected'` com motivo
- `sync-managed-playlists` continua igual — só ganha leitura adicional
- Nenhuma tabela existente muda

---

## Sequência de implementação

1. Migration: 2 tabelas + indexes + RLS
2. Edge function `seo-experiment-suggest` (com Lovable AI)
3. Edge function `seo-experiment-apply` (Spotify API)
4. Edge function `seo-experiment-measure` + cron diário
5. Hook `useSeoExperiments`
6. Aba "SEO" no `PlaylistCockpit`
7. Aba "Aprendizado SEO" em `/sistema`

**Fora do escopo**: auto-apply sem aprovação, A/B test simultâneo no mesmo nicho, rollback automático (operador faz manual por enquanto).

Posso executar?
