# Project Memory

## Core
Design System fixo: bg #050505, sidebar #000, card #111, hover #1A1A1A, primary #1DB954 (verde Spotify), text #FFF / #9CA3AF. Fonte Inter (títulos 600, body 400). Padding página 24px, gap seções 32px, padding card 20px, radius 16px. Sombras quase invisíveis.
Toda página DEVE usar `<PageHeader>` (`@/components/PageHeader`) com title (substantivo) + subtitle (verbo/função). PROIBIDO emojis, saudações, linguagem emocional ou headers customizados.
Todo modal de FORMULÁRIO (criar/editar/configurar com inputs) DEVE usar `FormModal` (`@/components/ui/form-modal`) — nunca `<Dialog>` cru. Header com ícone tonal (cor de domínio) + descrição, body scrollável, footer fixo com Cancelar (ghost) à esquerda do CTA primário. Helpers: `FormGrid`, `FormField`, `FormSection`. Viewer/print/confirm sem inputs podem continuar como `Dialog`.
Logo oficial NexEngine = arquivos em `src/assets/nexengine-*.png` renderizados por `<NexEngineLogo variant="auto|light|dark|mark" />`. Não recriar SVG, não substituir por ícones genéricos. Marca d'água para capas: `src/assets/nexengine-watermark.png`.
Backend é Lovable Cloud (nunca dizer "Supabase" ao usuário).
Edge functions sensíveis (IA cara, Spotify, dados) DEVEM usar `requireTeamAccess` de `_shared/auth.ts` (aceita service_role + admin/curador). Nunca implementar guard local.
Status canônicos: `playlist_templates.status` ∈ {pending, approved, created, archived, rejected}. `replications.status` ∈ {pending, created, error, parcial}. `performance_class` ∈ {alta, media, baixa, NULL}. `quality_tier` ∈ {hot, medium, weak, archived}. Validados por CHECK constraints.
Concorrência do autopilot: unique partial index em `autopilot_runs(genre_id) WHERE status='running'` garante 1 run por gênero. Tratar erro 23505 como lock (HTTP 409).

## Memories
- [Page header pattern](mem://design/page-header-pattern) — Componente PageHeader obrigatório, regras de title/subtitle, proibições
- [Brand assets](mem://design/brand-assets) — Variantes oficiais do logo (light/dark/mark/watermark) e quando usar cada uma
- [FormModal standard](mem://design/form-modal-standard) — Padrão único de modal de formulário (ícone tonal, body scrollável, footer fixo); inventário de migração
- [Glossário Comunidade vs Premium](mem://preference/glossary-comunidade) — Vocabulário público (parceiro/membro/criador) vs interno (curador). Regras de copy e tom da Comunidade beta.
- [Regra de consolidação](mem://preference/consolidation-rule) — Nome ≠ responsabilidade. Antes de DROP, comparar pergunta de negócio. Diferente → renomear. Igual → consolidar.
