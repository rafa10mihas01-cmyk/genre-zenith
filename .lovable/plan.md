# Fase 1 — Onboarding Inteligente de Playlists

**Princípio**: 100% aditivo. Nada do que já existe muda de comportamento. Tudo que for novo entra como camada extra, com fallback seguro (se a coluna/campo não existir, sistema continua igual).

---

## O que muda (resumo de uma linha)

Toda playlist nova nasce em `lifecycle_stage = 'onboarding'`, roda diagnóstico automático, mostra checklist de padronização no cockpit e **avisa** (não bloqueia, só avisa) quando alguém tenta vincular ela a um deal/campanha antes de estar "pronta".

---

## Mudanças por camada

### 1. Banco (1 migration, só ADD — zero DROP, zero ALTER destrutivo)

```sql
-- managed_playlists ganha o ciclo de vida
ALTER TABLE managed_playlists
  ADD COLUMN IF NOT EXISTS lifecycle_stage text 
    NOT NULL DEFAULT 'onboarding'
    CHECK (lifecycle_stage IN ('onboarding','testing','mature')),
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_checklist jsonb DEFAULT '{}'::jsonb;

-- Playlists antigas (já existentes) entram direto como 'mature'
-- para NÃO disparar onboarding retroativo e poluir alertas.
UPDATE managed_playlists 
SET lifecycle_stage = 'mature', onboarding_completed_at = now()
WHERE created_at < now() - interval '7 days';

-- Trigger: toda inserção nova dispara diagnose-managed-playlist
CREATE OR REPLACE FUNCTION trg_managed_playlist_onboarding()
RETURNS trigger AS $$
BEGIN
  PERFORM net.http_post(
    url := '<SUPABASE_URL>/functions/v1/diagnose-managed-playlist',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_KEY>'),
    body := jsonb_build_object('playlist_id', NEW.id, 'source', 'onboarding_trigger')
  );
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER managed_playlist_onboarding
AFTER INSERT ON managed_playlists
FOR EACH ROW EXECUTE FUNCTION trg_managed_playlist_onboarding();
```

**Segurança**: o trigger só dispara em INSERT novo. Nada do que já está em produção é afetado.

### 2. Edge function nova: `playlist-onboarding-check`

Calcula o checklist comparando a playlist com **benchmark do nicho** (média de `tracks_count`, padrão de nome, presença de descrição, capa). Roda:
- automático após `diagnose-managed-playlist` terminar
- manual via botão "Reavaliar onboarding"

Output: grava `onboarding_checklist` em `managed_playlists`:
```json
{
  "name_pattern_ok": true,
  "description_ok": false,
  "min_tracks_ok": true,
  "cover_format_ok": true,
  "niche_alignment_score": 0.72,
  "blocking_issues": ["description_empty"],
  "ready_for_deals": false
}
```

Quando `ready_for_deals = true` por 3 checagens seguidas → marca `lifecycle_stage = 'testing'` automaticamente.

### 3. Frontend (aditivo — telas existentes não mudam)

**`PlaylistCockpit.tsx`** — adicionar card `<OnboardingChecklist />` no topo, **só renderiza** se `lifecycle_stage === 'onboarding'`. Em `mature` o card simplesmente não aparece — cockpit fica idêntico ao de hoje.

**`NewDealDialog.tsx` / `ImportFromLibraryDialog.tsx`** — quando o usuário seleciona uma playlist com `ready_for_deals = false`, mostrar banner amarelo:
> "Esta playlist ainda está em onboarding (descrição vazia). Você pode prosseguir, mas o desempenho pode ser comprometido."

Botão **não fica desabilitado** — só avisa. Zero risco de quebrar fluxo existente.

**`Operacao.tsx` (aba Playlists)** — adicionar badge `Onboarding` ao lado do nome. Filtro opcional "Em onboarding" no topo.

### 4. Cockpit Home — novo card discreto

`<PlaylistsInOnboardingCard />` na home: "3 playlists em onboarding · 2 prontas para deals". Aditivo, não substitui nada.

---

## O que NÃO vai mudar (garantia de não-quebra)

- `playlist_brain` continua calculando igual
- `diagnose-managed-playlist` mantém assinatura atual (só passa a ser chamado também pelo trigger)
- Nenhuma playlist atual entra em onboarding (todas viram `mature` no backfill)
- Nenhum bloqueio duro: o sistema **avisa**, nunca trava o operador
- Nenhuma tabela existente perde coluna ou muda tipo
- Nenhum cron existente é alterado

---

## Sequência de implementação (1 sessão)

1. Migration: adicionar colunas + backfill `mature` para tudo que já existe
2. Trigger `AFTER INSERT` apontando para `diagnose-managed-playlist`
3. Edge function `playlist-onboarding-check` (compara com benchmark do nicho)
4. Hook `usePlaylistOnboarding(managedId)`
5. Componente `<OnboardingChecklist />` no cockpit (só renderiza em stage `onboarding`)
6. Banner de aviso em `NewDealDialog`
7. Badge "Onboarding" na lista de playlists

**Fora do escopo (Fase 2/3)**: experimentos SEO, tabela `playlist_seo_experiments`, ciclos de maturidade. Só depois que Fase 1 estiver rodando há ≥2 semanas com dados reais.

---

## Critério de "pronto"

- Cadastrar playlist nova → em <30s aparece checklist no cockpit
- Playlist antiga abrir cockpit → idêntico a hoje (sem checklist)
- Tentar criar deal com playlist em onboarding → aparece aviso, mas deal pode ser criado
- Após 3 checagens com `ready_for_deals=true` → vira `mature` sozinha

Quer que eu execute essa Fase 1 agora?
