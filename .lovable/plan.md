
# Fase 1 — Desligar Execução (autopilot + CO Apify)

Objetivo: parar TODA execução automática do pipeline de criação/replicação/CO de pesquisa Apify, mantendo o código intacto e reversível. Nada é deletado nesta fase — só desativado e instrumentado para detectar quem ainda chama.

Duração sugerida em produção: 5–7 dias de observação antes da Fase 2.

---

## 1.1 Inventário do que está ATIVO hoje

Varredura no `cron.job` confirmou que destes 7 alvos só 1 ainda existe como cron ativo:

| Alvo pedido pelo usuário | Status atual no cron | Ação Fase 1 |
|---|---|---|
| `genre-autopilot` | sem cron (rodava manual via botão) | desligar gatilho de UI |
| `autopilot-all-genres` | sem cron | desligar gatilho de UI |
| `auto-replicate-playlists` | sem cron | desligar gatilho de UI |
| `collect-batch` | sem cron direto | desligar gatilho de UI |
| `daily-collect` | sem cron | desligar gatilho de UI |
| `genre-backfill` | sem cron | desligar gatilho de UI |
| `cron-backfill-dead` | **ativo** — `backfill-dead-genres-6h` (jobid 19, `17 */6 * * *`) | UNSCHEDULE |

Cron adicionais suspeitos detectados que entram no escopo da Fase 1:
- `learning-loop-daily` (jobid 8, `0 4 * * *`) → alimenta o CO Apify. UNSCHEDULE.
- `recover-stuck-auto-collect` (jobid 28, `*/5 * * * *`) → watchdog do pipeline de auto-coleta. UNSCHEDULE.

Cron que NÃO entram nesta fase (permanecem ativos): `daily-sync-managed-playlists`, `diagnose-managed-playlists-daily`, `execution-planner-every-minute`, `genre-benchmarks-calc-daily`, `playlist-brain-daily`, `curator-brain-calc-daily`, `track-playlist-metrics-6h`, `track-external-metrics-daily`, `recalc-playlist-scores-daily`, `recalc-campaign-progress-daily`, `reconcile-*`, `recover-print-batches-5min`, `reset-stuck-bot-songs`, `spotify-token-watchdog-10min`, `ops-alerts-cron-every-5min`, `process-email-queue`, e todos os `cleanup-*`. Esses sustentam gestão de playlists, deals, analytics e bot S4A.

---

## 1.2 Ordem de execução (do mais seguro ao mais sensível)

```text
Passo 1  → Instrumentar telemetria (não desliga nada)
Passo 2  → Desligar gatilhos de UI (botões)
Passo 3  → Bloquear no servidor (kill-switch nas edge functions alvo)
Passo 4  → UNSCHEDULE dos 3 crons (cron-backfill-dead, learning-loop, recover-stuck-auto-collect)
Passo 5  → Bloquear enqueue de jobs relacionados (jobs_queue / collection_logs)
Passo 6  → Janela de observação 5–7 dias
```

A ordem importa: instrumentação antes do bloqueio garante que vamos ver QUEM ainda chama no momento em que começamos a recusar.

---

## 1.3 Passo 1 — Telemetria (detector de dependências ocultas)

Criar tabela leve para registrar toda invocação dos alvos durante a janela de observação:

- Tabela `deprecation_hits` com colunas: function_name, source (`ui` | `cron` | `internal` | `unknown`), caller_user_id, request_headers (JSONB resumido), called_at.
- Helper compartilhado em `supabase/functions/_shared/_deprecation.ts` exportando `logDeprecationHit(req, name)` que faz INSERT non-blocking.
- Chamar `logDeprecationHit` no topo do handler de cada função alvo (lista completa em 1.7), ANTES de qualquer lógica. Função continua rodando normalmente nesta etapa.
- Card no `/sistema` ("Aposentadoria — chamadas residuais nas últimas 24h / 7d") consultando essa tabela.

Resultado: durante a Fase 1 inteira (mesmo após kill-switch), conseguimos ver tentativas e identificar callers escondidos (cron, outras funções, jobs antigos).

---

## 1.4 Passo 2 — Desligar gatilhos na UI

Esconder/desabilitar (não deletar) os componentes que disparam o pipeline. Cada um vira no-op com toast "Aposentado — Fase 1" para ainda gerar `deprecation_hits` se algo automatizado clicar:

