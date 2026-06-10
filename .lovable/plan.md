## Objetivo

Padronizar TODOS os modais/dialogs/sheets do sistema seguindo o mesmo padrão visual do modal **"Importar planilha de streams"** (limpo, com header bem definido, ícone, descrição, conteúdo respirado e rodapé fixo com ações). Hoje cada modal foi feito de um jeito (alguns sem padding, outros com header gigante cortando, sem rodapé fixo, scroll quebrado, campos espremidos).

Antes de mexer em nada eu listo tudo, defino o padrão e a gente faz em **ondas pequenas** pra você revisar cada uma. Sem mudar lógica de negócio, apenas estrutura visual do modal.

---

## Padrão proposto — `FormModal`

Componente novo em `src/components/ui/form-modal.tsx` que encapsula o shadcn `Dialog` com a estrutura abaixo:

```text
┌─────────────────────────────────────────┐
│ [ícone]  Título do modal           [×] │  ← header fixo (não scrolla)
│          Descrição curta de 1 linha     │
├─────────────────────────────────────────┤
│ [abas opcionais]                        │  ← se houver
├─────────────────────────────────────────┤
│                                         │
│   conteúdo do formulário                │  ← scrolla
│   (campos com label em cima, gap 16)    │
│   grid 2 colunas em ≥sm                 │
│                                         │
├─────────────────────────────────────────┤
│                   [Cancelar] [Confirmar]│  ← rodapé fixo
└─────────────────────────────────────────┘
```

API mínima:

```tsx
<FormModal
  open={open}
  onOpenChange={setOpen}
  icon={<Users className="h-4 w-4" />}
  iconTone="campaigns" // domain color (campaigns/curators/clients/...)
  title="Novo cliente"
  description="Ficha completa do contratante."
  size="md"            // sm | md | lg | xl
  tabs={...}           // opcional
  footer={
    <>
      <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      <Button onClick={onSubmit} disabled={loading}>Criar cliente</Button>
    </>
  }
>
  {/* campos */}
</FormModal>
```

Regras visuais fixas (puxando do Design System já memorizado):
- Padding header `20px`, conteúdo `24px`, footer `16px 24px`.
- Header com fundo `card`, border-bottom `border/60`, ícone `9x9 rounded-lg` com `bg-primary/10 ring-1 ring-primary/20` ou cor de domínio.
- Conteúdo com `max-h-[70vh] overflow-y-auto` (scroll só no meio).
- Rodapé `sticky bottom-0` com fundo `card` e border-top.
- Botão primário sempre à direita, secundário (Cancelar) à esquerda dele.
- Label em cima do input (não inline), `text-[12px] font-medium text-foreground`, gap `6px` pro input.
- Grid `grid-cols-1 sm:grid-cols-2 gap-4` por padrão; campos full-width usam `sm:col-span-2`.
- Mobile: full-screen drawer abaixo de 640px (vira sheet bottom).

Acessibilidade: focus trap (já vem do Radix), Esc fecha, Enter submete quando único botão primário.

---

## Inventário (mapeamento completo)

Encontrei **~50 arquivos** com `DialogContent` / `SheetContent` / `AlertDialogContent`. Separei em 4 categorias.

### 🔵 Categoria A — Formulários de cadastro/edição (alta prioridade, padrão direto)
São os que mais precisam do padrão FormModal:

1. `curators/NewCuratorDialog.tsx` — Novo curador
2. `curators/CuratorEditDialog.tsx` — Editar curador
3. `curators/AddSongToPlaylistDialog.tsx` — Adicionar música
4. `curators/PasteUrlsDialog.tsx` — Colar URLs
5. `campanhas/NewCampaignDialog.tsx` — Nova campanha
6. `playlist-deals/NewDealDialog.tsx` — Novo deal
7. `playlist-deals/CloseDealDialog.tsx` — Fechar deal
8. `playlist-deals/DuplicateDealDialog.tsx` — Duplicar deal
9. `playlist-deals/LogPrintDialog.tsx` — Logar print
10. `playlist-deals/ImportFromLibraryDialog.tsx` — Importar da biblioteca
11. `playlist-deals/PastePlaylistsDialog.tsx` — Colar playlists
12. `financeiro/DealPaymentDialog.tsx` — Pagamento
13. `sistema/PedirRemocaoDialog.tsx` — Pedir remoção
14. `operacao/EmailPreviewDialog.tsx` — Preview email
15. `operacao/MaintenanceCalendarDialog.tsx` — Calendário manutenção
16. `AlertPreferencesDialog.tsx` — Preferências alerta
17. `campaign-hub/SwapPlaylistDialog.tsx` — Trocar playlist
18. **`pages/ClienteDetalhe.tsx`** — Novo cliente (o da imagem, mais bagunçado)
19. `pages/Settings.tsx` (modais inline) — vários
20. `pages/Campanhas.tsx` (modais inline)
21. `pages/Infraestrutura.tsx` (modais inline)
22. `pages/ComunidadeAdmin.tsx` (modais inline)
23. `campanhas/CampaignAccessManager.tsx`
24. `playlist-deals/CuratorDealAccessManager.tsx`
25. `settings/EquipeTab.tsx`
26. `settings/SpotifyAppsManager.tsx`

