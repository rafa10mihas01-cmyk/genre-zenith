# O que o VPS precisa saber — atualização 2026-05-22

> TL;DR: **nada quebra no VPS hoje.** Todas as mudanças foram server-side
> (RPC + edge functions). O contrato `BOT_VPS_CONTRACT.md` e o
> `OPS_AGENT_CONTRACT.md` **continuam válidos sem alteração de assinatura**.
> Só vale a pena revisar 2 campos opcionais no payload pra ganhar precisão.

---

## 1. Saúde atual do VPS

| Item | Valor |
|---|---|
| `vps_nodes` → `nexengine-bot-02` | ✅ ativo, heartbeat há ~3 min |
| `bot_heartbeats` → `bot-01` | ✅ online, cadência de 5 min |

PASS. VPS está conectado.

---

## 2. O que NÃO mudou (VPS não precisa alterar nada)

- **Endpoints**: `bot-collect-queue`, `bot-event-ingest`, `bot-upload-print`,
  `bot-ingest-snapshot`, `bot-ingest-dom`, `bot-heartbeat`, `bot-execution-queue`,
  `bot-execution-complete`, `ops-agent-poll`, `ops-agent-report` — **mesmas
  URLs, mesmos métodos, mesmas assinaturas**.
- **Auth**: headers `x-bot-key` / `x-agent-token` inalterados.
- **Headers de identidade** (`x-worker-id`, `x-process-id`, `x-hostname`,
  `x-timer-id`, `x-bot-name`, `x-bot-session`) inalterados.
- **Lifecycle states**: FETCHED → ACCEPTED → QUEUED_LOCAL → STARTED →
  PRINT_UPLOADED → SNAPSHOT_SENT → FINISHED / FAILED / DISCARDED — mesma lista.
- **Loop de execução** (`playlist.track.add`) inalterado.
- **Política de retry, timeout, recovery (3 min)** mantidas.

---

## 3. O que mudou no servidor (transparente pro VPS)

1. **Match de playlist é por `spotify_playlist_id`** — o VPS já manda esse
   campo no `dom_payload`, então funciona automático. Match por nome agora
   exige similaridade ≥ 0.85 (era 0.6). Fallback fuzzy raramente dispara.
2. **Sem "ghost playlists"** — se o snapshot chega com um `spotify_playlist_id`
   que **não está cadastrado** no deal, o servidor **descarta o snapshot**
   e cria notificação `playlist_nao_identificada`. **NÃO cria mais linha
   nova em `curator_playlists`**. Resposta passa a ter `skipped > 0` em vez
   de `inserted`.
3. **Anti-spike**: se `plays` cair > 50% ou subir > 10× vs. snapshot anterior,
   o registro entra com `flagged=true` (ainda é gravado, só fica marcado).
4. **Ledger financeiro novo** (`curator_deal_payments`) — não afeta o bot.
5. **Cron diário de fraude + alerta de baseline ausente** — não afeta o bot.

Resumo: o VPS **continua mandando o mesmo payload**. O servidor só ficou
mais rigoroso na hora de aceitar.

---

## 4. O que o VPS precisa enviar que talvez não esteja enviando

Campos **opcionais mas recomendados** no `dom_payload[].playlists[]`
(quando disponíveis no DOM do Spotify for Artists):

| Campo | Status hoje | Impacto se faltar |
|---|---|---|
| `spotify_playlist_id` | ✅ já enviado (regex `playlist[/:]([a-zA-Z0-9]{16,})` no href) | sem ele → cai no fallback de nome (pior) |
| `playlist_name` | ✅ já enviado | usado só pra log / fallback |
| `plays_24h` | ✅ enviado quando visível | métrica curta de tendência |
| `plays_7d` | ⚠️ enviar quando disponível | janela oficial de progress |
| `plays_28d` | ⚠️ enviar quando disponível | janela longa |
| `followers` | ✅ opcional | usado em scoring |
| `position_in_playlist` | ❌ **não é parte do contrato hoje** | não precisa enviar |

**Ação sugerida pro VPS**: garantir que `plays_7d` e `plays_28d` sejam
extraídos quando o seletor do Spotify expõe (algumas telas mostram só 24h —
nesse caso manda só `plays_24h` ou `plays`, o servidor faz fallback).

`position_in_playlist` **não está no contrato e não precisa ser implementado**
nesta rodada.

---

## 5. Endpoints que mudaram de assinatura

**Nenhum.** Todas as assinaturas (`POST bot-ingest-snapshot`,
`POST bot-ingest-dom`, `POST bot-upload-print`, `POST bot-heartbeat`,
`GET bot-collect-queue`, etc.) continuam idênticas.

Única diferença observável na resposta: `bot-ingest-snapshot` agora pode
retornar `{ ok: true, inserted: 0, skipped: N }` quando todas as playlists
do payload eram desconhecidas — antes ele criaria linhas novas. Tratar
`skipped > 0` como aviso, não erro.

---

## 6. Checklist final pro responsável do VPS

- [ ] Nada a deployar. Bot pode continuar rodando.
- [ ] (Opcional) Confirmar que `plays_7d` / `plays_28d` estão sendo
      extraídos quando a UI do Spotify expõe.
- [ ] Monitorar notificações `playlist_nao_identificada` em `/sistema` — se
      aparecerem em volume, significa que tem playlist no print que não está
      cadastrada no deal (problema de cadastro, não do bot).
