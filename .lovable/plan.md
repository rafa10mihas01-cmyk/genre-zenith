# Cockpit de Manutenção de Playlist

Reformular o detalhe da playlist (hoje `PlaylistDetail.tsx` + drawer de sugestões em `MinhasPlaylists.tsx`) em um **cockpit operacional fullscreen**, abandonando o formato "drawer + tabela gigante".

---

## 1. Backend — extensões do `diagnose-managed-playlist`

Hoje a função já retorna `suggestions` com buckets (`remove/demote/promote/add`) e `suggested_name`. Vamos somar:

- `suggested_description` — descrição com palavras fortes do nicho (mesma lógica do `suggested_name`).
- `target_position` em cada item de `promote` e `demote` (já existe parcialmente; garantir presente sempre, calculado por popularidade vs vizinhos).
- `current_position` em todos os buckets (para mostrar `#atual → #destino`).
- `market_insights`:
  - `ideal_track_count_range: [min, max]`
  - `avg_rotation_pct`
  - `top_artists: [{name, plays_in_niche}]`
  - `top_recurring_tracks: [{title, artist, niche_playlists_count}]`
  - `leader_playlists: [{name, followers}]`
- `health_status: "aquecido" | "saudavel" | "frio"` + `niche_rank` (posição no top do gênero).
- `missing_keywords: string[]` (palavras do nicho que não aparecem em nome/descrição).

Tudo já é derivável dos dados que a função coleta (snapshots, faixas do nicho, playlists do mesmo gênero). Sem nova tabela.

## 2. Frontend — nova rota fullscreen

Substituir o conteúdo de `src/pages/PlaylistDetail.tsx` (rota `/playlists/:id` ou similar — manter rota atual) por um **cockpit em página inteira**, dividido em 6 seções verticais com forte hierarquia visual:

```text
┌─────────────────────────────────────────────────┐
│ 1. HERO / PERFIL VIVO                           │
│    capa 160px · nome XL · gênero · score · KPIs │
│    [Rodar análise] [Abrir Spotify] [Editar]     │
├─────────────────────────────────────────────────┤
│ 2. IDENTIDADE                                   │
│    Nome atual → sugerido     [Aplicar]          │
│    Descrição atual → sugerida [Aplicar]         │
│    Palavras faltando: chips                     │
├─────────────────────────────────────────────────┤
│ 3. PLANO DE AÇÃO (ordem fixa)                   │
│    [REMOVER 8] [REBAIXAR 3] [PROMOVER 1]        │
│    [ADICIONAR 15]  ← cards clicáveis            │
├─────────────────────────────────────────────────┤
│ 4. EXECUÇÃO — buckets expandidos                │
│    Cada item: #atual→#destino · faixa · motivo  │
│    Botão de ação inline por linha + "Aplicar    │
│    tudo deste bucket"                           │
├─────────────────────────────────────────────────┤
│ 5. INTELIGÊNCIA DE MERCADO                      │
│    Tamanho ideal · Rotação · Top artistas ·     │
│    Faixas recorrentes · Playlists líderes       │
├─────────────────────────────────────────────────┤
│ 6. TODAS AS FAIXAS  (collapsed por padrão)      │
└─────────────────────────────────────────────────┘
```

**Componentes novos** (em `src/components/playlists/cockpit/`):
- `HeroPerfil.tsx` — capa, nome, score, KPIs, ações principais.
- `IdentidadeBlock.tsx` — nome + descrição lado a lado, atual vs sugerido, com `[Aplicar]` por campo + chips de palavras faltando.
- `PlanoDeAcao.tsx` — 4 cards (REMOVER/REBAIXAR/PROMOVER/ADICIONAR) com quantidade, impacto e motivo resumido. Clique faz scroll para o bucket correspondente.
- `BucketExecucao.tsx` — bloco unificado, recebe `kind` e renderiza linhas no formato `#atual → #destino · track · motivo · [ação]`. Cabeçalho com `[Aplicar todas (N)]`.
- `MercadoBlock.tsx` — grid com os 5 KPIs de mercado.
- `TodasAsFaixasCollapsed.tsx` — wrapper colapsável da tabela existente (`PlaylistTracksTab`).

**Reuso:** mantém `usePlaylistBrain`, `useDiagnoseManagedPlaylist`, `apply-playlist-suggestions`. KPI strip antiga e cards de "Sinais/Recomendações/Identidade/Personalidade/Histórico" saem da rota principal (movidos para uma aba "Auditoria" secundária ou removidos do hero).

**Drawer atual em `MinhasPlaylists.tsx`** vira apenas um link "Abrir cockpit" → navega para `/playlists/:id`. Removemos a lógica duplicada do drawer (cards de sugestão, KPIs, tabela). O botão "Aplicar sugestões" passa a viver dentro do cockpit, por bucket.

## 3. Design system

- Fonte e tokens existentes (Inter, `--primary` verde, `bg #050505`, `card #171717`).
- Hero usa gradiente sutil sobre a capa (`bg-gradient-to-br from-primary/10 to-transparent`).
- Cards de bucket com cor semântica suave:
  - REMOVER → `destructive/15` + borda `destructive/40`
  - REBAIXAR → `warning/10`
  - PROMOVER → `primary/15`
  - ADICIONAR → `primary/20` (mais saturado)
- Cada linha do bucket: badge `#atual → #destino` à esquerda (tabular-nums), faixa+artista no centro, motivo em 1 linha cinza, botão à direita.

## 4. Entrega em 2 passos

**Passo 1 — Backend:** estender `diagnose-managed-playlist/index.ts` com `suggested_description`, `target_position` garantido, `market_insights`, `missing_keywords`, `health_status`. Deploy.

**Passo 2 — Frontend:** criar os 6 componentes do cockpit, reescrever `PlaylistDetail.tsx`, simplificar drawer em `MinhasPlaylists.tsx` (vira link).

## Fora de escopo

- Não mexer em `apply-playlist-suggestions` (já funciona com os 4 buckets).
- Não criar novas tabelas.
- Não mexer em autenticação nem em outras telas (Cérebro, Sistema, Operação geral).
- Aba "Faixas" (`?tab=faixas`) continua existindo como rota auxiliar.

## Confirmação

Posso seguir com Passo 1 (backend) e na sequência Passo 2 (cockpit fullscreen)?
