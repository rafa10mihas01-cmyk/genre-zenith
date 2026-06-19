// ClientesLibraryTab — biblioteca de clientes (artistas/labels contratantes).
// Espelha o visual da CuradoresLibraryTab para manter o padrão da página.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  User,
  Music2,
  Clock,
  Plus,
  Pencil,
  ExternalLink,
  Copy,
  Link2,
  MoreHorizontal,
  Archive,
  ArchiveRestore,
  Trash2,
  Users,
} from "lucide-react";
import { FormModal, FormGrid, FormField } from "@/components/ui/form-modal";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusDot, type StatusVariant } from "@/components/ui/status-dot";
import { MetricCell } from "@/components/ui/metric-cell";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { useClients, type Client } from "@/hooks/useClients";
import { clientCampaignUrl } from "@/lib/curatorPublicUrl";
import { cn } from "@/lib/utils";
import type { CuratorDeal, CuratorDealSong } from "@/lib/curatorDealsUtils";
// Select já importado abaixo

type ClientSongRow = CuratorDealSong & {
  client_id?: string | null;
  client_token?: string | null;
  smartlink_url?: string | null;
};

export type ClientCampaignRow = {
  id: string;
  client_id: string | null;
  status: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at?: string | null;
  track_name?: string | null;
  deal_id?: string | null;
};
export type ClientCampaignsMap = Map<string, ClientCampaignRow[]>;

type StatusFilter = "all" | "active" | "idle" | "archived";
type SortBy = "activity" | "alpha";

const CLOSED_CAMPAIGN_STATUSES = new Set([
  "completed",
  "cancelled",
  "canceled",
  "archived",
  "closed",
]);
const isCampaignClosed = (c: ClientCampaignRow) =>
  !!c.closed_at || CLOSED_CAMPAIGN_STATUSES.has((c.status ?? "").toLowerCase());

interface Props {
  deals: CuratorDeal[];
  songs: ClientSongRow[];
  loading: boolean;
  campaignsByClient?: ClientCampaignsMap;
}


