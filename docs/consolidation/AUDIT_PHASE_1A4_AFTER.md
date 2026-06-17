# Fase 1.A.4 — AFTER: Decisão arquitetural (Opção A)

**Resultado:** módulo Baseline Conflict **mantido** como camada oficial de integridade. Nenhum DROP, nenhum rename, nenhum refactor de código.

## Justificativa

Auditoria BEFORE confirmou que o módulo:
1. É gerado por fluxo oficial ativo (trigger `tg_ccp_match_on_insert`, 5 ocorrências reais, última em 2026-06-16).
2. Consome exclusivamente a arquitetura oficial pós-Fase 1.A.1 (`campaign_playlist_collections.is_baseline` + `managed_playlists`).
3. Sustenta três regras de negócio ativas: exclusão de KPI, bloqueio financeiro, fila de resolução manual no Inventário/Monitoramento.
4. Não é resquício — é o consumidor primário da baseline. Sem ele, a baseline da Fase 1.A.1 perde propósito operacional.

Pela regra de consolidação (1.A.3): responsabilidade única e válida → não dropar, não renomear.

## Componentes oficializados

| Camada | Objeto |
|---|---|
| SQL | trigger `public.tg_ccp_match_on_insert`, colunas `curator_campaign_playlists.baseline_conflict_at`, `.baseline_conflict_source`, status `'baseline_conflict'` |
| Edge | `register-curator-playlist` (gate + retorno), `get-curator-deal-public` (agregação `baseline_conflicts[]`) |
| Frontend | `BaselineConflictsSection`, `BaselineConflictFinancialAlert`, branches em `CampaignInventory`, `ExecucaoView`, `CuratorPage`, `PasteUrlsDialog` |

## Memória persistida

- `mem://architecture/baseline-conflict-official` — regra permanente: não dropar, não renomear.

## Encerramento

Fase 1.A.4 **encerrada sem alteração de código**. O conceito Baseline Conflict passa a ser oficialmente parte da arquitetura consolidada da NexEngine.
