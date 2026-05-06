// ClientesLibraryTab — biblioteca de clientes (artistas/labels contratantes).
// Espelha o visual da CuradoresLibraryTab para manter o padrão da página.
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  User,
  Music2,
  Activity,
  CheckCircle2,
  Clock,
  Plus,
  Pencil,
  ExternalLink,
  Copy,
  Link2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { Label } from "@/components/ui/label";
import { useClients, type Client } from "@/hooks/useClients";
import { clientCampaignUrl } from "@/lib/curatorPublicUrl";
import { cn } from "@/lib/utils";
import type { CuratorDeal, CuratorDealSong } from "@/lib/curatorDealsUtils";

type ClientSongRow = CuratorDealSong & {
  client_id?: string | null;
  client_token?: string | null;
  smartlink_url?: string | null;
};

interface Props {
  deals: CuratorDeal[];
  songs: ClientSongRow[];
  loading: boolean;
}

export function ClientesLibraryTab({ deals, songs, loading }: Props) {
  const { clients, loading: loadingClients, addClient, updateClient, reload } = useClients();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Client | null>(null);
  const [editing, setEditing] = useState<Client | null>(null);
  const [creating, setCreating] = useState(false);

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
    return clients
      .filter((c) => !c.archived_at)
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
        return {
          client: c,
          songs: clientSongs,
          totalSongs: clientSongs.length,
          activeDeals,
          closedDeals,
          totalDeals: clientDeals.length,
          lastTs,
        };
      })
      .sort((a, b) => {
        if (a.activeDeals !== b.activeDeals) return b.activeDeals - a.activeDeals;
        return b.lastTs - a.lastTs;
      });
  }, [clients, songs, dealById, query]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente…"
            className="pl-9"
          />
        </div>
        <Button
          className="rounded-full h-9 gap-1.5"
          onClick={() => setCreating(true)}
        >
          <Plus className="h-4 w-4" /> Novo cliente
        </Button>
      </div>

      {(loading || loadingClients) && rows.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="nx-card h-56 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center">
          <User className="mx-auto size-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground mb-4">
            {query ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado ainda."}
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {rows.map((row) => {
            const { client, totalSongs, activeDeals, closedDeals, totalDeals, lastTs } = row;
            const initials = client.name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((s) => s[0]?.toUpperCase())
              .join("");
            const statusLabel =
              activeDeals > 0
                ? `${activeDeals} ativo${activeDeals > 1 ? "s" : ""}`
                : totalDeals > 0
                ? "Sem deals ativos"
                : "Sem deals";

            return (
              <Card
                key={client.id}
                className={cn(
                  "overflow-hidden border-border/60 transition-all duration-200 cursor-pointer",
                  "hover:border-foreground/25 hover:-translate-y-[1px]",
                  "hover:shadow-[0_18px_40px_-18px_rgba(0,0,0,0.85),0_0_32px_-8px_hsl(141_76%_48%_/_0.18)]",
                  "bg-[linear-gradient(180deg,rgba(255,255,255,0.025)_0%,transparent_40%),hsl(var(--card))]",
                )}
                onClick={() => setSelected(client)}
              >
                <CardContent className="p-5 pt-5 md:pt-5 flex flex-col gap-4">
                  <div className="flex items-start gap-3 min-w-0 pb-1">
                    <div className="h-11 w-11 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-[14px] font-bold text-primary shrink-0">
                      {initials || <User className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1">
                        Cliente
                      </div>
                      <div className="text-[20px] font-semibold tracking-tight text-foreground truncate leading-tight">
                        {client.name}
                      </div>
                      {client.contact && (
                        <div className="text-[12px] text-muted-foreground truncate mt-0.5">
                          {client.contact}
                        </div>
                      )}
                    </div>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "shrink-0 text-[10px] px-2.5 py-0.5 h-6 font-semibold gap-1 rounded-full",
                        activeDeals > 0 && "bg-primary/15 text-primary",
                      )}
                    >
                      {activeDeals > 0 && <Activity className="h-2.5 w-2.5" />}
                      {statusLabel}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 divide-x divide-border/50 rounded-xl bg-[hsl(var(--elevated))] border border-border/40">
                    <div className="px-4 py-3">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1.5">
                        Músicas
                      </div>
                      <div className="text-[24px] font-bold tabular-nums text-foreground leading-none tracking-tight">
                        {totalSongs}
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-1.5">
                        Deals
                      </div>
                      <div className="text-[24px] font-bold tabular-nums text-foreground leading-none tracking-tight">
                        {totalDeals}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground border-t border-border/40 pt-2.5">
                    {activeDeals > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Activity className="h-3 w-3 text-primary" />
                        <span className="tabular-nums font-semibold text-foreground">
                          {activeDeals}
                        </span>{" "}
                        ativo{activeDeals > 1 ? "s" : ""}
                      </span>
                    )}
                    {closedDeals > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        <span className="tabular-nums font-semibold text-foreground">
                          {closedDeals}
                        </span>{" "}
                        concluído{closedDeals > 1 ? "s" : ""}
                      </span>
                    )}
                    {totalSongs === 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Music2 className="h-3 w-3" />
                        Sem músicas vinculadas
                      </span>
                    )}
                    {lastTs > 0 && (
                      <span className="inline-flex items-center gap-1 ml-auto">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(lastTs), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 pt-0.5">
                    <Button
                      size="sm"
                      className="flex-1 h-9 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-[13px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(client);
                      }}
                    >
                      <Music2 className="h-3.5 w-3.5" />
                      Ver músicas
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 w-9 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(client);
                      }}
                      aria-label="Editar cliente"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Sheet — músicas e links do cliente selecionado */}
      <Sheet open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          {selected && (
            <ClientDetailContent
              client={selected}
              songs={songs.filter((s) => s.client_id === selected.id)}
              deals={deals}
              onEdit={() => {
                setEditing(selected);
              }}
            />
          )}
        </SheetContent>
      </Sheet>

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
              Nenhuma música vinculada ainda. Selecione este cliente ao criar/editar uma música em um deal.
            </p>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {songs.map((s) => {
              const deal = dealById.get(s.deal_id);
              const url = s.client_token ? clientCampaignUrl({ client_token: s.client_token }) : null;
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
                          onClick={() => copy(url)}
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

function ClientFormDialog({
  open,
  client,
  onClose,
  onSubmit,
}: {
  open: boolean;
  client: Client | null;
  onClose: () => void;
  onSubmit: (input: { name: string; contact?: string | null; notes?: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // sincroniza ao abrir
  useEffect(() => {
    if (open) {
      setName(client?.name ?? "");
      setContact(client?.contact ?? "");
      setNotes(client?.notes ?? "");
    }
  }, [open, client]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Informe o nome do cliente");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        name: trimmed,
        contact: contact.trim() || null,
        notes: notes.trim() || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{client ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          <DialogDescription>
            Cliente é o contratante da campanha (artista, label, empresário). Ele pode ter várias músicas em deals diferentes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="client-name">Nome</Label>
            <Input
              id="client-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: João Silva, Label XYZ"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-contact">Contato (opcional)</Label>
            <Input
              id="client-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="WhatsApp, email…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-notes">Observações (opcional)</Label>
            <Textarea
              id="client-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas internas sobre o cliente…"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Salvando…" : client ? "Salvar" : "Criar cliente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
