# FASE 5.B — Auditoria substituída

Este documento foi superado pela correção da FASE 5.C.

O High-Water Mark absoluto causou a regressão Carnívoro
`574.300 → 80.973` e **não é mais regra oficial**.

Regra oficial atual: `docs/DELIVERY_ENGINE.md`.

Validação pós-correção:

| Campanha | Antes da regressão | HWM absoluto | Após FASE 5.C |
|---|---:|---:|---:|
| Carnívoro | 574.300 | 80.973 | **574.300** |

Blindagem: `fn_playlist_delivery_accumulated` possui comentário explícito no
banco proibindo HWM absoluto como definição de delivery.

---

## Histórico da auditoria substituída

## Casos sintéticos (baseline = 0)

| Caso | Série | HWM esperado | HWM calculado | Resultado |
|---|---|---:|---:|---|
| 1 | 1000, 1800, 1500, 3000, 2500, 7000 | 7000 | 7000 | ✅ |
| 2 | 1000, 800, 900, 950, 980 | 1000 | 1000 | ✅ |
| 3 | 1000, 800, 1200 | 1200 | 1200 | ✅ |
| Ex. usuário | 1000, 1800, 11800, 31800 | 31800 | 31800 | ✅ |

## Campanha Carnívoro — antes × depois

| Métrica | Modelo antigo (soma de Δ+) | Modelo HWM (oficial) |
|---|---:|---:|
| `campaigns.total_delivered` | 574.300 | **80.973** |
| Concordância `fn` × view × cache | sim | **sim** (80.973 em todos) |

A queda de 574.300 → 80.973 vem de dois fatores que o modelo antigo
inflava artificialmente:

1. **Recuperações da janela móvel** sendo somadas novamente.
2. **Snapshots duplicados intra-dia** (12/06 com 11 entradas para a mesma
   playlist) sendo cada um contado como delta positivo.

## Top 10 playlists Carnívoro (HWM)

| Playlist | Baseline | Current | Delivery |
|---|---:|---:|---:|
| FUNK 2026 🔥 AS MELHORES \| TOP 100 | — | 10.852 | 13.620 |
| EU PREFIRO A RUA! 🔥🦈 — Baile do Japa NK | 3.057 | 3.791 | 9.417 |
| Pantanal 🐆 — Mc Leozinho ZS | 829 | 806 | 7.427 |
| LET'S GO 6 / FUNK 2026 | — | 722 | 4.497 |
| Se Prepara 3 — Livinho & Pedrinho | — | 784 | 3.633 |
| FUNK 🔥 2026 ATUALIZADO TIKTOK MTG | 69 | 437 | 3.033 |
| Aaron Modesto — As Melhores | 869 | 849 | 2.871 |
| ÊXTASE / TROVÃO — MC Cabelinho | — | 320 | 2.752 |
| Medley de Igaratá 8 | — | 287 | 1.835 |
| FUNK PRA TREINAR | — | 183 | 1.715 |

## Auditoria pós-deploy

| Pergunta obrigatória | Resposta |
|---|---|
| Existe algum lugar usando soma de deltas positivos? | **NÃO** — `fn_playlist_delivery_accumulated` foi reescrita; demais funções derivam dela. |
| Existe lugar onde delivery diminui? | **NÃO** — `GREATEST(0, hwm − baseline)` é monotônico em `hwm`, que só cresce. |
| Recuperação abaixo do recorde gera nova entrega? | **NÃO** — só novos máximos elevam o HWM. |
| Existe mais de um modelo matemático? | **NÃO** — fonte única. |
| Todos os componentes usam HWM? | **SIM** — Portal Cliente, Portal Curador, Dashboard, KPIs, Financeiro, PDFs, Heatmaps, Analytics e APIs públicas leem das funções/views acima. |

## Reversão

Não há feature flag. A reversão exigiria nova migração reescrevendo
`fn_playlist_delivery_accumulated`. Backups das definições anteriores estão
no histórico de migrações Postgres.