- `src/components/brain/AutopilotButton.tsx` → desabilitado.
- `src/components/brain/AutopilotLivePanel.tsx` → esconder das páginas.
- `src/components/brain/ReplicacaoAuto.tsx` / `Replicacao.tsx` → esconder.
- `src/components/cerebro/Coleta.tsx`, `Analises.tsx`, `Decisoes.tsx`, `Insights.tsx`, `Visual.tsx`, `MinhasRecomendacoes.tsx`, `Base.tsx`, `ResumoGenero.tsx`, `VisaoGeral.tsx` → ainda renderizam, mas qualquer botão de ação dispara no-op + toast.
- `src/components/operacao/EditorialSeederCard.tsx` → esconder.
- `src/components/sistema/AoVivoFeed.tsx`, `AoVivoPainel.tsx`, `fluxo/*` → manter visíveis em modo somente-leitura (servem de telemetria) mas remover botões de "rodar agora".
- `src/pages/Criacao.tsx` → adicionar banner "Em aposentadoria — Fase 1" e desabilitar botões de criação/replicação. Não removemos a rota.
- `src/pages/Cerebro.tsx` → idem banner.
- `src/components/CommandPalette.tsx` → remover entradas que disparam autopilot / replicate / collect.

UI continua acessível para diagnóstico, mas não consegue mais iniciar nada. Essa é a parte mais reversível (puro front).

---

## 1.5 Passo 3 — Kill-switch nas edge functions

Em cada função alvo, no início do handler (depois do `logDeprecationHit`), checar flag `DEPRECATED_PHASE1_ENABLED` (env var booleana). Quando `true`:

```ts
return new Response(JSON.stringify({
  ok: false, error: "deprecated_phase1", function: "<name>"
}), { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } });
```

Vantagens:
- Reversível em segundos (flipa env var).
- 410 Gone deixa claro nos logs e fica visível no painel de aposentadoria.
- Funciona como dique mesmo se algum cron órfão ainda existir.

Funções com kill-switch (Passo 3 + telemetria do Passo 1):

Bloco autopilot/criação:
`genre-autopilot`, `autopilot-all-genres`, `analyze-genre`, `generate-playlists-briefing`, `extract-blueprints`, `generate-templates`, `score-templates`, `expire-stale-templates`, `replicate-top`, `auto-replicate-playlists`, `create-spotify-playlist`.

Bloco CO Apify:
`run-search`, `enrich-playlists`, `fetch-tracks-spotify`, `fetch-spotify-featured`, `genre-competitors-sync`, `genre-backfill`, `cron-backfill-dead`, `collect-batch`, `daily-collect`, `generate-terms`, `seed-editorial-terms`, `learning-loop`, `extract-replication-rules`, `revalidate-dataset`.

Bloco auxiliar (criação de capa que só serve para o autopilot):
`generate-cover-variations`, `analyze-genre-visual-dna`.

NÃO recebem kill-switch (permanecem ativos): gestão de playlists, deals, S4A bot, OAuth Spotify, analytics, alerts, planner — lista completa em 1.1.

---

## 1.6 Passo 4 — Desativar crons

Usar `cron.unschedule(jobid)` (NÃO drop) para preservar histórico em `cron.job_run_details`:

```sql
SELECT cron.unschedule(19); -- backfill-dead-genres-6h
SELECT cron.unschedule(8);  -- learning-loop-daily
SELECT cron.unschedule(28); -- recover-stuck-auto-collect
```

Rollback: re-schedule com mesmo schedule string (guardado em 1.10 abaixo).

---

## 1.7 Passo 5 — Bloquear enqueue residual

Em `jobs_queue` e `collection_logs` existem caminhos de enfileiramento usados pelo autopilot. Adicionar guard:

- Migration: trigger `BEFORE INSERT` em `jobs_queue` que recusa rows com `job_type` na lista `('autopilot','genre-autopilot','autopilot-all-genres','collect-batch','daily-collect','run-search','enrich-playlists','genre-backfill','cron-backfill-dead','auto-replicate-playlists','replicate-top','generate-templates','extract-blueprints','create-spotify-playlist','generate-terms','learning-loop')` quando GUC `app.deprecation_phase1` = `'on'`.
- Mesmo padrão para `collection_logs` se houver insert-as-trigger.
- GUC ligado via `ALTER DATABASE ... SET app.deprecation_phase1 = 'on'` — reversível com `RESET`.

---

## 1.8 Passo 6 — Observação (5–7 dias)

Painel novo em `/sistema` → aba "Aposentadoria":
- Tabela de `deprecation_hits` agregada (por função, por source, últimas 24h e 7d).
- Lista de tentativas de INSERT bloqueadas em `jobs_queue` (capturadas pelo trigger em outra tabela `deprecation_blocked_jobs`).
- Top 5 callers por user_id.
- Botão "Exportar CSV" para auditoria.

Critério de avanço para Fase 2:
- 7 dias com zero hits originados de `cron` ou `internal`.
- Hits remanescentes devem ser exclusivamente `unknown`/scanners externos ou cliques em botões já desativados.

