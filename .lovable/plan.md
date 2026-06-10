# Padronização de todos os modais para `FormModal`

Você está certo — eu criei o componente `FormModal` e migrei só o de Cliente. Tem ~50 dialogs no sistema. Vou migrar **todos os que são formulário** (criar/editar entidade, configuração, ação com inputs), seguindo o mesmo padrão visual do modal de Cliente.

## Critério de migração

**Migra** (é formulário): tem inputs/selects/textarea e botão de salvar/criar/aplicar.
**Não migra** (é viewer/confirm/preview): só mostra conteúdo, confirma ação ou exibe print/timeline. Esses continuam usando `Dialog` puro porque o padrão de header+footer fixo não se aplica.

## Inventário (28 modais de formulário identificados)

### Onda 1 — Operação principal (entidades top-level)
1. `NewCampaignDialog.tsx` — Nova campanha
2. `NewCuratorDialog.tsx` — Novo curador
3. `CuratorEditDialog.tsx` — Editar curador
4. `NewDealDialog.tsx` — Novo deal
5. `DuplicateDealDialog.tsx` — Duplicar deal
6. `CloseDealDialog.tsx` — Fechar deal (tem form de motivo/data)
7. `PlaylistEditorTab.tsx` (dialog interno) — Editar playlist

### Onda 2 — Curadoria & comunidade
8. `PasteUrlsDialog.tsx` — Colar URLs (curadores)
9. `AddSongToPlaylistDialog.tsx`
10. `PastePlaylistsDialog.tsx`
11. `ImportFromLibraryDialog.tsx`
12. `SwapPlaylistDialog.tsx`
13. `PlaylistDailyPlanDialog.tsx`

### Onda 3 — Campanhas & monitoramento
14. `CampaignDistributionConsole.tsx` (dialogs internos de form)
15. `ExternalPackageEditor.tsx`
16. `CampaignAccessManager.tsx` (form de adicionar acesso)
17. `CuratorDealAccessManager.tsx` (form de adicionar acesso)

### Onda 4 — Financeiro & sistema
18. `DealPaymentDialog.tsx` — Registrar pagamento
19. `PedirRemocaoDialog.tsx` — Pedido de remoção
20. `AlertPreferencesDialog.tsx` — Preferências de alerta
21. `MaintenanceCalendarDialog.tsx` (se tiver form)
22. `EmailPreviewDialog.tsx` (se tiver form de envio)

### Onda 5 — Settings & infra
23. `SpotifyAppsManager.tsx` (form de adicionar app)
24. `EquipeTab.tsx` (form de convidar membro)
25. `Infraestrutura.tsx` (dialogs de form)
26. `Settings.tsx` (dialogs de form)
27. `ComunidadeAdmin.tsx` (dialogs de form)
28. `CuratorPage.tsx` (dialogs de form, se houver)

### Fica de fora (não é formulário)
- `LogPrintDialog`, `DealLogDetailDialog`, `PrintThumbs`, `ProofThumb`, `ProofsTimeline`, `PlanoCampanhaPublico` (viewer), `Calculadora` (UI completa custom).

## Padrão aplicado a cada modal

Pra cada um, a mudança é mecânica e **só visual** — zero alteração de lógica/submit/validação:

- Trocar `Dialog`+`DialogContent`+`DialogHeader`+`DialogFooter` por `<FormModal>`.
- Mover título/descrição pra props `title`/`description`.
- Adicionar `icon` + `iconTone` da cor de domínio (clientes=azul, curadores=roxo, campanhas=âmbar, deals=verde, comunidade=rosa, playlists=cinza-azul, sistema=cinza).
- Mover botões Cancelar/Confirmar pra prop `footer` (botão primário à direita).
- Quando tiver abas, mover `<TabsList>` pra prop `topSlot` com estilo underline (igual ao Cliente).
- Substituir grids manuais de campos por `<FormGrid cols={1|2}>` + `<FormField label hint>`.
- `preventClose={saving}` durante submit.
- `size` conforme densidade: `sm` (1 campo), `md` (2-4 campos), `lg` (form com abas), `xl` (raro).

## Detalhe técnico

- O `FormModal` já existe em `src/components/ui/form-modal.tsx` com `FormGrid`, `FormField`, `FormSection`. Não precisa criar nada novo.
- Headers/footers ficam fixos; só o miolo scrolla — resolve o problema do modal gigante que não cabia na tela.
- Tokens (`bg-card`, `border-border/60`, `text-foreground`, `text-muted-foreground`) — não introduzir cor hardcoded.

## Entrega

Vou executar **as 5 ondas em sequência num único turno**, em paralelo dentro de cada onda quando possível, e te aviso ao final com a lista do que mudou. Se algum modal tiver lógica fora do padrão (ex: stepper multi-passo), eu mantenho a estrutura interna e só troco o wrapper — sem mexer no comportamento.

Confirma que quero seguir com todos os 28 ou prefere que eu faça primeiro a Onda 1 pra você validar o padrão antes?