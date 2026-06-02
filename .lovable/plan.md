# Plano — Padrão "cards de fase" no CRM de Curadores (mobile)

Aplicar o mesmo padrão visual do Playlists/Deals no `CuradoresCRM` **apenas no mobile**, sem sobrepor a barra de filtros já existente e sem mexer em nada de desktop nem em lógica de dados.

## Princípio
Hoje no mobile o CRM tem **3 blocos verticais empilhados** que competem entre si:
1. 4 MiniStats (Total / Não contatados / Enviados / Responderam) — só informativos, não clicáveis.
2. Toolbar (busca + Importar + ⋯).
3. Barra de filtros colapsáveis (Contato/Status/Score/Tamanho).

A ideia é **fundir o bloco 1 com o filtro de Contato** (que tem exatamente os mesmos valores: Todos, Não contatados, Enviados, Aguardando, Responderam). Os MiniStats viram cards-filtro clicáveis no mobile — o número fica visível, o estado ativo controla `contactFilter`, e a página inteira encurta uma linha.

## Mudanças (mobile-only, `sm:hidden`)

### 1. Substituir o grid de MiniStat por grid de cards-filtro
- Trocar o bloco atual `<div className="grid grid-cols-2 md:grid-cols-4 gap-2">` por:
  - Mobile (`sm:hidden`): `grid grid-cols-4 gap-1.5` com 4 cards (Todos / Não contatados / Enviados / Responderam) no mesmo formato dos cards de Playlists — ícone + label curta + número, `rounded-xl border px-1 py-2`, estado ativo com `border-primary/60 bg-primary/10 text-primary`.
  - Clicar no card seta `contactFilter` correspondente (`"todos" | "nao_contatado" | "enviado" | "respondeu"`).
  - Desktop (`hidden sm:grid`): mantém os 4 `MiniStat` originais inalterados (sem virar botão).

Labels curtos (cabem em 4 colunas em 390px):
- Todos · Novos · Enviados · Resp.

Ícones sugeridos (Lucide já usados no projeto): `Users`, `CircleDashed`, `Send`, `MessageSquare`.

### 2. Esconder o chip "Contato" da barra de filtros **só no mobile**
- Como o card já controla esse filtro, o chip "Contato" da barra de filtros vira redundante no mobile.
- Adicionar `hidden sm:inline-flex` no botão do chip `"contato"` (linha 657). Os outros 3 chips (Status, Score, Tamanho) continuam visíveis em todas as larguras.
- No desktop nada muda — chip continua visível e funciona como hoje.

### 3. Compactar a toolbar no mobile (só se sobrar tempo, opcional)
- O botão `Importar` com label texto + ícone ocupa muito espaço no mobile. Sugestão: `<span className="hidden sm:inline">Importar</span>` mantendo só o ícone Upload no mobile.
- Esse passo é puramente cosmético e não muda comportamento. Faço junto se autorizado.

## O que NÃO muda
- Nada na aba **Ativos** (`CuradoresLibraryTab`).
- Nada na aba **Prospecção** desktop (`>= sm`).
- Nenhuma query, hook, schema, tipo ou estado novo.
- A lógica de `filtered`, `stats`, `contactFilter`, paginação, import, follow-up, sheets — tudo intacto.
- `MiniStat` continua existindo (usado no desktop).
- Chip "Status/Score/Tamanho" e painel expansível continuam idênticos.

## Arquivos tocados
- `src/components/operacao/CuradoresCRM.tsx` — bloco 588-594 e linha 651 (props `show` do chip Contato). 2 edições pontuais.

## Risco
Baixo. Tudo é additive/visibility-only no mobile. Se algo desagradar, basta reverter as duas edições — desktop e lógica continuam idênticos.
