## Objetivo
Padronizar: todo botão **"+" / "Adicionar X" / "Novo Y"** das páginas de listagem fica no `PageHeader` (ao lado do botão de atualizar), nunca mais perdido na toolbar do meio.

## Diagnóstico — quem já está OK e quem falta

**Já estão no header (manter como está):**
- `/clientes` → "Novo cliente" ✓
- `/catalogo` → "Adicionar música" ✓
- `/playlist-deals` (Deals) → "Novo deal" ✓
- `/comunidade-admin` → "Novo" ✓

**Falta subir (alvo desta correção):**

| Página | CTA atual | Onde mora hoje |
|---|---|---|
| `/curadores` aba **Ativos** | `+ Novo curador` | `CuradoresLibraryTab` (toolbar de busca/filtro) |
| `/curadores` aba **Prospecção** | `+ Adicionar lead` | `CuradoresCRM` (toolbar interna) |
| `/playlists` (Matriz) | `+ Nova playlist` (se houver) | `MatrizPlaylists` toolbar |
| `/campanhas` | hoje **não tem** botão de criar campanha no header — entra "Nova campanha" se confirmado |

## Plano de execução (sem quebrar nada)

1. **Padrão de "lifting" não-invasivo**
   - Manter o dialog (`NewCuratorDialog`, etc.) onde já vive (dentro do componente filho), **sem** mudar lógica de criação.
   - Adicionar uma prop opcional `addTrigger?: ReactNode` (ou `onAddClick?: () => void`) no componente filho.
   - No filho: se `onAddClick` vier de fora, esconde o "+" da toolbar interna e usa o handler externo para abrir o dialog.
   - No pai (`Prospecao.tsx` etc.): passa `onAddClick` e renderiza um botão "+" no `actions` do `PageHeader`, ao lado do `RefreshCw`.

2. **Mobile**: botão fica `size="icon"` (só ícone `+`, redondo, h-9 w-9). **Desktop**: `+ Novo curador` com texto (mesmo padrão do `/clientes`).

3. **Curadores — duas abas, dois CTAs**
   - O header reage ao `segment` ativo: mostra `+ Novo curador` em Ativos e `+ Adicionar lead` em Prospecção. Nada de dois botões juntos.

4. **Não tocar**:
   - Lógica/validação dos dialogs (`NewCuratorDialog`, `NewDealDialog`, etc.).
   - Páginas que já estão corretas.
   - Botões "+" contextuais dentro de cards (ex: `+` num bucket de playlist) — esses são internos, não viram CTA de página.

## Confirmações que preciso de você

1. **"Nova campanha" no header de `/campanhas`** — hoje não existe esse botão. Quer que eu crie ligando ao `NewCampaignDialog`? Ou prefere deixar criação só pelo fluxo atual (via deal/catálogo)?
2. **`/playlists` (Matriz)** — quer subir o "+ Nova playlist" pro header também? (vou conferir se já existe ou se só tem ações dentro de cada playlist).

Posso seguir com os itens confirmados (Curadores Ativos + Prospecção) e voltar com os outros após sua resposta.