---

## 1.9 Riscos e dependências ocultas previstas

| Risco | Mitigação |
|---|---|
| `execution-planner-every-minute` chamar internamente algum alvo | Telemetria pega imediatamente; planner permanece ativo, só observa. |
| `recover-stuck-auto-collect` ressuscitar jobs antigos | É desligado no Passo 4; jobs já marcados "stuck" ficam quietos. |
| Cron externo (não pg_cron) chamando via HTTP | Kill-switch retorna 410 e gera hit visível. |
| Frontend cacheado em browser do usuário ainda disparar | Toast informa "Aposentado"; backend bloqueia mesmo assim. |
| Triggers de DB chamarem edge function via `net.http_post` | Grep no schema (Passo 0 abaixo) lista todas as funções pgsql que chamam `net.http_post`; se alguma apontar para alvo, neutralizar antes do Passo 3. |
| Bot VPS chamar endpoint deprecated | docs/BOT_VPS_CONTRACT.md já lista contratos; revisar para garantir que bot só fala com endpoints permitidos. |

Passo 0 (varredura prévia, antes do Passo 1):
- `rg -n "net\\.http_post" supabase/migrations` filtrando por nomes de função alvo.
- `rg -n "supabase\\.functions\\.invoke\\(|/functions/v1/" supabase/functions` para mapear chamadas function→function.
- Listar resultado em `docs/DEPRECATION_PHASE1.md` para revisão antes de qualquer desligamento.

---

## 1.10 Plano de rollback (por passo)

| Passo | Como reverter | Tempo |
|---|---|---|
| 1 Telemetria | Drop tabela `deprecation_hits` (opcional, é inerte). | imediato |
| 2 UI | Reverter commit do front. | 1 deploy |
| 3 Kill-switch | `DEPRECATED_PHASE1_ENABLED=false` em Secrets. | <1 min |
| 4 Crons | `SELECT cron.schedule('backfill-dead-genres-6h','17 */6 * * *', $$...$$);` (SQLs salvos em `docs/DEPRECATION_PHASE1.md`). | <1 min |
| 5 Triggers | `ALTER DATABASE postgres RESET app.deprecation_phase1;` ou DROP TRIGGER. | <1 min |

Nada nesta fase é destrutivo. Código continua deployado, dados continuam intactos.

---

## 1.11 Checklist executável (Fase 1)

Pré-requisitos:
- [ ] Varredura `net.http_post` em migrations + `functions.invoke` no código (Passo 0)
- [ ] Documento `docs/DEPRECATION_PHASE1.md` criado com inventário + SQLs de rollback

Implementação:
- [ ] Migration: tabela `deprecation_hits` + `deprecation_blocked_jobs`
- [ ] Edge function shared: `_deprecation.ts`
- [ ] Adicionar `logDeprecationHit` em todas as 27 funções alvo (1.5)
- [ ] Adicionar kill-switch (env var) nas mesmas 27 funções
- [ ] Secret `DEPRECATED_PHASE1_ENABLED=false` (default off — ativamos via flip controlado)
- [ ] UI: desabilitar botões / esconder cards (1.4)
- [ ] Migration: trigger guard em `jobs_queue`
- [ ] Painel "Aposentadoria" em `/sistema`

Ativação (em ordem, com janela de 24h entre eles):
- [ ] Dia 0: deploy telemetria + UI desabilitada (Passos 1–2)
- [ ] Dia 1: revisar `deprecation_hits` — se silêncio de UI, ativar kill-switch (Passo 3)
- [ ] Dia 2: `cron.unschedule` dos 3 jobs (Passo 4) + ligar GUC do trigger (Passo 5)
- [ ] Dia 2–9: observar painel
- [ ] Dia 9: relatório consolidado → decidir Fase 2

Validação pós-deploy:
- [ ] `cron.job WHERE active=true` não contém os 3 jobids desativados
- [ ] `curl` em cada função alvo retorna 410
- [ ] `INSERT INTO jobs_queue (job_type='autopilot', ...)` é recusado
- [ ] Painel "Aposentadoria" carrega
- [ ] Sync de managed playlists, deals, S4A bot, OAuth, métricas continuam verdes em `/sistema`

---

## 1.12 O que NÃO faz parte desta fase

- Apagar edge functions (Fase 3)
- Apagar páginas/componentes (Fase 2)
- Apagar tabelas Apify/blueprints/templates (Fase 4)
- Remover env vars APIFY_* (Fase 4)
- Limpar `cron.job_run_details` antigo (Fase 4)

Confirme se posso implementar a Fase 1 nessa ordem (começando pelo Passo 0 + Passo 1 hoje).
