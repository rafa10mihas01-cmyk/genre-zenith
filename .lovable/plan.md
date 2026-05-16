## Problema

A página Hoje hoje mistura dois mundos:

- **Mundo antigo (criação automática):** `playlist_templates` — KPIs "Prontos / Médios", card "Publicar prontos", "Performance (top template)", "Atenção Hoje" (templates sem coleta), "Recomendações IA", "Resumo semanal" (snapshots de templates).
- **Mundo atual (gestão + curadoria):** `managed_playlists`, `playlist_brain`, `curator_brain`, `curator_deals`. Hoje aparecem só como cards pequenos no rodapé ("Alertas Proativos", "Deals Pendentes", "Cérebro Hoje").

Você quer o inverso: ação sobre **suas playlists** em primeiro plano.

## Nova estrutura proposta

```text
┌─────────────────────────────────────────────────────────┐
│  PageHeader: "Hoje" · "O que precisa de ação agora"     │
├─────────────────────────────────────────────────────────┤
│  KPIs DAS MINHAS PLAYLISTS (4 cards grandes)            │
│   • Total gerenciadas      • Em queda (precisa ação)    │
│   • Crescendo              • Sem diagnóstico há 7d+     │
├─────────────────────────────────────────────────────────┤
│  AÇÃO AGORA  (2 colunas)                                │
│   ┌──────────────────────┐  ┌────────────────────────┐ │
│   │ PLAYLISTS EM QUEDA   │  │ DEALS PENDENTES        │ │
│   │ top 5 com pior delta │  │ curador_deals em aberto│ │
│   │ → /catalogo          │  │ → /playlist-deals      │ │
│   └──────────────────────┘  └────────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│  ALERTAS DOS CURADORES                                  │
│   curator_brain severidade alta (já existe)             │
├─────────────────────────────────────────────────────────┤
│  RESUMO SEMANAL DAS MINHAS PLAYLISTS                    │
│   +X seguidores 7d · melhor/pior · baseado em           │
│   playlist_metrics_snapshots filtrado por               │
│   managed_playlists (hoje filtra templates)             │
├─────────────────────────────────────────────────────────┤
│  SAÚDE DO SISTEMA  (compacto, 1 linha)                  │
│   contas Spotify · cérebros desatualizados · últ. coleta│
├─────────────────────────────────────────────────────────┤
│  ▾ MUNDO DE CRIAÇÃO (colapsado por padrão)              │
│    Performance de templates, Publicar prontos,          │
│    Decisão (prontos/médios), Recomendações IA,          │
│    Atenção Hoje (templates sem coleta)                  │
│    → Expande quando você quiser olhar                   │
└─────────────────────────────────────────────────────────┘
```

## O que entra (mundo atual)

1. **KPIs no topo** (substituir os atuais de templates):
   - Gerenciadas total — `managed_playlists` count
   - Em queda — `playlist_brain` com tendência negativa
   - Crescendo — `playlist_brain` com tendência positiva
   - Sem diagnóstico — `managed_playlists.last_diagnosis_at` > 7d ou nulo

2. **Card "Playlists em queda"** — lista top 5 de `playlist_brain` com pior delta de seguidores, link direto pra abrir o diagnóstico.

3. **Resumo Semanal** ajustado pra filtrar `playlist_metrics_snapshots` somente das `managed_playlists` (hoje pega `playlist_templates`).

4. **Manter** Deals Pendentes, Alertas Proativos (curadores), Cérebro Hoje, Saúde Operacional — mas reorganizados na hierarquia acima.

## O que vai pra segundo plano

Bloco colapsável "Mundo de criação" agrupa tudo do fluxo antigo:
- KPIs "Prontos / Médios"
- Card "Publicar prontos"
- Card "Performance" (top template)
- Card "Atenção Hoje" (templates aguardando coleta)
- Card "Recomendações IA" (sugestões de template)
- KPI "Sem dados" (templates publicados sem snapshot)

Fica acessível mas não rouba atenção. Se quiser, em vez de colapsar dá pra mover pra uma sub-rota `/hoje/criacao`.

## Arquivos afetados

- `src/pages/Home.tsx` — reordenar seções, trocar fonte dos KPIs do topo, agrupar mundo antigo em `<details>` colapsável.
- `src/components/home/WeeklySummaryCard.tsx` — filtrar snapshots por `managed_playlists` em vez de `playlist_templates`.
- Novo `src/components/home/ManagedPlaylistsKpis.tsx` — 4 KPIs do topo.
- Novo `src/components/home/PlaylistsInDeclineCard.tsx` — top 5 em queda.

## Pergunta antes de implementar

Você prefere:
- **(A)** Colapsar o mundo de criação dentro da própria página Hoje (um botão "Ver bloco de criação automática" no fim).
- **(B)** Tirar de vez da Hoje e mover pra uma aba/rota separada (ex: `/criacao-automatica`), já que você quase não usa mais.