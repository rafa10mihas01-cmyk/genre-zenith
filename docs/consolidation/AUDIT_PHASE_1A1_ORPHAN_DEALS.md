# Phase 1.A.1 — Relatório Final de Deals Órfãos (sem Campaign)

**Data:** 2026-06-17
**Regra arquitetural aprovada:** *Não existe baseline sem Campaign.*
**Tabela legada a ser removida:** `public.curator_deal_baseline_playlists`

---

## Resumo executivo

| Métrica | Valor |
|---|---|
| Total de rows na tabela legada | **1.647** |
| Rows pertencentes a deal **com** Campaign (já duplicadas em `campaign_playlist_collections`) | **995** |
| Rows órfãs (deal sem Campaign ou deal deletado) | **652** |
| Deals órfãos distintos | **9** |
| — sendo existentes em `curator_deals` (campaign_id NULL) | 6 |
| — sendo deletados (deal_id sem registro) | 3 |
| Dependência da RPC oficial `get_campaign_baseline()` nessas rows | **0** (RPC faz JOIN com `campaigns` por `deal_id`) |

> A estimativa anterior (1.184 órfãos / 14 deals) foi recalculada com o snapshot atual: **652 rows / 9 deals**. Diferença explicada por consolidações intermediárias ocorridas entre as duas auditorias.

---

## Lista dos 9 deals órfãos

### A. Deals existentes em `curator_deals` com `campaign_id = NULL` (6)

| deal_id | created_at | state | curator | origem (`source`) | rows baseline |
|---|---|---|---|---|---|
| e7760185-1972-4fb9-a09a-7f942e56478e | 2026-05-07 | collecting | Igor Batista | *(null — pré-campanha)* | 80 |
| 695a6ecf-eb7d-46ad-a8fe-b05fcad2c348 | 2026-05-07 | collecting | Roninho | *(null — pré-campanha)* | 93 |
| 075baf9d-8537-44d9-ad18-e115b9bf86c0 | 2026-05-07 | collecting | Plug Music | *(null — pré-campanha)* | 23 |
| 208bef77-1459-4618-8198-40d78b337d13 | 2026-05-15 | collecting | Plug Music | *(null — pré-campanha)* | 25 |
| 93757fe7-d09b-4b15-9422-57795406d9c9 | 2026-05-16 | collecting | Igor Batista | *(null — pré-campanha)* | 66 |
| aadfef78-2591-4d1e-90ae-de515da39893 | 2026-05-16 | collecting | Roninho | *(null — pré-campanha)* | 91 |

**Origem comprovada:** todos criados pelo fluxo legado *Deal-first* (campo `source = NULL`, `origin = 'manual'`, sem `campaign_id`). Nenhum criado pelo trigger oficial `tg_campaign_shadow_deal`, que sempre preenche `campaign_id`.

### B. Rows com `deal_id` apontando para registro deletado (3)

| deal_id | rows | primeira captura | última captura |
|---|---|---|---|
| 7b957640-a15d-4c64-a53a-24fc0e00d128 | 93 | 2026-05-07 22:13 | 2026-05-07 22:16 |
| 8b3a03dd-4871-4c75-98f7-9c484e0a7ac5 | 90 | 2026-05-07 22:14 | 2026-05-07 22:16 |
| aba4ccf8-4bcc-444c-89cc-542202890a13 | 91 | 2026-06-02 02:57 | 2026-06-02 02:57 |

**Origem comprovada:** rows residuais — o deal pai já não existe (ausência de FK `ON DELETE CASCADE` no schema legado). São lixo arquitetural puro.

---

## Confirmação de ausência de Campaign

```sql
SELECT COUNT(*) FROM curator_deal_baseline_playlists cdbp
WHERE EXISTS (
  SELECT 1 FROM curator_deals cd
  WHERE cd.id = cdbp.deal_id AND cd.campaign_id IS NOT NULL
);
-- Resultado: 995 rows COM campaign (todas já replicadas em campaign_playlist_collections)

SELECT COUNT(*) FROM curator_deal_baseline_playlists cdbp
WHERE NOT EXISTS (
  SELECT 1 FROM curator_deals cd
  WHERE cd.id = cdbp.deal_id AND cd.campaign_id IS NOT NULL
);
-- Resultado: 652 rows SEM campaign → órfãs
```

Nenhum dos 9 deals órfãos possui linha em `campaigns` referenciando-o, confirmado por:

```sql
SELECT COUNT(*) FROM campaigns c
WHERE c.id IN (
  SELECT DISTINCT cd.campaign_id FROM curator_deals cd
  WHERE cd.id = ANY(ARRAY[
    'e7760185-...', '695a6ecf-...', '075baf9d-...',
    '208bef77-...', '93757fe7-...', 'aadfef78-...'
  ]::uuid[])
);
-- Resultado: 0
```

---

## Confirmação de não-uso pela RPC oficial

A função `public.get_campaign_baseline(p_campaign_id uuid, ...)` ignora estruturalmente as rows órfãs porque o ramo de fallback faz:

```sql
FROM curator_deal_baseline_playlists cdbp
JOIN curator_deals cd  ON cd.id = cdbp.deal_id
JOIN campaigns c       ON c.id = cd.campaign_id   -- ⛔ exclui órfãs
WHERE c.id = p_campaign_id
```

Logo, **nenhuma das 652 rows órfãs é alcançável** por nenhum consumidor que use a RPC oficial — que é o único ponto de leitura permitido a partir da Fase 1.A.0.

---

## Decisão arquitetural registrada

> **Aprovado pelo usuário em 2026-06-17.**
> Fluxo oficial: `Campaign → Baseline → Aprovação → Deal`.
> Fluxo legado *Deal → Baseline → Campaign* é **descontinuado**.
> As 652 rows / 9 deals listados acima serão **descartados** no DROP da tabela, sem migração, ao fim da Fase 1.A.1.

---

## Próximos passos da Fase 1.A.1

1. ✅ Relatório de órfãos (este arquivo)
2. ⏳ Refatorar writers (`bot-ingest-snapshot`, `ingest-dom`, `extract-snapshot-from-print` e funções SQL relacionadas) para escrever em `campaign_playlist_collections` **somente quando o deal possui `campaign_id`**; caso contrário, *skip* com log estruturado `baseline_skipped_no_campaign`.
3. ⏳ Diff funcional (mesma campanha ↔ mesma baseline antes/depois).
4. ⏳ Auditor AFTER.
5. ⏳ Se `AFTER = 0` → `DROP TABLE public.curator_deal_baseline_playlists` definitivo, sem compatibilidade.
