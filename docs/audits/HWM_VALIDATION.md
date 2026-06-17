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

## Histórico removido

O conteúdo original desta auditoria mantinha HWM como oficial. Ele foi removido
para não induzir novas alterações erradas. O histórico técnico permanece no
controle de versões/migrações, mas a regra válida é somente a FASE 5.C.
