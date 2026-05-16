# Wave 3 — Execução Assistida + Tracking de Impacto

Wave 1 entregou raio-x **por faixa**. Wave 2 entregou raio-x **por playlist** + recomendações read-only. Wave 3 fecha o loop: **agir sobre as recomendações** sem sair do app e **medir se a ação funcionou**.

Continua tudo determinístico, sem ML. Humano continua no comando — só ganha botão.

---

## 0. Crons da Wave 2 (pré-requisito)

Antes de começar Wave 3, ativar crons que faltaram:
- `calculate-track-ecosystem-score` → diário 04:00 BRT
- `calculate-playlist-ecosystem-score` → diário 04:30 BRT
- `calculate-track-playlist-fit` → diário 05:00 BRT

Tabela `cron_jobs` no painel Sistema → Configurações (já existe infraestrutura).

---

## 1. Ações na tela de Recomendações

Hoje cada card tem só **Ver evidência / Marcar como vista / Descartar**. Adicionar:

- **"Criar deal a partir desta sugestão"** (recommendation_kind = `adicionar`)
  → Abre o `NewDealDialog` já existente, pré-preenchido com: curador alvo, faixa, playlist alvo.
  → Usuário confirma valores e fecha. Cria deal normal no fluxo de Playlist Deals.
  → Grava `recommendation_feedback.action = 'converted_to_deal'` + `deal_id`.

- **"Pedir remoção ao curador"** (recommendation_kind = `remover`)
  → Abre dialog que gera mensagem template ("Olá Fulano, podemos remover a faixa X da playlist Y?") com botão copiar.
  → Grava feedback `action = 'removal_requested'`.

- **"Abrir no Spotify"** → link direto pra playlist (já temos `spotify_url`).

Sem execução silenciosa. Toda ação passa por confirmação humana.

## 2. Tabela `recommendation_outcome`

Pra medir se a sugestão funcionou:

- `fit_id` (FK track_playlist_fit)
- `outcome_kind`: `added` | `removed` | `ignored` | `pending`
- `detected_at`: quando o sistema notou a mudança real no Spotify (faixa entrou/saiu da playlist)
- `streams_before_28d`, `streams_after_28d`
- `impact_delta_pct`: variação real após a ação
- `verdict`: `acertou` | `errou` | `inconclusivo` (calculado 28 dias após a ação)

Edge function `detect-recommendation-outcomes` roda 1x/dia e cruza:
- snapshot atual de `curator_playlists` vs sugestões com `recommendation_feedback`
- se faixa apareceu/sumiu da playlist → marca `detected_at`
- depois de 28 dias compara streams e dá veredito

## 3. Aba `/sistema?tab=impacto`

Dashboard pra fechar o ciclo de aprendizado:

- **KPIs no topo**: sugestões geradas / convertidas em ação / detectadas no Spotify / com veredito positivo
- **Taxa de acerto por tipo**: `adicionar` X%, `remover` Y%
- **Taxa de acerto por tag de motivo**: `genre_match` X%, `gap_de_repertorio` Y%
- **Lista**: últimas 20 sugestões já com veredito, mostrando antes/depois
- **Curadores ranqueados** por taxa de conversão (quem mais aceita nossas sugestões)

Esses dados depois alimentam o ajuste dos thresholds do `calculate-track-playlist-fit` (Wave 4: auto-tuning de pesos).

## 4. Integração com Playlist Deals existente

Quando um deal é criado a partir de uma sugestão:
- `curator_deals.source = 'recommendation'`
- `curator_deals.source_fit_id` → link de volta
- No detalhe do deal, mostrar badge **"Originado de recomendação"** + link pro card

Quando o deal fecha e a faixa entra na playlist, o `detect-recommendation-outcomes` automaticamente fecha o ciclo.

## 5. Notificação proativa (opcional, leve)

Se uma recomendação com `fit_score >= 90` e `confidence >= 0.8` aparecer, dispara card no Home (`ProactiveAlertsCard` já existe) com:
- "3 sugestões de alto fit aparecidas hoje"
- Link direto pra `/sistema?tab=recomendacoes&min_fit=90`

Sem email/push nessa wave — só in-app.

---

## Detalhes técnicos

```text
Wave 3 architecture
───────────────────
recommendation card (UI)
   ├─ "Criar deal" ──► NewDealDialog (pré-preenchido)
   │                       └─► curator_deals (source='recommendation')
   ├─ "Pedir remoção" ──► template dialog (copy/paste)
   └─ "Descartar" ──► recommendation_feedback

cron detect-recommendation-outcomes (1x/dia)
   ├─ varre recommendation_feedback com action ∈ {converted_to_deal, removal_requested}
   ├─ cruza com curator_playlists atual (faixa entrou/saiu?)
   ├─ atualiza recommendation_outcome.detected_at
   └─ se passou 28d desde detected_at → calcula impact_delta_pct + verdict

aba Impacto (UI)
   └─ lê recommendation_outcome agregado → dashboard
```

Tabelas novas: `recommendation_outcome`. Tabelas alteradas: `curator_deals` (+2 colunas), `recommendation_feedback` (já existe).

---

## Fora de escopo nessa Wave

- ❌ Auto-tuning de pesos via ML (Wave 4)
- ❌ Execução automática sem confirmação humana
- ❌ Notificações email/push
- ❌ Bot do Spotify entrando em playlist sozinho

---

## Sequência de entrega

1. Ativar crons da Wave 2 (5 min)
2. Migração: `recommendation_outcome` + colunas em `curator_deals`
3. Botão "Criar deal" no card de recomendação + integração com `NewDealDialog`
4. Botão "Pedir remoção" + dialog template
5. Edge function `detect-recommendation-outcomes`
6. Aba `/sistema?tab=impacto`
7. Badge "Originado de recomendação" em Playlist Deals
8. (Opcional) Card no Home com sugestões de alto fit

Posso começar pelos crons + migração?
