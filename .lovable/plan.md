## O que muda

Hoje o deal tem só 1 cliente implícito e 1 link público (`client_token` no nível do deal). Vamos elevar o cliente ao mesmo patamar do curador: biblioteca reutilizável, e cada música do deal pode ter um cliente diferente, com seu próprio smartlink e seu próprio link público.

### 1. Banco

**Nova tabela `clients`** (espelha `curators`):
- `id, user_id, name, contact, notes, archived_at, created_at, updated_at`
- RLS por `user_id` (igual `curators`)

**Em `curator_deal_songs`**, adicionar:
- `client_id uuid` (FK lógica → `clients.id`, nullable)
- `smartlink_url text` (nullable)
- `client_token text unique default gen_random_bytes()` — token público **por música**

`curator_deals.client_token` fica intacto pra não quebrar links antigos (fallback).

### 2. Edge function `get-client-campaign-public`

Aceita `client_token` que pode ser de **música** ou de **deal** (compatibilidade):
- Se for de música: descobre `deal_id` + `client_id` daquela música, retorna todas as músicas do mesmo deal **com o mesmo `client_id`** (ou só aquela música, se sem cliente).
- Se for de deal: comportamento atual, retorna todas as músicas do deal.
- Resposta passa a incluir `songs[]` (cada uma com nome, capa, smartlink, progress próprio) e a música selecionada por padrão (a do token).

### 3. NewDealDialog

- Passo do curador continua igual.
- **Por linha de música**, abaixo dos campos atuais, adicionar:
  - Seletor de cliente (picker estilo curador: buscar / cadastrar novo inline com nome + contato)
  - Campo "Smartlink (Linkfire/ToneDen)" — opcional, validação de URL
- Esses campos persistem no draft junto com o resto.

### 4. Página `/campanha/:token` (ClientCampaignPage)

Reorganizar pra seguir a estrutura da CuratorPage, mas com info dosada (sem custos/curadores):
- **Header**: nome do cliente + nome da campanha
- **Seletor de música no topo** (chips/pills) quando houver mais de 1 música do mesmo cliente no deal
- KPIs e gráfico mostram a música selecionada
- Botão "Abrir smartlink" se a música tiver `smartlink_url`
- Lista de playlists monitoradas filtra pela música selecionada

### 5. Tabela "Clientes" (opcional nesta entrega)

Não vou criar a página `/clientes` agora — só a biblioteca usada dentro do diálogo. Se quiser página dedicada depois (igual `/curadores`), faço numa próxima.

### Detalhes técnicos

- Hook novo: `useClients` (CRUD básico, espelha trecho de `useCuratorDeals`)
- `clientCampaignUrl({ client_token })` continua funcionando; admin agora copia o link **por música** (botão na linha da música no card do deal) — token vem de `curator_deal_songs.client_token`
- `addDeal` / `updateDeal` (em `useCuratorDeals`) passam `client_id` e `smartlink_url` por música
- Backfill: trigger de `INSERT` em `curator_deal_songs` gera `client_token` automaticamente; rodar UPDATE inicial pra preencher tokens das músicas existentes

### Fora do escopo

- Página `/clientes` standalone (tipo `/curadores`)
- Notificações pro cliente
- Permissão do cliente editar algo (página segue read-only)
