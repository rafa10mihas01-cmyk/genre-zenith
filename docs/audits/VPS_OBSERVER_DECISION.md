# FASE 6.B.5 — Decisão Arquitetural Final do VPS Observer

**Modo:** read-only. Sem alteração de código ou banco.
**Data:** 2026-06-18.
**Antecedentes:** Fases 6.B.3 e 6.B.4 (`VPS_OBSERVER_FORENSICS.md`, `VPS_OBSERVER_IMPLEMENTATION_FORENSICS.md`).

---

## RESUMO EXECUTIVO

| Pergunta | Resposta |
|---|---|
| 1. O Observer está incompleto? | **SIM.** Produtor ativo desde 13/06; consumidor (`diagnose-managed-playlist`) nunca foi implementado. |
| 2. Vale a pena concluir a integração? | **SIM, parcialmente** — opção **C**. Concluir o consumo de `observer_playlist_tracks` em `diagnose-managed-playlist` e em um futuro `competitive-saturation`. Não criar "brain de observação" novo. |
| 3. Benefício concreto? | Diagnose ganha **pool de candidatos 16× maior** (6.904 tracks observed × 412 search_tracks/90d) e — pela primeira vez — visibilidade de **saturação real em playlists 3rd-party** (não inferida por benchmark estatístico). |
| 4. Prejuízo se nunca for concluída? | **Baixo no curto prazo, alto no médio.** Pagamos coleta diária (PM2 + DOM scraping de 453 playlists) sem retorno; diagnose continua dependente de `genre_benchmarks` (apenas **8 linhas** hoje) e `search_tracks` (apenas **412 tracks/90d**) — base estatística frágil. |

---

## ITEM 1 — Problema de negócio resolvido pela integração

O diagnose hoje responde "esta playlist está saudável?" usando:

1. Percentis estatísticos de `genre_benchmarks` (followers/tracks por gênero) — base com **8 linhas no banco hoje**.
2. Pool de tracks recentes de `search_tracks` (descoberta via Spotify search) — **412 tracks únicos nos últimos 90 dias**.
3. Tracklist própria em `managed_playlist_tracks`.

Nenhuma dessas fontes responde:

- **Quais músicas estão entrando/saindo em playlists concorrentes vivas neste momento?**
- **Quais tracks estão SATURADAS** (em N playlists simultaneamente no nicho)?
- **Qual a janela de novidade real** do nicho (idade média das tracks que concorrentes vivos estão adicionando)?

Hoje a NexEngine só vê o que ela mesma curou ou o que o Spotify Search devolve. Não vê o **inventário ativo dos competidores**. O Observer foi criado exatamente pra preencher esse buraco e o consumidor nunca foi escrito.

---

## ITEM 2 — O que mudaria no resultado do diagnose

Exemplos concretos com números reais do banco:

| Cenário | Hoje (sem observer) | Com observer_playlist_tracks integrada |
|---|---|---|
| Pool de candidatos no gênero X | até **5.000** tracks de `search_tracks` (na prática **412 únicas/90d**) | acrescenta **6.904 tracks únicas/30d** vindas de **453 playlists 3rd-party reais** |
| Detecção de saturação ("essa track já está em quantas playlists do nicho?") | **impossível** — `search_tracks` não relaciona track↔playlist | **direta** — `COUNT(DISTINCT spotify_playlist_id) WHERE spotify_track_id = X` |
| Recomendar adicionar track Y | baseado em popularidade + match de gênero | acrescenta sinal "Y aparece em 12 playlists concorrentes do nicho com followers > N" |
| Detectar churn de concorrente | invisível | `captured_date` permite ver track que **saiu** de uma 3rd-party entre D-1 e D |
| Calibrar `genre_benchmarks` | manual / curado (8 linhas) | recalcular percentis com universo de 453 playlists observadas |

**Overlap real medido:** **53 playlists** em `observer_playlist_tracks` também existem em `managed_playlists` — ou seja, parte do dado coletado pelo VPS hoje espelha playlists próprias e poderia até substituir `snapshot-playlist-tracks` (chamada Spotify) como fonte de verdade para essas linhas. As 400 restantes são **inteligência competitiva pura** que hoje vai pro lixo.

---

## ITEM 3 — Informação exclusiva em `observer_playlist_tracks`

| Campo | Por que é único | Onde NÃO existe |
|---|---|---|
| `(spotify_playlist_id, spotify_track_id, position, captured_date)` por playlist 3rd-party | Tracklist completa de playlists **não-gerenciadas** ao longo do tempo | `managed_playlist_tracks` só tem playlists próprias; `search_tracks` não amarra a playlist; `playlist_track_snapshots` cobre apenas managed |
| `position` em playlist 3rd-party | Posição real (1..N) em playlist de competidor | nenhuma outra tabela |
| `captured_date` com UNIQUE diário | Histórico de entrada/saída de track em playlist 3rd-party | `observed_playlist_snapshots` só tem metadados agregados (`track_count`, `followers`), não a lista |
| `album_cover_url` por track via DOM | Capa real renderizada pelo Spotify Web (não API) | só duplica Spotify API — utilidade marginal |
| `correlation_id` ligando run × ingestão | Auditoria de qual run do bot trouxe qual linha | nenhuma outra tabela |

