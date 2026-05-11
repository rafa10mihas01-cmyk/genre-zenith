# Fase 3 — Account + VPS Orchestration

Objetivo: dar ao sistema a noção de "qual VPS executa qual conta do Spotify para quais playlists", sem quebrar nada existente.

Observação importante (descoberta na análise): já existe a tabela `accounts` (1 linha hoje: "Baile Hits Oficial") que armazena a identidade da conta Spotify (`spotify_user_id`, `email`, `display_name`, `status`, `max_playlists`). Ela é referenciada por `managed_playlists.account_id` e por todo o pipeline de bot.

A nova tabela `spotify_accounts` pedida no enunciado se sobrepõe a `accounts`. Vou seguir o spec do usuário e criar `spotify_accounts` como **camada de orquestração operacional** (sessão + VPS), com FK para `accounts` (fonte da verdade da identidade). Os campos `email` e `display_name` em `spotify_accounts` são apenas cache para o bot ler sem join — sempre sincronizados a partir de `accounts`.

Se você preferir consolidar tudo em `accounts` adicionando `vps_node_id`/`session_file_path`/`last_login_at` direto lá, é uma alternativa mais enxuta. Sigo com `spotify_accounts` separado como pedido; me avise se quiser inverter.

---

## 1. Nova tabela `vps_nodes`

```text
vps_nodes
├── id                         uuid PK
├── hostname                   text UNIQUE NOT NULL
├── ip                         inet NOT NULL
├── status                     text NOT NULL  check in ('active','inactive')  default 'active'
├── max_concurrent_sessions    smallint NOT NULL default 1
├── notes                      text NULL
├── last_heartbeat_at          timestamptz NULL
├── created_at                 timestamptz NOT NULL default now()
└── updated_at                 timestamptz NOT NULL default now()
```

Seed do VPS atual:
```sql
INSERT INTO vps_nodes (hostname, ip, status, max_concurrent_sessions)
VALUES ('nexengine-bot-02', '178.156.161.146', 'active', 1)
ON CONFLICT (hostname) DO NOTHING;
```

RLS `has_team_access()` em SELECT/INSERT/UPDATE/DELETE. Trigger leve para `updated_at`.

---

## 2. Nova tabela `spotify_accounts`

```text
spotify_accounts
├── id                  uuid PK
├── account_id          uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE
├── vps_node_id         uuid NULL REFERENCES vps_nodes(id) ON DELETE SET NULL
├── email               text NULL          (cache de accounts.email)
├── display_name        text NULL          (cache de accounts.display_name)
├── session_file_path   text NULL          (ex: /opt/bot/sessions/<id>.json)
├── status              text NOT NULL      check in ('active','expired','inactive')  default 'inactive'
├── last_login_at       timestamptz NULL
├── notes               text NULL
├── created_at          timestamptz NOT NULL default now()
└── updated_at          timestamptz NOT NULL default now()
```

- `UNIQUE(account_id)` → 1 spotify_account por account.
- Trigger sincroniza `email` e `display_name` a partir de `accounts` em INSERT/UPDATE quando vierem NULL.
- RLS `has_team_access()`.

Seed: para cada linha em `accounts` que ainda não tenha spotify_account, criar uma com `status='inactive'` (vai virar `active` quando o bot logar e gravar o session file). Vincular ao `nexengine-bot-02` por padrão (único VPS hoje).

---

## 3. Vínculo VPS ↔ managed_playlists

O usuário pediu "vincula as 109 playlists próprias ao vps_node_id". Como `managed_playlists.account_id` já existe e cada `account` agora tem `spotify_account` que aponta para `vps_node`, o vínculo é **derivado**, não precisa coluna nova:

```text
managed_playlists.account_id → accounts.id → spotify_accounts.account_id → spotify_accounts.vps_node_id → vps_nodes
```

Para o bot consultar de forma direta, crio a view `v_playlist_vps_assignment` (read-only, segura via RLS das tabelas base):

```sql
CREATE VIEW v_playlist_vps_assignment AS
SELECT mp.id AS managed_playlist_id, mp.spotify_playlist_id, mp.canonical_playlist_id,
       sa.id AS spotify_account_id, sa.session_file_path, sa.status AS account_status,
       v.id AS vps_node_id, v.hostname, v.ip
FROM managed_playlists mp
JOIN accounts a          ON a.id  = mp.account_id
JOIN spotify_accounts sa ON sa.account_id = a.id
LEFT JOIN vps_nodes v    ON v.id  = sa.vps_node_id
WHERE mp.archived_at IS NULL;
```

Sem alterar a tabela existente, sem coluna nova em `managed_playlists`, sem mudança no contrato do bot atual.

---

## 4. Painel admin — nova aba "Infraestrutura"

Criar `src/pages/admin/Infrastructure.tsx` (ou seção dentro de uma página admin existente — vou detectar):

- **Card 1: VPS Nodes** — lista compacta (`hostname · ip · status dot · sessões ativas / max · último heartbeat`). Ação: editar `max_concurrent_sessions`, alternar status.
- **Card 2: Contas Spotify** — lista (`display_name · email · status dot · VPS atribuído · última sessão`). Ação: trocar VPS (dropdown), forçar status, abrir notas.
- **Card 3: Mapa de Atribuição** — tabela `Conta → VPS → quantas playlists`. Só leitura.

Componentes seguem o design system: `StatusDot`, `MetricCell`, rows compactos (~64px). Usa `PageHeader title="Infraestrutura" subtitle="Orquestrar VPS e sessões"`.

Rota: `/admin/infrastructure`, protegida por `has_team_access()` (já temos guard).

---

## 5. Contrato do bot (futuro, sem mudar nada agora)

A view `v_playlist_vps_assignment` já entrega `spotify_account_id` por playlist. Quando o orquestrador for atualizado (próxima fase ou no próprio bot agent), basta consultar:

```sql
SELECT spotify_account_id, session_file_path FROM v_playlist_vps_assignment
WHERE spotify_playlist_id = $1;
```

Nenhum job, edge function ou tabela atual é alterado nesta fase. A integração real fica para quando o bot for atualizado.

---

## 6. O que **NÃO** será feito

- Não alterar `accounts`, `managed_playlists`, `bot_events`, `bot_heartbeats`.
- Não alterar nenhuma edge function existente.
- Não escrever no VPS, não tocar em `session.json` real — apenas registrar o `session_file_path`.
- Não criar lógica de balanceamento entre VPS (fica para Fase 4+).

---

## 7. Entregáveis

1. **Migration** com:
   - `vps_nodes` + RLS + seed do nexengine-bot-02.
   - `spotify_accounts` + RLS + trigger de sync cache + seed a partir de `accounts`.
   - View `v_playlist_vps_assignment`.
2. **Frontend**:
   - Página `/admin/infrastructure` com 3 cards descritos.
   - Hook `useInfrastructure` para fetch consolidado.
   - Entrada no menu admin (sem remover nada).

---

## 8. Verificação

- `SELECT count(*) FROM vps_nodes;` → 1
- `SELECT count(*) FROM spotify_accounts;` → 1 (1 account existente)
- `SELECT count(*) FROM v_playlist_vps_assignment;` → 109 (todas as managed playlists não-arquivadas com VPS resolvido)
- UI renderiza as 3 entidades corretamente.

Posso prosseguir.