### 🟢 Categoria B — Visualização/Detalhe (Sheet lateral, padrão derivado)
Pequena adaptação do mesmo padrão, mas em formato Sheet:

27. `curators/CuratorLibrarySheet.tsx`
28. `curators/CuratorLibraryPanel.tsx`
29. `operacao/CuradorDetailSheet.tsx`
30. `playlist-deals/DealHistorySheet.tsx`
31. `playlist-deals/DealLogDetailDialog.tsx`
32. `campanhas/monitoramento/PlaylistHistoryDrawer.tsx`
33. `sistema/fluxo/FluxoNodeDrawer.tsx`
34. `campaign-hub/ProofsTimeline.tsx`
35. `campanhas/monitoramento/ProofThumb.tsx`
36. `playlist-deals/PrintThumbs.tsx`

### 🟡 Categoria C — Tools/Editor (modais maiores, full-screen)
Manter cheios mas aplicar o header padronizado:

37. `campanhas/ExternalPackageEditor.tsx`
38. `campanhas/CampaignDistributionConsole.tsx`
39. `campanhas/PlaylistDailyPlanDialog.tsx`
40. `playlists/PlaylistEditorTab.tsx`
41. `operacao/calculadora/Calculadora.tsx`
42. `operacao/MinhasPlaylists.tsx`
43. `performance/SeoScorePanel.tsx`
44. `playlist-deals/CuradoresTab.tsx`, `ClientesLibraryTab.tsx`, `CuradoresLibraryTab.tsx`, `FinanceiroTab.tsx` (dialogs internos)
45. `pages/CampanhaExecucao.tsx`, `pages/PlanoCampanhaPublico.tsx`, `pages/CuratorPage.tsx`, `pages/comunidade/Campanhas.tsx`

### ⚪ Categoria D — Padronizados ou intencionalmente diferentes (não mexer)
- `ui/dialog.tsx`, `ui/sheet.tsx`, `ui/alert-dialog.tsx`, `ui/command.tsx`, `ui/sidebar.tsx` (primitivos shadcn)
- `PageManual.tsx` (manual de página, padrão próprio recente)
- `client-portal/SpreadsheetUploadCard.tsx` (já é a referência)

---

## Execução em ondas

Pra você revisar entre cada onda:

**Onda 0 — Fundação** (1 PR, sem mexer em nada existente)
- Criar `src/components/ui/form-modal.tsx` com a API acima.
- Adicionar `FormField`, `FormSection`, `FormFooter` como helpers internos.
- Documentar em comentário no topo do arquivo.

**Onda 1 — Categoria A.1 (cadastros mais críticos, 6 modais)**
- `ClienteDetalhe.tsx` (o da imagem)
- `NewCuratorDialog`, `CuratorEditDialog`
- `NewCampaignDialog`, `NewDealDialog`, `CloseDealDialog`

**Onda 2 — Categoria A.2 (cadastros restantes, ~10 modais)**

**Onda 3 — Categoria A.3 (modais inline de páginas, ~6)**

**Onda 4 — Categoria B (sheets/drawers, ~10)** — adaptação do padrão

**Onda 5 — Categoria C (tools/editor, ~10)** — só header/footer, manter conteúdo

Cada onda = só refatoração visual. Zero mudança em hooks, queries, validação, lógica de submit. Os componentes mantêm exatamente os mesmos props externos.

---

## Critérios de aceite (por modal)

- [ ] Header com ícone + título + descrição cabe sem cortar (testar mobile 375px e desktop 1440px).
- [ ] Conteúdo scrolla; header e footer ficam fixos.
- [ ] Botão primário sempre à direita, com cor `primary` (verde).
- [ ] Labels acima dos inputs, nunca inline.
- [ ] Grid 2 colunas no desktop quando faz sentido; 1 coluna no mobile.
- [ ] Submit por Enter funciona quando único botão primário.
- [ ] Esc fecha. Click fora fecha (exceto durante loading).
- [ ] Sem regressão: smoke test em cada modal (abre → preenche → salva → fecha).

---

## O que NÃO entra no escopo

- Lógica de negócio (queries, validações, submits) — fica intocada.
- Mudança de campos do formulário — só apresentação.
- Backend, edge functions, RLS, tabelas.
- Modais já bons: `SpreadsheetUploadCard` (referência), `PageManual`.

---

## Próximo passo

Se aprovar, começo pela **Onda 0** (só criar o `FormModal`, sem mexer em modal existente). Aí você revisa o componente novo isolado e a gente segue pra Onda 1 com os 6 modais mais críticos.

Quer assim? Ou prefere já começar direto pela Onda 1 (Cliente + 5 outros) usando o FormModal recém-criado tudo no mesmo PR?