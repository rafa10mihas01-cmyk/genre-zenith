---
name: FormModal — padrão único de modal de formulário
description: Todo modal que contém formulário (criar/editar/configurar) deve usar FormModal com ícone tonal, header + body scrollável + footer fixo
type: design
---

Todo modal **que é formulário** (tem inputs/selects/textarea + ação de salvar/criar/aplicar) DEVE usar `FormModal` (`@/components/ui/form-modal`) — nunca `Dialog` cru.

## Estrutura obrigatória

- `title` (substantivo: "Novo curador", "Editar deal", "Encerrar deal")
- `description` (uma linha, contexto/escopo)
- `icon` + `iconTone` da cor de domínio:
  - Clientes → `Users` / `clientes` (azul)
  - Curadores → `UserPlus`/`Pencil` / `curadores` (roxo)
  - Campanhas → `Megaphone` / `campanhas` (âmbar)
  - Deals → `Handshake` / `deals` (verde)
  - Comunidade → `MessageCircle` / `comunidade` (rosa)
  - Playlists → `Music2` / `playlists` (cinza-azul)
  - Sistema/Settings → `Settings` / `sistema` (cinza)
- `size`: `sm` (1 campo), `md` (2-4 campos), `lg` (form com abas), `xl` (raro)
- `footer` com `Cancelar` (variant ghost) à esquerda do botão primário à direita
- `preventClose={saving}` durante submit
- Quando tiver abas, usar `topSlot` com `<TabsList>` estilo underline (não pill default)

## Helpers de layout

- `<FormGrid cols={1|2|3}>` pro grid de campos
- `<FormField label hint required span="full">` envolvendo cada Input/Select/Textarea
- `<FormSection title>` quando precisar agrupar campos em seções

## Proibições

- NÃO usar `<Dialog>+<DialogContent>+<DialogHeader>+<DialogFooter>` cru pra formulário
- NÃO mudar lógica de submit/validação ao migrar — só apresentação
- NÃO usar cores hardcoded; FormModal já aplica tokens
- Dialogs que SÓ exibem conteúdo (viewer/print/timeline/confirm sem inputs) podem continuar como `Dialog` cru — FormModal é só pra formulários

## Migração já feita

ClientesLibraryTab (cliente), NewCuratorDialog, CuratorEditDialog, NewDealDialog, DuplicateDealDialog, CloseDealDialog, NewCampaignDialog.

## Migração pendente (precisa fazer ao tocar nesses modais)

Onda 2: PasteUrlsDialog, AddSongToPlaylistDialog, PastePlaylistsDialog, ImportFromLibraryDialog, SwapPlaylistDialog, PlaylistDailyPlanDialog, PlaylistEditorTab.
Onda 3: CampaignDistributionConsole, ExternalPackageEditor, CampaignAccessManager, CuratorDealAccessManager.
Onda 4: DealPaymentDialog, PedirRemocaoDialog, AlertPreferencesDialog, MaintenanceCalendarDialog, EmailPreviewDialog.
Onda 5: SpotifyAppsManager, EquipeTab, Infraestrutura, Settings, ComunidadeAdmin, CuratorPage.
