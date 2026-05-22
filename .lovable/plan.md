# Upload de planilha pelo cliente (fallback quando não tem Spotify)

## Resumo
Quando o deal **não tem Spotify conectado**, o portal do cliente mostra um card de upload de planilha. Cliente sobe .xlsx (formato da gravadora), sistema parseia, grava como snapshot — motor (velocidade/ETA/score) roda igual. Se passar 48h sem upload, dispara email automático cobrando + alerta interno.

## O que vou construir

### 1. Banco
- **Tabela `label_spreadsheet_uploads`**: histórico dos uploads (deal_id, uploaded_by, file_path, rows_imported, total_streams, status, created_at). RLS: cliente do deal vê só os dele, equipe vê tudo.
- **Storage bucket `label-spreadsheets`** (privado): guarda os .xlsx originais pra auditoria.
- **Sem mudança em `curator_deals`**: detecção "tem Spotify?" usa `spotify_owner_id IS NULL` (já existe) como sinal de "fonte planilha".

### 2. Edge function `import-label-spreadsheet`
- Recebe `{ deal_id, file_path, client_token }` ou `{ deal_id, file_base64 }`.
- Valida token público do cliente.
- Parseia .xlsx (colunas: `#`, `VERSION NAME`, `ISRC`, `PLAYLIST`, `COUNTRY`, `OWNER NAME`, `CURRENT POSITION`, `STREAMS`).
- Valida ISRC bate com música do deal (se ISRC do deal estiver preenchido).
- Modo **preview** (`?preview=1`): só retorna contagem ("114 playlists, 73.924 streams") sem gravar.
- Modo **commit**: grava em `curator_deal_snapshots` (uma linha por playlist, source = `label_spreadsheet`) + um agregado em `curator_deal_logs`. Detecta duplicata (mesmo hash de conteúdo + mesma data) e ignora.
- Insere row em `label_spreadsheet_uploads`.

### 3. UI no portal do cliente
- Em `ClientCampaignPage.tsx` (quando `deal.spotify_owner_id` é nulo): card novo "Atualizar dados da campanha".
- Drag-and-drop .xlsx → mostra preview ("vou importar X playlists, Y streams — confirmar?") → grava.
- Mostra "última atualização há Xd" + lista dos 5 últimos uploads.
- Banner amarelo suave se passar de 48h sem upload.

### 4. Lembrete automático
- Cron diário (pg_cron) chama edge function `check-pending-spreadsheet-uploads`.
- Pra cada deal ativo sem Spotify e com último upload > 48h: chama `send-transactional-email` (template novo `label-spreadsheet-reminder`) + cria notificação interna.
- Idempotency key inclui o dia, então não envia 2x no mesmo dia.

## O que NÃO vou mexer
- Coletor Spotify (continua igual pros deals que têm token).
- Cálculo de velocidade/ETA/score (vai consumir os snapshots independente da origem).
- Sidebar / navegação principal.

## Detalhes técnicos
- Layout da planilha = exato o que a gravadora mandou (testado contra `pls_carnivoro_2026-05-22.xlsx`). Se vier outra ordem de colunas, parseia por header name.
- Parser xlsx no edge function: usa `xlsx` via `npm:xlsx@0.18.5`.
- Storage bucket privado com RLS: só o owner do deal (via client_token) pode subir; equipe lê tudo.
- Email reminder usa Lovable Emails (infra já existe — vi `email_send_log`, `email_send_state` no banco).

## Próxima ação se você aprovar
Crio a migration, o bucket, a edge function, a UI no portal, o template de email e o cron — tudo numa rodada.