Os campos `name`, `artist`, `duration_ms` **duplicam** `spotify_track_cache` — não são exclusivos, apenas redundância tolerada.

---

## ITEM 4 — Perda se a tabela fosse removida hoje

**NÃO.** O diagnose atual não perde nenhuma capacidade, porque nunca a usou. `rg -n observer_playlist_tracks supabase/functions/diagnose-managed-playlist/` retorna zero matches.

**Mas:** perde-se a única evidência de saturação 3rd-party já coletada (18.009 linhas / 453 playlists / 6.904 tracks únicos em 3 dias). Recoletar custa tempo de bot e o gap histórico é permanente.

---

## ITEM 5 — A implementação ainda faz sentido?

**Opção C — Parcialmente.**

Justificativa baseada em evidências:

- **A favor de concluir:** o problema de negócio (saturação real, candidatos vivos) continua existindo e nenhuma outra fonte da arquitetura atual o resolve. `genre_benchmarks` (8 linhas) e `search_tracks` (412 únicas/90d) são frágeis demais pra carregar o diagnose sozinhos. O VPS já paga o custo da coleta.
- **Contra criar o "brain de observação" descrito em `VPS_SOURCE_MATRIX.md`:** seria mais um módulo separado quando o consumidor natural já existe (`diagnose-managed-playlist`). A arquitetura evoluiu para concentrar inteligência no diagnose + brain de curadores/playlist, não em um sistema paralelo.
- **Contra reabrir tudo:** o commit fonte (`fd02d284`) já ligou o gatilho de re-diagnose. O que falta é só **leitura nas duas/três queries certas**, não um pipeline novo.

Portanto: aproveitar **a tabela e o gatilho existentes**, descartar a ideia de "brain de observação" autônomo, e ler `observer_playlist_tracks` direto dentro de `diagnose-managed-playlist` (e de um futuro relatório de saturação).

---

## ITEM 6 — O que concluir (sem código)

### Consumidor primário: `supabase/functions/diagnose-managed-playlist/index.ts`

Ponto de inserção: o bloco `load_model_benchmark_competitors` (linhas 517-535), logo antes do `fetchPool(90)` em `search_tracks`.

**Consultas que faltam:**

1. **Pool ampliado de candidatos do nicho** (substituir/complementar `search_tracks`):
   - Selecionar `spotify_track_id, name, artist, MAX(captured_date)` de `observer_playlist_tracks` filtrando por `spotify_playlist_id IN (SELECT … FROM observed_playlists WHERE genre_id = pl.genre_id)` nos últimos 30/60/90 dias.
   - Resultado novo: pool de até **6.904 candidatos vivos/30d** em vez de 412.

2. **Score de saturação por track**:
   - `SELECT spotify_track_id, COUNT(DISTINCT spotify_playlist_id) AS in_n_playlists FROM observer_playlist_tracks WHERE captured_date > now() - 14 days AND <filtro de gênero> GROUP BY 1`.
   - Resultado novo: campo `saturation_n` no diagnose. Recomendação "adicionar track X" passa a ser penalizada se X já está em ≥k playlists do nicho.

3. **Churn de competidor (sinal de oportunidade)**:
   - Diferença entre `captured_date = today` e `captured_date = today-1` para `spotify_playlist_id` específico → tracks que saíram de playlists concorrentes. Sinal "vaga aberta no concorrente Y".

### Consumidor secundário (opcional, futuro): novo `competitive-saturation`

Job diário lê `observer_playlist_tracks` e materializa `genre_saturation_daily` (por gênero × track × dia). `diagnose` lê dessa view materializada em vez de agregar em runtime.

### Ganhos operacionais mensuráveis

- Pool de candidatos **16× maior** (6.904 vs 412) → menos `coverage_low`.
- `genre_benchmarks` (8 linhas hoje) deixa de ser o único calibrador.
- Primeira métrica de saturação real do produto.
- Aproveitamento do investimento já feito em PM2 + scraping (custo afundado vira ROI).

---

## ITEM 7 — Não aplicável (decisão foi C, não B)

---

## CONCLUSÃO

1. **O Observer está incompleto?** SIM. Produtor + gatilho estão vivos; consumidor nunca foi escrito.
2. **Vale a pena concluir?** SIM, parcialmente (opção C). Ler `observer_playlist_tracks` dentro do `diagnose-managed-playlist` existente. Não criar "brain de observação" autônomo.
3. **Benefício concreto:** pool de candidatos 16× maior, primeira métrica de saturação 3rd-party real, calibração de `genre_benchmarks` deixa de depender de 8 linhas curadas.
4. **Prejuízo de nunca concluir:** baixo no curto prazo (nada quebra), alto no médio — pagamos coleta diária sem ROI e o diagnose continua refém de `genre_benchmarks`/`search_tracks` cuja base é estatisticamente frágil (8 linhas / 412 tracks-90d).

**Decisão arquitetural:** concluir a integração com escopo mínimo (3 queries dentro do diagnose existente). Postergar qualquer "brain de observação" autônomo.
