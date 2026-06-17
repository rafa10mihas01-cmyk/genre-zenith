---
name: Baseline Conflict é camada oficial de integridade
description: Módulo Baseline Conflict é responsabilidade própria, ativa e oficial — não dropar, não reescopar
type: feature
---
Baseline Conflict NÃO é resquício da arquitetura antiga. É a camada oficial de integridade que consome `campaign_playlist_collections.is_baseline` (fonte de verdade definida na Fase 1.A.1).

Gerado pela trigger `public.tg_ccp_match_on_insert` em `curator_campaign_playlists` em dois cenários:
1. **Internal ecosystem ownership** — `playlist_id` existe em `managed_playlists` → curador externo não pode reivindicar entrega em playlist da casa.
2. **Campaign baseline overlap** — `playlist_id` existe em `campaign_playlist_collections` com `is_baseline=true` → música já estava ali antes da campanha começar, não conta como entrega nova.

Consequências oficiais do status `baseline_conflict`:
- `excluded_from_kpis = true` (fora de métricas de entrega)
- Bloqueio financeiro via `BaselineConflictFinancialAlert` (não pagar curador)
- Surfaced em `CampaignInventory` e `ExecucaoView` para resolução manual

Componentes oficiais (NÃO remover): `BaselineConflictsSection`, `BaselineConflictFinancialAlert`, colunas `baseline_conflict_at` / `baseline_conflict_source` em `curator_campaign_playlists`, trigger `tg_ccp_match_on_insert`, status `'baseline_conflict'` em register-curator-playlist e get-curator-deal-public.

Decidido em Fase 1.A.4 (Opção A): a palavra "conflict" aqui descreve corretamente um conflito entre reivindicação do curador e baseline da campanha — não há ambiguidade com o termo "baseline" reservado em 1.A.3, pois a responsabilidade é "detectar conflito COM a baseline", não "ser a baseline".
