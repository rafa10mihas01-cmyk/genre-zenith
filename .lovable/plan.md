# Plano de correção dos 10 gaps — sem quebrar nada

Princípios:
- **Tudo additivo.** Nada de rename/drop em coluna existente, nada de mudar contrato de função pública.
- **Crons novos começam desligados** (schedule criado mas comentado / job `active=false`). Liga 1 por vez, observa 24h.
- **Cada mudança tem rollback de 1 linha** (`UPDATE … SET active=false` ou remoção do `pg_cron.schedule`).
- **Zero refactor de domínio.** Só preencher buracos.
- Respeita o estado atual: crons ainda meio desligados, `nexengine-03` como app padrão. Não religa nada que está pausado de propósito.

---

## Onda 1 — Quick wins sem cron novo (risco ~zero)

Objetivo: tirar fricção operacional do dia a dia sem tocar em scheduler.

### G-cliente — Enrich automático no cadastro
- Em `useClients.addClient`, já existe `enrichSpotifyIfPossible`. Garantir que ele dispara **também quando o operador cola URL depois** (já tem no `updateClient` — confirmar) e logar warning visível no console quando regex falha.
- Adicionar pequeno badge "enriquecendo…" no card do cliente enquanto `enrich-client-spotify` está em flight (estado local, não persiste).
- Sem nova tabela, sem nova função. Só UX + garantia de chamada.

### G3 — Notificação interna quando cliente aprova/rejeita plano
- No mesmo endpoint que hoje grava `client_approved_at` / `client_rejected_at`, **adicionar insert em `notifications`** (tabela já existe) com `type='campaign_plan_decision'` e link pra campanha.
- Bell do header já consome `notifications`. Zero UI nova.
- Rollback: remover o insert.

### G4 — Re-aprovação após ajuste
- Adicionar coluna `client_decision_round int default 1` em `campaign_plans` (additivo, default seguro).
- Quando operador editar plano após `client_rejected_at IS NOT NULL`: incrementar round, `UPDATE … SET client_rejected_at=null, client_approved_at=null`.
- UI: badge "Rodada 2" ao lado do status quando round > 1.
- Nenhum código antigo quebra — quem não usa round simplesmente ignora.

---

## Onda 2 — Crons existentes em modo observação (risco baixo)

Objetivo: cobrir os crons órfãos sem ligar carga nova ainda.

### G7 — `reap_zombie_playlist_jobs` agendado
- Criar schedule `reap-zombies-hourly` rodando **a cada 1h**, mas registrar com `active=false`.
- Adicionar painel em `/sistema → Saúde` mostrando: última execução, quantos zumbis matou.
- Ligar manualmente (via UI ou `UPDATE cron.job SET active=true WHERE jobname='reap-zombies-hourly'`) depois de 1 dia observando manualmente.

### G11 — `execution-planner` entra no `monitor-critical-crons`
- Adicionar `'execution-planner'` no array de crons monitorados.
- Não muda lógica — só passa a alertar se ele sumir > X minutos.
- Rollback: remover string do array.

### G10/G6 — Retenção/remoção pós-campanha
- Criar função `cleanup_finished_campaign_tracks(campaign_id uuid, dry_run bool default true)` — recebe campanha e **retorna** o que removeria (sem executar enquanto `dry_run=true`).
- Botão "Simular limpeza" na tela da campanha encerrada. Operador roda manual, vê o que sairia.
- Só depois (Onda 4) viramos pra cron com `dry_run=false`.

---

## Onda 3 — Cobrir cron de onboarding/SEO (risco médio, requer observação)

### G-onboarding/SEO — playlist nova parada
- Criar edge function `kick-onboarding-pipeline` que:
  1. Busca playlists com `created_at > now() - 7d` e `onboarding_status IS NULL`.
  2. Chama o pipeline existente (sem reescrever) — apenas dispara.
- Schedule **2x/dia** (12h em 12h, não a cada minuto), começa `active=false`.
- Antes de ligar: rodar manual 3 vezes, conferir logs, confirmar que não bate em 429 Spotify (lembrando do contexto atual de circuit breaker).
- Ligar só depois que `nexengine-03` estiver estável e demais crons reativados.

### G2 — Relatório final de campanha
- Já existe `dealClosurePdf.ts` / `campaignClosurePdf.ts`. Criar wrapper `generateCampaignFinalReport(campaign_id)` que monta PDF completo (KPIs + curva de entrega + curadores + investimento) reaproveitando o que tem.
- Botão "Gerar relatório final" na tela de campanha encerrada — manual primeiro, automático só depois.
- Email continua igual; o PDF vira **anexo opcional**, não substitui nada.

---

## Onda 4 — Itens estruturais (planejar agora, executar depois)

Esses dependem de decisão de produto. **Não implementar nesta leva** — só preparar terreno.

### G-lifecycle — 5 fases vs 3
- Auditar: listar onde o brain usa 5 fases e onde o schema/UI usa 3.
- Entregar documento (`docs/LIFECYCLE_ALIGNMENT.md`) com as 3 opções: (a) brain colapsa pra 3, (b) schema expande pra 5, (c) mapeamento N:1.
- **Sem código nesta fase.** Decisão do usuário antes de mexer.

### G-ops-agent — comandos pro VPS
- `ops-agent-poll` hoje é stub. Definir contrato mínimo (3 comandos: restart-bot, sync-now, health-check) em `docs/OPS_AGENT_CONTRACT.md` (já existe — revisar).
- Implementação fica pra próxima leva; por ora, manter SSH/PM2 como caminho oficial e documentar isso na tela `/sistema`.

---

## Ordem de execução sugerida

```text
Hoje/amanhã:   Onda 1 (G-cliente, G3, G4)
+2 dias:       Onda 2 itens 1 e 2 (reap zombies + monitor-crons)
+3 dias:       Onda 2 item 3 (cleanup dry-run)
+1 semana:     Onda 3 (depois que crons atuais estabilizarem)
Pós-decisão:   Onda 4
```

## O que NÃO faço neste plano

- Não religo nenhum cron que está hoje desligado de propósito.
- Não mexo em `nexengine-03` / circuit breaker / fila de 98 jobs.
- Não renomeio coluna nem dropo nada.
- Não troco lifecycle de 5↔3 sem você decidir.
- Não substituo SSH/PM2 por ops-agent automático ainda.

## Detalhes técnicos (resumo)

- Migrações novas: `+client_decision_round` em `campaign_plans`, função `cleanup_finished_campaign_tracks(uuid, bool)`.
- Edge functions novas: `kick-onboarding-pipeline` (desligada no início).
- Schedules novos via `pg_cron`: `reap-zombies-hourly`, `kick-onboarding-12h` — ambos `active=false` por padrão.
- Tabelas tocadas: `campaign_plans` (add column), `notifications` (insert), nenhuma outra alterada.
- Frontend: badge "Rodada N", badge "enriquecendo…", botão "Simular limpeza", botão "Gerar relatório final". Nada removido.

Me responde qual onda quer que eu execute primeiro (ou se quer começar só por um item específico da Onda 1).