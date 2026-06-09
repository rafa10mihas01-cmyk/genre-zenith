
# Proposta técnica — Prioridade absoluta para playlists livres

Regra simples, sem score, sem penalidade, sem fórmula. Só ordem de consumo: **livres primeiro, ocupadas só se sobrar meta**.

---

## 1. A nova lógica em 4 passos

Ao montar (ou replanejar) um plano:

1. **Listar elegíveis** — mesmo conjunto de hoje (managed_playlists do gênero/afinidade, ativas, sem cooldown).

2. **Particionar em Grupo A e Grupo B**, olhando a janela `[started_at, started_at + days]` da campanha alvo:

   - **Grupo A (livres):** playlist NÃO está em nenhuma campanha ativa concorrente E NÃO está em nenhum curator deal ativo concorrente cuja janela intersecta.
   - **Grupo B (ocupadas):** está em pelo menos uma das duas situações acima.

3. **Consumir Grupo A primeiro**, ordenado pelo score/fit que já existe hoje, até atingir a meta de streams da campanha.

4. **Só se Grupo A não bastar**, começar a usar Grupo B — ordenado pela **menor ocupação atual** (soma de streams já reservados por outras campanhas + deals, ascendente). Para o assim que a meta for atingida.

Nada mais muda: score, fit, capacidade por posição, dispatch, tudo igual.

## 2. Como o planner enxerga "ocupada"

Único acréscimo de leitura — passa a consultar **duas fontes** ao classificar a playlist (hoje só consulta a primeira):

```
ocupada = EXISTS (
  campaign_eco_allocations  → camp.status IN ('active','approved')
                              AND alloc.status IN ('pending','approved','dispatched')
                              AND janela sobrepõe
) OR EXISTS (
  curator_playlists JOIN curator_deals
                              → deal.state IN ('active','collecting')
                              AND deal.closed_at IS NULL
                              AND janela sobrepõe
)
```

Tudo via `mp.spotify_playlist_id ↔ cp.spotify_playlist_id` (mesmo mapping da auditoria).

## 3. Simulação real — Carnívoro × Toma Botadão

Dados do banco hoje:

| Item | Valor |
|---|---:|
| Meta de streams Carnívoro | **1.925.944** |
| Inventário do gênero | 646 playlists |
| Playlists ocupadas (camp ativa ou deal ativo) | 69 |
| **Grupo A — livres no gênero** | **577 playlists** |
| Capacidade teórica do Grupo A na janela de 30d | **~4.076.071 streams (2,1× a meta)** |

Conclusão: **Grupo A sozinho cobre 100% da meta com folga.** Grupo B nem precisa ser tocado.

| Métrica | Plano atual | Plano com nova regra |
|---|---:|---:|
| Playlists no plano | 24 | 24 |
| Playlists reusadas de Toma Botadão | **20** | **0** |
| Playlists com curator deal ativo (música ≠) | **13** | **0** |
| Playlists novas (do inventário livre) | 4 | **24** |
| Ocupação média | ~360% | ≤ 100% |
| Ocupação máxima (pior) | 671% | ≤ 100% |
| Meta atingida | sim | sim |

→ **20 playlists deixariam de ser reutilizadas.** **20 playlists novas entrariam** no plano (vindas das 577 livres).

## 4. Onde mexe no código (sem implementar)

- `supabase/functions/_shared/eco-budget.ts` — expandir pra também ler `curator_playlists + curator_deals` (hoje só lê `campaign_eco_allocations`). Retornar `Set<playlist_id>` de ocupadas + mapa `playlist_id → reserved_total` (pra ordenar Grupo B).
- `supabase/functions/_shared/computeEcoPlan.ts` — em `distributeByDailyNeed`, antes do loop de seleção, **particionar** o array de candidatas em `groupA` e `groupB`. Concatenar `[...groupA_sortedByScore, ...groupB_sortedByOccupancyAsc]`. Resto do algoritmo intacto.
- `supabase/functions/approve-campaign-plan/index.ts` + `replan-campaign-eco/index.ts` — nada a alterar além de passar `started_at` e `days` (já passam).
- `system_flags`: nova chave `planner_free_first_enabled` (default `true`). Desligar volta ao comportamento atual sem deploy.
- `campaign_plan_history.meta` — logar `{group_a_used, group_b_used, group_a_available}` pra auditoria visível no histórico do plano.

**Não muda:** score, fit, fórmula de capacidade, posições, engine de dispatch, UI.

**Rollback:** flag off em `system_flags`.

**Casos extremos previstos:**
- Gênero estreito onde Grupo A < meta: loga warning, completa do Grupo B pela menor ocupação. Nunca bloqueia a campanha.
- Replanejamento de campanha já ativa: playlists já dispatched dela mesma não entram em nenhum grupo (ficam fixas, como hoje).
