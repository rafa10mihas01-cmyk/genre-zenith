# Plano: Multi-App Spotify sem quebrar o sistema atual

Objetivo: permitir conectar várias **apps Spotify** (cada uma com seu Client ID/Secret e seu próprio limite de **5 contas por app** — limite real do Spotify em modo Development), distribuindo as contas conectadas entre elas, **sem nenhum downtime** e **sem quebrar nada do que já funciona hoje**.

A regra de ouro do plano: em **cada fase**, o sistema continua 100% funcional como está hoje. Só ativamos uma fase quando a anterior está estável.

---

## Princípios de segurança

1. **Backward-compatible primeiro.** Toda mudança de schema é aditiva (nova coluna `nullable`, nova tabela). Nada é removido até a última fase.
2. **App "default" continua funcionando via env vars.** Enquanto a coluna `app_id` for nula, o código usa o `SPOTIFY_CLIENT_ID/SECRET` atual exatamente como hoje.
3. **Migração de dados em background.** Backfill da app atual como linha em `spotify_apps` antes de qualquer refactor.
4. **Feature flag por função.** Refatoramos `_shared/spotify.ts` uma vez; cada edge function passa a usar a nova assinatura sem mudar comportamento (mesmo app, mesmas contas).
5. **Rollback fácil.** Se algo quebrar, basta deletar a 2ª app de `spotify_apps` — o sistema volta a se comportar como single-app.

---

## Fase 0 — Preparação de schema (não muda comportamento)

Migração SQL (aditiva, segura):

- Criar tabela `spotify_apps`:
  - `id uuid pk`
  - `name text` (ex: "App Principal", "App Secundária")
  - `client_id text not null`
  - `client_secret text not null` (criptografado via vault ou guardado em secrets — ver nota abaixo)
  - `max_accounts int default 5` (limite real do Spotify por app em Development Mode)
  - `status text default 'active'` (active/paused)
  - `is_default boolean default false`
  - `created_at`, `updated_at`
  - RLS: só admin lê/escreve.

- Adicionar coluna `app_id uuid references spotify_apps(id)` em:
  - `spotify_user_tokens` (nullable)
  - `spotify_tokens` (nullable, para o app token client_credentials)

- **Backfill**: inserir 1 linha em `spotify_apps` representando a app atual (`name='App Principal'`, `is_default=true`, credentials lidas de uma vez via secret/manual). Atualizar todas as `spotify_user_tokens` e `spotify_tokens` existentes com esse `app_id`.

- Criar RPC `pick_next_account(p_purpose text, p_app_id uuid default null)`:
  - Retorna a conta com mais espaço (`current_playlists < max_playlists`), filtrando por `status='active'`.
  - Se `p_app_id` for dado, restringe àquela app.
  - Substitui a lógica "default account sempre" por "menos cheia primeiro".

**Nada no código muda nesta fase.** O sistema continua usando env vars.

---

## Fase 1 — Refactor `_shared/spotify.ts` (compat total)

Refatorar `getSpotifyToken()` e `refreshUserToken()` para:

1. Aceitar `appId?: string`. Se omitido, busca a app default em `spotify_apps`.
2. Ler `client_id`/`client_secret` de `spotify_apps` em vez do env. **Fallback**: se a query falhar ou não houver linha, cai no env atual (segurança extra).
3. `getUserAccessToken(spotifyUserId?)`: já funciona; só passa a anexar o `app_id` correto ao refresh.

Atualizar **`spotify-token-watchdog`** para iterar `spotify_user_tokens` JOIN `spotify_apps` e usar as credenciais corretas por conta. Para o app token (`client_credentials`), iterar todas as apps em `spotify_apps` e fazer refresh de cada `spotify_tokens` com seu `app_id`.

Atualizar **`spotify-auth`** (`mode=login` e `mode=callback`) para aceitar `?app_id=` opcional. Sem ele, usa a default. O `state` salvo em `spotify_oauth_states` ganha coluna `app_id` (também aditiva).

**Resultado**: comportamento idêntico ao de hoje, mas a infra está pronta para múltiplas apps.

---

## Fase 2 — UI de gerenciamento de apps

Adicionar na tela de **Configurações → Spotify** (não em Operação):

- Lista de apps cadastradas (nome, # de contas conectadas, # de slots livres, status).
- Botão "Adicionar nova app Spotify" → form pedindo nome + client_id + client_secret + max_accounts.
- Em **AccountsManager** (Operação), agrupar contas por app, mostrando uso por app: `App Principal (3/5)`, `App 2 (0/5)`, etc.
- No fluxo de "Conectar nova conta Spotify", se houver mais de 1 app, mostrar dropdown "Conectar em qual app?" — sugerindo automaticamente a app com mais espaço.

Usar a RPC `pick_next_account` em qualquer função que hoje faz "pega a default" (ex: criação de playlists).

---

## Fase 3 — Adicionar a 2ª app real

1. Usuário cria nova app no Spotify Developer Dashboard.
2. Cadastra em `spotify_apps` via UI da Fase 2.
3. Conecta as próximas contas escolhendo a nova app no dropdown.
4. Watchdog já refresca tokens de ambas as apps automaticamente.

Sem alteração de código nesta fase. É só dado.

---

## Fase 4 — Resiliência (opcional, depois de estabilizar)

- **Throttle por app**: contador in-memory + lock no DB para limitar ~10 req/s por `app_id`.
- **Retry com backoff exponencial** em 429/5xx nas funções que chamam Spotify API.
- **Alertas**: notificar quando uma app passa de 80% de uso (4/5 contas) ou quando tokens falham repetidamente.
- **Métricas**: dashboard simples com requests/min por app, taxa de erro, tokens próximos de expirar.

---

## O que NÃO vamos mudar

- Frontend não passa a chamar Spotify direto. Tudo continua via edge functions com service role (já é a arquitetura correta).
- `spotify_oauth_states`, validação CSRF, idempotência do callback, RLS nas tabelas — tudo permanece.
- Auto-trigger que cria `accounts` a partir de `spotify_user_tokens` — permanece.
- Nenhuma função CRUD de playlist precisa ser reescrita; só passa a chamar `pick_next_account` em vez de hard-coded "default".

---

## Sobre os secrets das apps

Duas opções, escolha do usuário:

- **A. Criptografado no DB (vault)**: mais escalável, qualquer admin cadastra nova app pela UI. Recomendado.
- **B. Secret por app no Lovable Cloud**: ex `SPOTIFY_CLIENT_ID_2`, `SPOTIFY_CLIENT_SECRET_2`. Mais simples, mas exige tocar em secrets a cada nova app (não escala bem).

Recomendo **A** por escalar sem fricção.

---

## Ordem de execução proposta (cada item é 1 PR isolado, testável)

```text
1. Migration  → spotify_apps + app_id columns + backfill + pick_next_account
2. Refactor   → _shared/spotify.ts com fallback env
3. Watchdog   → iterar por app
4. spotify-auth → aceitar app_id opcional
5. UI Settings → CRUD de apps
6. UI Operação → agrupar contas por app + dropdown na conexão
7. Adoção    → trocar "default" por pick_next_account nas funções de playlist
8. (opcional) throttle + retry + alertas
```

Cada passo é independente: se algo der errado em qualquer ponto, paramos ali e o sistema continua funcionando como hoje.

Posso começar pela **Fase 0 (migration)** assim que aprovar?