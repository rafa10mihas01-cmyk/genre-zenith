# NexEngine

Plataforma de distribuição editorial para músicas no Spotify. Liga artistas e
labels (clientes) a curadores de playlists, gerencia campanhas de distribuição,
coleta provas de entrega via bot e mostra o progresso em portais públicos para
o cliente e para o curador.

## Fluxo principal

```
Cliente cadastrado
   └─► Campanha criada (faixa + meta de plays + deadline)
        └─► Plano aprovado (alocação por playlist própria + posições)
             └─► Deal com curador externo (quando precisa de inventário fora)
                  └─► Bot coleta plays (Spotify Web API + Playwright)
                       └─► Portal mostra resultado (cliente e curador)
```

## Tabelas principais

| Tabela | O que é |
|---|---|
| `campaigns` | Plano de distribuição de uma faixa para um cliente. |
| `curator_deals` | Transação com um curador externo (preço, prazo, escopo). |
| `managed_playlists` | Playlists próprias da plataforma (inventário interno). |
| `curator_playlists` | Playlists de curadores vinculadas a um deal específico. |
| `campaign_eco_allocations` | Distribuição da meta da campanha por playlist interna. |
| `curator_deal_snapshots` | Plays coletados por playlist por evento de coleta do bot. |
| `managed_playlist_tracks` | Músicas atualmente presentes em cada playlist interna. |
| `delivery_proofs` | Registro imutável de cada coleta do bot (auditoria). |
| `editorial_history` | Histórico dos tops-8 gerados por gênero pelo motor editorial. |
| `search_tracks` | Faixas coletadas do Spotify por gênero/termo (pool de descoberta). |

## Documentação

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — fluxo de dados, modelos de playlist, decisões arquiteturais.
- [docs/BOT_VPS_CONTRACT.md](docs/BOT_VPS_CONTRACT.md) — contrato entre a plataforma e o bot Playwright no VPS.
- [docs/OPS_AGENT_CONTRACT.md](docs/OPS_AGENT_CONTRACT.md) — contrato do agente de operação.

## Stack

- **Frontend:** React 18 + Vite + Tailwind CSS + shadcn/ui
- **Backend:** Supabase (PostgreSQL + Edge Functions Deno)
- **Bot:** VPS externo com Playwright
- **Coleta:** Spotify Web API
