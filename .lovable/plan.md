# NexEngine — Reformulação para Growth Manual

## Filosofia
**A IA pensa, o humano decide.** Coleta/análise/aprendizado seguem automáticos. Criação, edição e publicação viram 1-clique manual.

## Fase 1 — Banco e estrutura (backend mínimo)

1. **Tabela `managed_playlists`** (nova) — playlists reais que você opera.
   - Campos: `id`, `spotify_playlist_id`, `spotify_url`, `name`, `cover_url`, `followers`, `tracks_count`, `genre_id`, `imported_at`, `archived_at`, `last_diagnosis_at`, `metadata jsonb`.
   - RLS: `has_team_access()`.
2. **Tabela `playlist_diagnoses`** (nova) — snapshots de sugestões da IA.
   - Campos: `playlist_id`, `created_at`, `name_score`, `name_suggestion`, `tracks_suggestions jsonb`, `cover_suggestion`, `applied_at`, `applied_by`.
3. Reaproveitar `track-playlist-metrics`, `genre_models`, `palavras_chave`, `padroes_nome`, `extract-replication-rules` apontando para `managed_playlists`.

## Fase 2 — Operação reformulada (frontend)

Substituir as abas atuais de `Operacao.tsx` por:

### Aba 1 — Minhas Playlists (principal)
- Lista de cards das playlists importadas (capa, nome, seguidores, gênero, status).
- Botão **"+ Importar playlist"** → cola URL Spotify → função `import-managed-playlist` puxa metadata.
- Cada card tem ações: **Diagnosticar**, **Editar**, **Arquivar**.
- **Drawer de diagnóstico** ao clicar Diagnosticar:
  - Nome: score + sugestão (palavras-chave faltando) → botão "Aplicar nome no Spotify"
  - Capa: comparação visual + sugestões → "Trocar capa" (upload / URL / IA)
  - Faixas: lista de termos quentes faltando → "Adicionar faixas sugeridas"
  - Posição vs concorrentes
  - Cada sugestão: 1 botão = 1 ação no Spotify

### Aba 2 — Criar nova (avançado, secundário)
- Formulário simples: gênero + nome.
- Capa em 3 opções (upload PC = padrão, URL, IA opcional).
- Botão **"Publicar no Spotify"** (manual, sem cron).

### Aba 3 — Arquivadas
- Lista read-only de playlists arquivadas (mantém histórico/métricas).
- Botão "Restaurar".

## Fase 3 — Edge functions

**Novas (manuais, chamadas por botão):**
- `import-managed-playlist` — recebe URL, busca metadata Spotify, insere em `managed_playlists`.
- `diagnose-managed-playlist` — roda análise (nome/faixas/capa) usando `genre_models`, salva em `playlist_diagnoses`.
- `apply-playlist-change` — aplica 1 mudança no Spotify (rename | replace_cover | add_tracks).
- `archive-managed-playlist` — soft delete local.

**Mantidas automáticas (cron continua):**
- `daily-collect`, `track-playlist-metrics`, `analyze-genre`, `enrich-playlists`, `extract-replication-rules`, `learning-loop` (somente parte de coleta/análise).

**Desligar crons (manter código, virar botão "Rodar agora"):**
- `auto-replicate-playlists`, `auto-adjust-playlists`, `autopilot-all-genres`, `genre-autopilot`.
- Remover schedules em `pg_cron` dessas funções (manter as de coleta).

## Fase 4 — Reorganização do menu

- **Operação** = Minhas Playlists (foco)
- **Criação** vira sub-aba dentro de Operação (não mais item de menu principal)
- **Performance** = passa a comparar antes/depois das playlists gerenciadas
- **Cérebro/Sistema/Configurações** = sem mudança

## Fase 5 — Capa: nova prioridade
No editor de capa do diagnóstico e da criação:
1. Upload do PC (padrão visível)
2. Colar URL de imagem
3. Gerar com IA (botão secundário, ícone de ✨)

## Detalhes técnicos
- Cron desativado via `cron.unschedule('nome-do-job')` para auto-replicate/auto-adjust/autopilot.
- `requireTeamAccess` em todas as novas edge functions.
- Storage bucket `playlist-covers` (já existe? se não, criar público).
- `apply-playlist-change` usa token Spotify do `accounts` correspondente.
- Frontend: novo hook `useManagedPlaylists`, componentes `ManagedPlaylistCard`, `DiagnosisDrawer`, `CoverPicker`.

## Ordem de execução
1. Migrations (tabelas + unschedule crons de ação)
2. Edge functions novas
3. Frontend: aba "Minhas Playlists" + import flow
4. Drawer de diagnóstico + apply
5. Mover criação para sub-aba + reordenar capa
6. Aba arquivadas
7. Performance: trocar fonte para `managed_playlists`

## Fora do escopo desta fase
- Notificações automáticas de queda
- A/B test de capas
- Recomendação cross-playlist
(vão para backlog "automações fortes" depois de validar growth real)
