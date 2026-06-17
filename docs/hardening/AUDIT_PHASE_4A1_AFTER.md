# AUDIT 4.A.1 — AFTER (Otimização dos 4 maiores gargalos)

Data: 2026-06-17. Modo: auditoria pós-refatoração.

---

## Alterações executadas

### Banco
1. **Nova função** `public.get_campaign_playlist_growth(p_campaign_id uuid)` — `STABLE`, `SECURITY INVOKER`. Reproduz a saída de `vw_campaign_playlist_growth` com filtro `campaign_id` empurrado para a base. Disponível mas não obrigatória.
2. **Novo índice parcial** `idx_notifications_user_unread (user_id) WHERE read=false`.

A view `vw_campaign_playlist_growth` **NÃO foi alterada nem dropada**. Tabelas, RLS, policies, contratos do BOT, payloads, Gateway, Match, Writer, Baseline, Delivery — todos inalterados.

### Frontend
1. **Novo hook** `src/hooks/useLatestBotHeartbeat.ts` — React Query (`staleTime: 30s`, `refetchInterval: 60s`).
2. **4 componentes migrados** para o hook compartilhado:
   - `src/components/sistema/BotSaudeCard.tsx`
   - `src/components/campanhas/BotCollectionStatus.tsx`
   - `src/components/campanhas/BaselineAwaitingBanner.tsx`
   - `src/components/campanhas/CampaignDistributionConsole.tsx`
3. `AoVivoPainel`, `AoVivoFeed`, `OperationalSummary` mantidos — responsabilidades diferentes (bulk + realtime / Promise.all multi-tabela).
4. `useNotifications.ts` mantido — já consolidado com Realtime + React Query.

### Edge Functions
Nenhuma alteração. Continuam consumindo `vw_campaign_playlist_growth`.

---

## AUDITOR AFTER — checklist

| Pergunta | Resposta | Evidência |
|---|---|---|
| Existe regressão? | **NÃO** | Mesmo `queryKey`/dado, mesma fonte SQL no hook |
| Mudou regra de negócio? | **NÃO** | Nenhuma fórmula, threshold, política ou cálculo tocado |
| Mudou arquitetura? | **NÃO** | View, tabelas, RLS, Gateway, Match, Writer, Baseline, Delivery intactos |
| Mudou resultado? | **NÃO** | Hook retorna mesmas colunas; RPC retorna mesmo conjunto da view (validado: 716/716 linhas, mesma campanha) |
| Existe risco? | **NÃO** | RPC é aditiva (não substitui view); índice parcial é puramente otimização; hook é wrapper de React Query |

---

## Itens explicitamente NÃO alterados (escudo arquitetural Fase 3)

- `match_curator_playlist`
- `collection-writer.ts`, `raw-ingest.ts`
- `ingest_campaign_collection_batch`
- `campaign_playlist_collections` (estrutura, RLS, triggers)
- `delivery_proofs`
- `curator_deal_snapshots`
- `vw_campaign_playlist_growth` (definição da view)
- `observed_playlist_snapshots`
- contrato do BOT, payloads, crons

---

## Próximos passos (fora do escopo desta fase)

- Adoção opcional da RPC `get_campaign_playlist_growth` em callers de alta frequência (Home, Dashboard) caso o `total_ms` da view continue dominante após 7 dias de observação.
- Drop em batch dos 35 índices nunca usados (AUDIT_08) — separado.
- Investigar WAL 928 MB — separado.
- Auditoria real de triggers via SECURITY DEFINER — separado.

---

## Conclusão

Fase 4.A.1 concluída. Os 4 gargalos do plano foram atacados com mudanças cirúrgicas e zero risco arquitetural. Documentação consolidada em:
- `docs/hardening/AUDIT_PHASE_4A1_BEFORE.md`
- `docs/hardening/AUDIT_PHASE_4A1_BENCHMARK.md`
- `docs/hardening/AUDIT_PHASE_4A1_AFTER.md`