export function ClientesLibraryTab({ deals, songs, loading, financeByClient }: Props) {
  const navigate = useNavigate();
  const { clients, loading: loadingClients, addClient, updateClient, archiveClient, deleteClient, reload, isEnriching } = useClients();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Client | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ client: Client; hasLinks: boolean } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("activity");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 24;
  const archivedCount = clients.filter((c) => !!c.archived_at).length;
  const showArchived = statusFilter === "archived";

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, sortBy]);

  // Permite abrir o modal "Novo cliente" via evento global (botão + Novo do header)
  useEffect(() => {
    const handler = () => setCreating(true);
    window.addEventListener("playlistdeals:new-client", handler);
    return () => window.removeEventListener("playlistdeals:new-client", handler);
  }, []);

  const dealById = useMemo(() => {
    const m = new Map<string, CuratorDeal>();
    for (const d of deals) m.set(d.id, d);
    return m;
  }, [deals]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const enriched = clients
      .filter((c) => (showArchived ? !!c.archived_at : !c.archived_at))
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          (c.contact ?? "").toLowerCase().includes(q),
      )
      .map((c) => {
        const clientSongs = songs.filter((s) => s.client_id === c.id);
        const dealIds = new Set(clientSongs.map((s) => s.deal_id));
        const clientDeals = Array.from(dealIds)
          .map((id) => dealById.get(id))
          .filter(Boolean) as CuratorDeal[];
        const activeDeals = clientDeals.filter((d) => !d.closed_at).length;
        const closedDeals = clientDeals.filter((d) => !!d.closed_at).length;
        const lastTs = clientSongs.reduce<number>((acc, s) => {
          const t = new Date(s.created_at).getTime();
          return Number.isFinite(t) && t > acc ? t : acc;
        }, 0);
        const invested = clientDeals.reduce((acc, d) => acc + (Number(d.cost) || 0), 0);
        const fin = financeByClient?.get(c.id) ?? EMPTY_FIN;
        return {
          client: c,
          songs: clientSongs,
          totalSongs: clientSongs.length,
          activeDeals,
          closedDeals,
          totalDeals: clientDeals.length,
          lastTs,
          invested,
          revenue: fin.recebido,
          pending: fin.pendente,
        };
      })
      .filter((row) => {
        if (statusFilter === "active") return row.activeDeals > 0;
        if (statusFilter === "idle") return row.activeDeals === 0;
        return true; // all | archived (já filtrado acima)
      });

    enriched.sort((a, b) => {
      if (sortBy === "invested") return b.invested - a.invested;
      if (sortBy === "revenue") return b.revenue - a.revenue;
      if (sortBy === "alpha") return a.client.name.localeCompare(b.client.name, "pt-BR");
      // activity default
      if (a.activeDeals !== b.activeDeals) return b.activeDeals - a.activeDeals;
      return b.lastTs - a.lastTs;
    });
    return enriched;
  }, [clients, songs, dealById, query, showArchived, statusFilter, sortBy, financeByClient]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2 lg:gap-3 flex-nowrap lg:flex-wrap">
        <div className="relative flex-1 min-w-0 lg:min-w-[200px] lg:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={showArchived ? "Buscar arquivados…" : "Buscar cliente…"}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="h-9 flex-1 min-w-0 lg:flex-none lg:w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os ativos</SelectItem>
            <SelectItem value="active">Com deal ativo</SelectItem>
            <SelectItem value="idle">Sem atividade</SelectItem>
            <SelectItem value="archived">Arquivados{archivedCount > 0 ? ` (${archivedCount})` : ""}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
          <SelectTrigger className="h-9 flex-1 min-w-0 lg:flex-none lg:w-[170px]">
            <SelectValue placeholder="Ordenar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="activity">Mais ativos</SelectItem>
            <SelectItem value="invested">Maior investido</SelectItem>
            <SelectItem value="revenue">Maior receita</SelectItem>
            <SelectItem value="alpha">Alfabético</SelectItem>
          </SelectContent>
        </Select>
      </div>


      {(loading || loadingClients) && rows.length === 0 ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[88px] rounded-2xl border border-border/50 bg-card skeleton-fade" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center">
          <User className="mx-auto size-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground mb-4">
            {query ? "Nenhum cliente encontrado." : "Sem clientes."}
          </p>
          {!query && (
            <Button
              size="sm"
              className="rounded-full gap-1.5"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-4 w-4" /> Cadastrar primeiro cliente
            </Button>
          )}
        </Card>
      ) : (
        (() => {
          const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
          const currentPage = Math.min(page, totalPages);
          const start = (currentPage - 1) * PAGE_SIZE;
          const pageRows = rows.slice(start, start + PAGE_SIZE);
          return (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {pageRows.map((row) => {
            const { client, totalSongs, activeDeals, closedDeals, totalDeals, lastTs, invested, pending } = row;
            const initials = client.name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((s) => s[0]?.toUpperCase())
              .join("");

            const status: { variant: StatusVariant; label: string } =
              activeDeals > 0
                ? { variant: "success", label: `${activeDeals} ativo${activeDeals > 1 ? "s" : ""}` }
                : totalDeals > 0
                ? { variant: "neutral", label: "Sem deals ativos" }
                : { variant: "neutral", label: "Sem deals" };

            return (
              <div
                key={client.id}
                onClick={() => navigate(`/clientes/${client.id}`)}
                style={{ contentVisibility: "auto", containIntrinsicSize: "320px 260px" }}
                className={cn(
                  "group relative rounded-2xl border border-border/50 bg-card transition-colors cursor-pointer flex flex-col",
                  "border-l-2 border-l-domain-clients/60",
                  "hover:border-foreground/20 hover:border-l-domain-clients hover:bg-[hsl(var(--elevated))]",
                )}
              >
                {/* Identidade */}
                <div className="flex items-start gap-3 px-4 pt-4 pb-3 min-w-0">
                  <div className="h-11 w-11 rounded-md bg-domain-clients/15 border border-domain-clients/25 flex items-center justify-center text-[13px] font-bold text-domain-clients shrink-0">
                    {initials || <User className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-foreground truncate leading-tight flex items-center gap-1.5">
                      <span className="truncate">{client.name}</span>
                      {isEnriching(client.id) && (
                        <span className="shrink-0 rounded border border-domain-clients/40 bg-domain-clients/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-domain-clients animate-pulse">
                          enriquecendo
                        </span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground truncate mt-0.5 tabular-nums">
                      <span className="text-foreground/80 font-medium">{formatBRLShort(invested)}</span>
                      <span className="mx-1.5 opacity-50">·</span>
                      <span>
                        {pending > 0 ? (
                          <span className="text-warning">{formatBRLShort(pending)} pendente</span>
                        ) : (
                          <span>sem pendência</span>
                        )}
                      </span>
                    </div>
                    <div className="mt-2">
                      <StatusDot variant={status.variant} label={status.label} />
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0 -mr-1.5"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Mais ações"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-44 rounded-xl p-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenuItem
                        className="gap-2 rounded-lg"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/clientes/${client.id}`);
                        }}
                      >
                        <Music2 className="h-4 w-4" /> Ver músicas
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="gap-2 rounded-lg"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(client);
                        }}
                      >
                        <Pencil className="h-4 w-4" /> Editar
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {!client.archived_at ? (
                        <DropdownMenuItem
                          className="gap-2 rounded-lg"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm(`Arquivar ${client.name}? Ele sai da biblioteca mas o histórico fica.`)) return;
                            try {
                              await archiveClient(client.id, true);
                              toast.success("Cliente arquivado");
                            } catch {
                              toast.error("Erro ao arquivar");
                            }
                          }}
                        >
                          <Archive className="h-4 w-4" /> Arquivar
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          className="gap-2 rounded-lg"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await archiveClient(client.id, false);
                              toast.success("Cliente restaurado");
                            } catch {
                              toast.error("Erro ao restaurar");
                            }
                          }}
                        >
                          <ArchiveRestore className="h-4 w-4" /> Restaurar
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="gap-2 rounded-lg text-destructive focus:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete({ client, hasLinks: totalSongs > 0 || totalDeals > 0 });
                        }}
                      >
                        <Trash2 className="h-4 w-4" /> Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="mx-4 border-t border-border/40" />

                {/* Métricas */}
                <div className="flex items-center gap-4 px-4 py-3 min-w-0 mt-auto">
                  <MetricCell label="Músicas" value={totalSongs} size="sm" />
                  <MetricCell label="Negociações" value={totalDeals} size="sm" />
                  {closedDeals > 0 && (
                    <MetricCell label="Concluídos" value={closedDeals} size="sm" />
                  )}
                  {lastTs > 0 && (
                    <span className="ml-auto inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground shrink-0">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(lastTs), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </span>
                  )}
                </div>
              </div>
            );
                })}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-[12px] text-muted-foreground">
                    {start + 1}–{Math.min(start + PAGE_SIZE, rows.length)} de {rows.length}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={currentPage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Anterior
                    </Button>
                    <span className="text-[12px] text-muted-foreground px-2 tabular-nums">
                      {currentPage} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Próxima
                    </Button>
                  </div>
                </div>
              )}
            </>
          );
        })()
      )}

      {/* Detalhe do cliente vive em /clientes/:id — sem drawer aqui. */}

      {/* Dialog — criar / editar */}
      <ClientFormDialog
        open={creating || editing !== null}
        client={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={async (input) => {
          try {
            if (editing) {
              await updateClient(editing.id, input);
              toast.success("Cliente atualizado");
            } else {
              await addClient(input);
              toast.success("Cliente criado");
            }
            await reload();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao salvar cliente");
          }
        }}
      />

      {/* AlertDialog — confirmação de exclusão */}
      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.hasLinks
                ? `${confirmDelete.client.name} possui músicas/deals vinculados. A exclusão desvincula o cliente, mas o histórico permanece. Esta ação não pode ser desfeita.`
                : `${confirmDelete?.client.name} será removido permanentemente. Esta ação não pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!confirmDelete) return;
                try {
                  await deleteClient(confirmDelete.client.id);
                  toast.success("Cliente excluído");
                  setConfirmDelete(null);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Erro ao excluir");
                }
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ClientDetailContent({
  client,
  songs,
  deals,
  onEdit,
}: {
  client: Client;
  songs: ClientSongRow[];
  deals: CuratorDeal[];
  onEdit: () => void;
}) {
  const dealById = useMemo(() => {
    const m = new Map<string, CuratorDeal>();
    for (const d of deals) m.set(d.id, d);
    return m;
  }, [deals]);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado", { description: url });
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  return (
    <>
      <SheetHeader className="space-y-1.5">
        <SheetTitle className="text-xl">{client.name}</SheetTitle>
        <SheetDescription>
          {client.contact || "Sem contato cadastrado"}
        </SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-6">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
            Músicas vinculadas
          </div>
          <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Editar dados
          </Button>
        </div>

        {songs.length === 0 ? (
          <Card className="p-8 text-center">
            <Music2 className="mx-auto size-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">
              Sem músicas vinculadas.
            </p>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {songs.map((s) => {
              const deal = dealById.get(s.deal_id);
              const url = (s.slug || s.client_token)
                ? clientCampaignUrl({ slug: s.slug ?? null, client_token: s.client_token ?? null })
                : null;
              const shareUrl = url;
              return (
                <Card key={s.id} className="overflow-hidden">
                  <CardContent className="p-4 flex items-center gap-3 min-w-0">
                    <div className="h-12 w-12 rounded-lg overflow-hidden bg-elevated border border-border shrink-0">
                      {s.song_cover_url ? (
                        <img
                          src={s.song_cover_url}
                          alt={s.song_name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center">
                          <Music2 className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate" title={s.song_name}>
                        {s.song_name}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {s.song_artist || "—"}
                        {deal && <> · {deal.curator_name}</>}
                      </div>
                      {s.smartlink_url && (
                        <a
                          href={s.smartlink_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-primary inline-flex items-center gap-1 mt-1 hover:underline"
                        >
                          <Link2 className="h-3 w-3" /> smartlink
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                    {url && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0"
                          title="Copiar link do cliente"
                          onClick={() => copy(shareUrl ?? url)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0"
                          title="Abrir painel do cliente"
                          asChild
                        >
                          <a href={url} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {client.notes && (
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
              Observações
            </div>
            <p className="text-sm text-foreground whitespace-pre-wrap">{client.notes}</p>
          </div>
        )}
      </div>
    </>
  );
}

// Tabs (Identidade / Contato / Perfil artístico / Comercial)
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ClientType, NewClientInput } from "@/hooks/useClients";

const CLIENT_TYPE_OPTIONS: { value: ClientType; label: string }[] = [
  { value: "artist",   label: "Artista" },
  { value: "label",    label: "Label / Selo" },
  { value: "manager",  label: "Empresário / Manager" },
  { value: "producer", label: "Produtor" },
  { value: "other",    label: "Outro" },
];

export function ClientFormDialog({
  open,
  client,
  onClose,
  onSubmit,
}: {
  open: boolean;
  client: Client | null;
  onClose: () => void;
  onSubmit: (input: NewClientInput) => Promise<void>;
}) {
  // Form state — cobre todos os campos enriquecidos do cliente.
  const [name, setName] = useState("");
  const [clientType, setClientType] = useState<ClientType>("artist");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [instagram, setInstagram] = useState("");
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [primaryGenre, setPrimaryGenre] = useState("");
  const [monthlyListeners, setMonthlyListeners] = useState<string>("");
  const [document, setDocument] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [notes, setNotes] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("identidade");

  // sincroniza ao abrir
  useEffect(() => {
    if (!open) return;
    const c = client as any;
    setName(c?.name ?? "");
    setClientType((c?.client_type as ClientType) ?? "artist");
    setCompany(c?.company ?? "");
    setEmail(c?.email ?? "");
    setPhone(c?.phone ?? c?.contact ?? "");
    setInstagram(c?.instagram ?? "");
    setSpotifyUrl(c?.spotify_artist_url ?? "");
    setCity(c?.city ?? "");
    setCountry(c?.country ?? "");
    setPrimaryGenre(c?.primary_genre ?? "");
    setMonthlyListeners(c?.monthly_listeners != null ? String(c.monthly_listeners) : "");
    setDocument(c?.document ?? "");
    setPaymentTerms(c?.payment_terms ?? "");
    setTagsText((c?.tags ?? []).join(", "));
    setNotes(c?.notes ?? "");
    setLogoUrl(c?.logo_url ?? "");
    setBrandColor(c?.brand_color ?? "");
  }, [open, client]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Informe o nome do cliente");
      return;
    }
    const listenersNum = monthlyListeners.trim()
      ? Math.max(0, parseInt(monthlyListeners.replace(/\D/g, ""), 10) || 0)
      : null;
    const tagsList = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    setSaving(true);
    try {
      await onSubmit({
        name: trimmed,
        client_type: clientType,
        company: company.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        contact: phone.trim() || null, // mantém campo legado sincronizado
        instagram: instagram.trim().replace(/^@/, "") || null,
        spotify_artist_url: spotifyUrl.trim() || null,
        city: city.trim() || null,
        country: country.trim() || null,
        primary_genre: primaryGenre.trim() || null,
        monthly_listeners: listenersNum,
        document: document.trim() || null,
        payment_terms: paymentTerms.trim() || null,
        tags: tagsList,
        notes: notes.trim() || null,
        logo_url: logoUrl.trim() || null,
        brand_color: (() => {
          const v = brandColor.trim();
          if (!v) return null;
          return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
        })(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={client ? "Editar cliente" : "Novo cliente"}
      description="Ficha completa do contratante. Quanto mais preenchida, melhor o time monta a campanha e o financeiro."
      icon={<Users className="h-4 w-4" />}
      iconTone="clientes"
      size="lg"
      preventClose={saving}
      topSlot={
        <Tabs value={tab} onValueChange={setTab} className="px-5 pt-3">
          <TabsList className="w-full justify-start bg-transparent border-b border-border/60 rounded-none h-auto p-0 gap-1">
            {[
              { v: "identidade", l: "Identidade" },
              { v: "contato", l: "Contato" },
              { v: "perfil", l: "Perfil artístico" },
              { v: "comercial", l: "Comercial" },
              { v: "notas", l: "Notas" },
            ].map((t) => (
              <TabsTrigger
                key={t.v}
                value={t.v}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground px-3 py-2 text-[13px]"
              >
                {t.l}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Salvando…" : client ? "Salvar" : "Criar cliente"}
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={setTab}>
        {/* ----- Identidade ----- */}
        <TabsContent value="identidade" className="m-0 space-y-4">
          <FormGrid cols={2}>
            <FormField label="Nome" htmlFor="client-name" required span="full">
              <Input
                id="client-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Miguel Universal, Label XYZ"
                autoFocus
                maxLength={120}
              />
            </FormField>
            <FormField label="Tipo" htmlFor="client-type">
              <Select value={clientType} onValueChange={(v) => setClientType(v as ClientType)}>
                <SelectTrigger id="client-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLIENT_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Empresa / Label" htmlFor="client-company">
              <Input
                id="client-company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Ex: Sony Music"
                maxLength={120}
              />
            </FormField>
            <FormField
              label="Tags"
              htmlFor="client-tags"
              span="full"
              hint="Separadas por vírgula"
            >
              <Input
                id="client-tags"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="vip, recorrente, em alta"
                maxLength={300}
              />
            </FormField>
            <FormField
              label="URL do logo"
              htmlFor="client-logo"
              span="full"
              hint="Usado no PDF de relatório"
            >
              <Input
                id="client-logo"
                type="url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://exemplo.com/logo.png"
                maxLength={500}
              />
              {logoUrl.trim() && (
                <img
                  src={logoUrl.trim()}
                  alt="Preview do logo"
                  className="mt-2 h-12 w-auto rounded border border-border bg-elevated/40 p-1 object-contain"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
              )}
            </FormField>
            <FormField
              label="Cor de destaque (hex)"
              htmlFor="client-brand-color"
              span="full"
              hint="Usada no cabeçalho e bordas do PDF. Vazio = padrão NexEngine."
            >
              <div className="flex items-center gap-2">
                <Input
                  id="client-brand-color-picker"
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(brandColor) ? brandColor : "#1db954"}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="h-10 w-14 p-1 cursor-pointer shrink-0"
                />
                <Input
                  id="client-brand-color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  placeholder="#2d4a7a"
                  maxLength={7}
                />
              </div>
            </FormField>
          </FormGrid>
        </TabsContent>

        {/* ----- Contato ----- */}
        <TabsContent value="contato" className="m-0">
          <FormGrid cols={2}>
            <FormField label="E-mail" htmlFor="client-email">
              <Input
                id="client-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contato@artista.com"
                maxLength={255}
              />
            </FormField>
            <FormField label="WhatsApp / Telefone" htmlFor="client-phone">
              <Input
                id="client-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+55 11 99999-9999"
                maxLength={40}
              />
            </FormField>
            <FormField label="Instagram" htmlFor="client-instagram">
              <Input
                id="client-instagram"
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
                placeholder="@usuario"
                maxLength={60}
              />
            </FormField>
            <FormField label="Spotify do artista (URL)" htmlFor="client-spotify">
              <Input
                id="client-spotify"
                value={spotifyUrl}
                onChange={(e) => setSpotifyUrl(e.target.value)}
                placeholder="https://open.spotify.com/artist/…"
                maxLength={300}
              />
            </FormField>
            <FormField label="Cidade" htmlFor="client-city">
              <Input
                id="client-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="São Paulo"
                maxLength={80}
              />
            </FormField>
            <FormField label="País" htmlFor="client-country">
              <Input
                id="client-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="Brasil"
                maxLength={60}
              />
            </FormField>
          </FormGrid>
        </TabsContent>

        {/* ----- Perfil artístico ----- */}
        <TabsContent value="perfil" className="m-0">
          <FormGrid cols={2}>
            <FormField label="Gênero principal" htmlFor="client-genre">
              <Input
                id="client-genre"
                value={primaryGenre}
                onChange={(e) => setPrimaryGenre(e.target.value)}
                placeholder="Funk, Sertanejo, Pop…"
                maxLength={60}
              />
            </FormField>
            <FormField
              label="Ouvintes mensais (Spotify)"
              htmlFor="client-listeners"
              hint="Snapshot do momento — usado pra dimensionar campanhas."
            >
              <Input
                id="client-listeners"
                type="number"
                min={0}
                value={monthlyListeners}
                onChange={(e) => setMonthlyListeners(e.target.value)}
                placeholder="125000"
              />
            </FormField>
          </FormGrid>
        </TabsContent>

        {/* ----- Comercial ----- */}
        <TabsContent value="comercial" className="m-0">
          <FormGrid cols={2}>
            <FormField label="Documento (CNPJ / CPF)" htmlFor="client-doc">
              <Input
                id="client-doc"
                value={document}
                onChange={(e) => setDocument(e.target.value)}
                placeholder="00.000.000/0000-00"
                maxLength={30}
              />
            </FormField>
            <FormField label="Condição de pagamento" htmlFor="client-payment">
              <Input
                id="client-payment"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="50% início + 50% entrega · PIX"
                maxLength={120}
              />
            </FormField>
          </FormGrid>
        </TabsContent>

        {/* ----- Notas ----- */}
        <TabsContent value="notas" className="m-0">
          <FormField label="Observações internas" htmlFor="client-notes">
            <Textarea
              id="client-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Preferências, histórico, alertas, pessoas-chave do time…"
              rows={8}
              maxLength={2000}
            />
          </FormField>
        </TabsContent>
      </Tabs>
    </FormModal>
  );
}
