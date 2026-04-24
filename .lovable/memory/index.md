# Project Memory

## Core
Design System fixo: bg #050505, sidebar #000, card #111, hover #1A1A1A, primary #1DB954 (verde Spotify), text #FFF / #9CA3AF. Fonte Inter (títulos 600, body 400). Padding página 24px, gap seções 32px, padding card 20px, radius 16px. Sombras quase invisíveis.
Toda página DEVE usar `<PageHeader>` (`@/components/PageHeader`) com title (substantivo) + subtitle (verbo/função). PROIBIDO emojis, saudações ("Bom dia", "Olá"), linguagem emocional ou headers customizados.
Logo oficial NexEngine = arquivos em `src/assets/nexengine-*.png` renderizados por `<NexEngineLogo variant="auto|light|dark|mark" />`. Não recriar SVG, não substituir por ícones genéricos. Marca d'água para capas: `src/assets/nexengine-watermark.png`.
Backend é Lovable Cloud (nunca dizer "Supabase" ao usuário).
Edge functions sensíveis (IA/DB caro) DEVEM começar com `requireTeamAccess` de `../_shared/auth.ts`. Service role e admin/curador passam; resto = 401/403. Exceções: spotify-auth (OAuth público), invite-team-member, list-team-emails (auth próprio).
Status canônico de playlist publicada = 'created' (em playlist_templates E replications). Não usar 'published'.
Bucket playlist-covers: leitura pública (Spotify), escrita restrita a team via storage policy.

## Memories
- [Page header pattern](mem://design/page-header-pattern) — Componente PageHeader obrigatório, regras de title/subtitle, proibições
- [Brand assets](mem://design/brand-assets) — Variantes oficiais do logo (light/dark/mark/watermark) e quando usar cada uma
