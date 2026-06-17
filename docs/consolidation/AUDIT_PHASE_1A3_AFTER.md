# Auditor AFTER — Fase 1.A.3

**Data:** 2026-06-17  
**Decisão aplicada:** Opção B — rename semântico, sem mudança de regra de negócio.

## Renomeações executadas

| Antes | Depois | Tabela |
|---|---|---|
| `is_baseline` | `is_initial_capture_event` | `curator_deal_logs` |
| `is_baseline` | `is_initial_roster` | `curator_playlists` |
| `enforce_curator_playlist_baseline()` | `enforce_curator_playlist_initial_roster()` | trigger function |
| `trg_enforce_curator_playlist_baseline` | `trg_enforce_curator_playlist_initial_roster` | trigger |
| `record_curator_deal_capture(... p_is_baseline ...)` | `record_curator_deal_capture(... p_is_initial_capture ...)` | RPC param |
| view `v_curator_playlists_operational.is_baseline` (alias) | `is_initial_roster` (coluna direta) | view |

## Funções SQL recriadas com nova nomenclatura
- `public.record_curator_deal_capture` (param renomeado; lê `is_initial_roster` em new_playlists; grava em `is_initial_capture_event`).
- `public.get_curator_deal_breakdown` (filtro `p.is_initial_roster = false`).
- `public.get_curator_deal_snapshot_history` (CTE `logs` usa `is_initial_capture_event`).
- `public.enforce_curator_playlist_initial_roster` (recriada; trigger BEFORE INSERT).

## Auditor BEFORE → AFTER

| Métrica | BEFORE | AFTER |
|---|---|---|
| Colunas legadas existentes (`is_baseline` nessas duas tabelas) | 2 | **0** |
| Funções SQL referenciando essas colunas com nome antigo | 4 | **0** |
| Triggers referenciando essas colunas com nome antigo | 1 | **0** |
| Edge functions referenciando essas colunas com nome antigo | 8 | **0** |
| Páginas/hooks frontend referenciando essas colunas com nome antigo | 12 | **0** |
| Componentes/libs frontend referenciando essas colunas com nome antigo | 7 | **0** |

## O que permaneceu inalterado (fora do escopo)
- `campaign_playlist_collections.is_baseline` — **fonte oficial da baseline da campanha** (preservada por design, regra oficial).
- `label_spreadsheet_uploads.is_baseline` — domínio de importação de planilha, conceito distinto.
- `deal_collected_playlists.is_baseline` — coleta automática da campanha, conceito distinto.

## Regra arquitetural (registrada em memória permanente)
> A palavra **baseline** é reservada exclusivamente para a fotografia inicial da campanha (`campaign_playlist_collections`). Qualquer outro conceito de "início" deve usar nome descritivo da sua responsabilidade real.

## Resultado funcional
- Nenhuma regra de negócio alterada.
- Nenhum cálculo alterado.
- Nenhuma mudança de comportamento esperada.
- Padronização semântica concluída.
