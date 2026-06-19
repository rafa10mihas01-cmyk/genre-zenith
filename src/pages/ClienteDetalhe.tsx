// ClienteDetalhe — página dedicada do cliente. Substitui o antigo drawer lateral.
// Mostra ficha completa + extrato (músicas, deals, financeiro, observações).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Pencil,
  Archive,
  ArchiveRestore,
  Trash2,
  Mail,
  Phone,
  Instagram,
  Music2,
  ExternalLink,
  Copy,
  Link2,
  MapPin,
  Building2,
  FileText,
  CreditCard,
  Users2,
  Calendar,
  CheckCircle2,
  XCircle,
  LayoutDashboard,
  Megaphone,
  StickyNote,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { KpiBig } from "@/components/KpiBig";
import { formatBRLHero } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

import { useClients } from "@/hooks/useClients";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";
import { ClientFormDialog } from "@/components/playlist-deals/ClientesLibraryTab";
import { clientCampaignUrl } from "@/lib/curatorPublicUrl";
import { cn } from "@/lib/utils";

const CLIENT_TYPE_LABEL: Record<string, string> = {
  artist: "Artista",
  label: "Label / Selo",
  manager: "Empresário",
  producer: "Produtor",
  other: "Outro",
};

const formatBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "primary" | "success" | "warning" | "muted" }) {
  return (
    <div className="nx-card !p-4">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-2xl font-bold tabular-nums mt-1",
          tone === "primary" && "text-primary",
          tone === "success" && "text-emerald-400",
          tone === "warning" && "text-warning",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {typeof value === "number" ? value.toLocaleString("pt-BR") : value}
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  href,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value?: string | null;
  href?: string;
  hint?: string | null;
}) {
  if (!value) return null;
  const content = (
    <div className="flex items-center gap-2.5 py-2.5">
      <div className="h-8 w-8 rounded-lg bg-elevated border border-border/60 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium">{label}</div>
        <div className="text-sm text-foreground truncate font-medium">{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground truncate">{hint}</div>}
      </div>
      {href && <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
    </div>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block hover:bg-elevated/40 -mx-2 px-2 rounded-lg transition-colors">
        {content}
      </a>
    );
  }
  return content;
}


export default function ClienteDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { clients, loading: loadingClients, updateClient, archiveClient, deleteClient, reload } = useClients();
  const { deals, songs, loading: loadingDeals } = useCuratorDeals();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const campaignsQuery = useQuery({
    queryKey: ["client_campaigns", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("id, track_name, artist, status, campaign_type, created_at, valor_cobrado, valor_recebido, recebido_em, deadline")
        .eq("client_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        track_name: string;
        artist: string | null;
        status: string;
        campaign_type: string | null;
        created_at: string;
        valor_cobrado: number | null;
        valor_recebido: number | null;
        recebido_em: string | null;
        deadline: string | null;
      }>;
    },
  });
  const clientCampaigns = useMemo(() => campaignsQuery.data ?? [], [campaignsQuery.data]);

  // Financeiro consolidado: fonte canônica = v_financial_summary.
  // Não somar manualmente nem ler de curator_deals.cost.
  const campaignIds = useMemo(() => clientCampaigns.map((c) => c.id), [clientCampaigns]);
  const financeQuery = useQuery({
    queryKey: ["client_finance", id, campaignIds.join(",")],
    enabled: !!id && campaignIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_financial_summary" as never)
        .select("campaign_id, valor_cobrado, valor_recebido, receita_pendente, total_pago_curadores, margem_bruta")
        .in("campaign_id", campaignIds);
      if (error) throw error;
      return (data ?? []) as Array<{
        campaign_id: string;
        valor_cobrado: number | null;
        valor_recebido: number | null;
        receita_pendente: number | null;
        total_pago_curadores: number | null;
        margem_bruta: number | null;
      }>;
    },
  });
  const financeRows = useMemo(() => financeQuery.data ?? [], [financeQuery.data]);

  const client = useMemo(() => clients.find((c) => c.id === id), [clients, id]);

  const dealById = useMemo(() => {
    const m = new Map<string, (typeof deals)[number]>();
    for (const d of deals) m.set(d.id, d);
    return m;
  }, [deals]);

  // Pós-refactor 1:N: um cliente pode ter deals por dois caminhos —
  //  (a) LEGADO: curator_deal_songs.client_id (1 deal → 1 cliente direto)
  //  (b) NOVO:   curator_deals.campaign_id → campaigns.client_id (campanha agrega N deals)
  // Precisamos somar ambos, senão deals novos somem da tela de Cliente.
  const campaignIdSet = useMemo(() => new Set(campaignIds), [campaignIds]);
  const clientDeals = useMemo(
    () =>
      deals.filter(
        (d) =>
          (d.campaign_id && campaignIdSet.has(d.campaign_id)) ||
          songs.some((s) => s.deal_id === d.id && s.client_id === id),
      ),
    [deals, songs, campaignIdSet, id],
  );
  const clientDealIds = useMemo(() => new Set(clientDeals.map((d) => d.id)), [clientDeals]);
  const clientSongs = useMemo(
    () => songs.filter((s) => s.client_id === id || clientDealIds.has(s.deal_id)),
    [songs, id, clientDealIds],
  );

  const kpis = useMemo(() => {
    // KPIs operacionais (não financeiros) — derivados de curator_deals.
    const ativos = clientDeals.filter((d) => !d.closed_at).length;
    const concluidos = clientDeals.filter((d) => d.closed_status === "completed").length;
    const cancelados = clientDeals.filter((d) => d.closed_status === "cancelled").length;

    // KPIs financeiros — fonte ÚNICA: v_financial_summary (agregada por campanha).
    const sum = (k: "valor_cobrado" | "valor_recebido" | "receita_pendente" | "margem_bruta") =>
      financeRows.reduce((acc, r) => acc + (Number(r[k]) || 0), 0);
    const investido = sum("valor_cobrado");
    const receita = sum("valor_recebido");
    const saldoPendente = sum("receita_pendente");
    const margem = sum("margem_bruta");

    return {
      musicas: clientSongs.length,
      deals: clientDeals.length,
      ativos,
      concluidos,
      cancelados,
      investido,
      receita,
      margem,
      saldoPendente,
      campanhas: clientCampaigns.length,
    };
  }, [clientDeals, clientSongs, clientCampaigns, financeRows]);


  if (loadingClients && !client) {
    return (
      <PageContainer>
        <div className="text-sm text-muted-foreground">Carregando cliente…</div>
      </PageContainer>
    );
  }

  if (!client) {
    return (
      <PageContainer>
        <PageHeader
        domain="clients" title="Cliente não encontrado" subtitle="O cliente solicitado não existe ou foi removido" />
        <Button variant="outline" onClick={() => { if (window.history.state?.idx === 0) navigate("/clientes", { replace: true }); else navigate(-1); }} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
      </PageContainer>
    );
  }

  const initials = client.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  const igHref = client.instagram
    ? `https://instagram.com/${client.instagram.replace(/^@/, "")}`
    : undefined;
  const mailHref = client.email ? `mailto:${client.email}` : undefined;
  const phoneHref = client.phone ? `https://wa.me/${client.phone.replace(/\D/g, "")}` : undefined;

  const copy = async (txt: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      toast.success("Copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={client.name}
        subtitle={[
          CLIENT_TYPE_LABEL[client.client_type] ?? "Cliente",
          client.company,
          [client.city, client.country].filter(Boolean).join(", ") || null,
          client.primary_genre,
          `Desde ${format(new Date(client.created_at), "dd MMM yyyy", { locale: ptBR })}`,
        ].filter(Boolean).join(" · ")}
        actions={
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
            <Button size="sm" variant="outline" className="gap-1.5 h-9 rounded-full px-3 sm:px-4" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> <span className="hidden sm:inline">Editar dados</span>
            </Button>
            {client.archived_at ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 h-9 rounded-full px-3 sm:px-4"
                onClick={async () => {
                  try {
                    await archiveClient(client.id, false);
                    toast.success("Cliente restaurado");
                    await reload();
                  } catch {
                    toast.error("Erro ao restaurar");
                  }
                }}
              >
                <ArchiveRestore className="h-4 w-4" /> <span className="hidden sm:inline">Restaurar</span>
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 h-9 rounded-full px-3 sm:px-4"
                onClick={async () => {
                  if (!confirm(`Arquivar ${client.name}? Ele sai da biblioteca mas o histórico fica.`)) return;
                  try {
                    await archiveClient(client.id, true);
                    toast.success("Cliente arquivado");
                    await reload();
                  } catch {
                    toast.error("Erro ao arquivar");
                  }
                }}
              >
                <Archive className="h-4 w-4" /> <span className="hidden sm:inline">Arquivar</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-9 rounded-full px-3 sm:px-4 text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" /> <span className="hidden sm:inline">Excluir</span>
            </Button>
          </div>
        }
      />





      {/* KPIs — hierarquia cockpit. Receita (hero) · Margem · Saldo em aberto · operacionais */}
      {/* "Concluídos" removido: redundante com "Ativos" (mesmo eixo de deals) e raramente populado */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 pt-4 mb-6">
        <KpiBig
          label="Receita"
          value={formatBRLHero(kpis.receita)}
          icon={CreditCard}
          hint="Pago pelo cliente"
          tier="hero"
          domain="clients"
        />
        <KpiBig
          label="Margem"
          value={formatBRLHero(kpis.margem)}
          icon={CheckCircle2}
          hint="Receita − custo de deals"
          tone={kpis.margem >= 0 ? "primary" : "warning"}
          domain="campaigns"
        />
        <KpiBig
          label="Saldo em aberto"
          value={formatBRLHero(kpis.saldoPendente)}
          icon={FileText}
          hint="Cobrado e não recebido"
          tone={kpis.saldoPendente > 0 ? "warning" : undefined}
          domain="campaigns"
        />
        <KpiBig label="Investido" value={formatBRLHero(kpis.investido)} icon={CreditCard} hint={`Custo em ${kpis.deals} deal${kpis.deals === 1 ? "" : "s"}`} domain="deals" />
        <KpiBig label="Ativos" value={kpis.ativos} icon={CheckCircle2} hint="Deals em andamento" tone="primary" domain="deals" />
        <KpiBig label="Músicas" value={kpis.musicas} icon={Music2} hint="No catálogo" domain="clients" />
      </div>


      <Tabs defaultValue="visao" className="space-y-4">
        {/* Mobile: grid de cards (mesmo padrão de Campanhas / CuradorDetail) */}
        <TabsList className="grid grid-cols-5 gap-1.5 sm:hidden bg-transparent p-0 h-auto">
          <TabsTrigger
            value="visao"
            className="rounded-xl border border-border bg-card px-1 py-2 flex flex-col items-center justify-center gap-1 text-muted-foreground data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            <LayoutDashboard className="h-4 w-4" />
            <span className="text-[11px] font-medium leading-none">Visão</span>
          </TabsTrigger>
          <TabsTrigger
            value="musicas"
            className="rounded-xl border border-border bg-card px-1 py-2 flex flex-col items-center justify-center gap-1 text-muted-foreground data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            <Music2 className="h-4 w-4" />
            <span className="text-[11px] font-medium leading-none">Músicas {kpis.musicas}</span>
          </TabsTrigger>
          <TabsTrigger
            value="deals"
            className="rounded-xl border border-border bg-card px-1 py-2 flex flex-col items-center justify-center gap-1 text-muted-foreground data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            <FileText className="h-4 w-4" />
            <span className="text-[11px] font-medium leading-none">Deals {kpis.deals}</span>
          </TabsTrigger>
          <TabsTrigger
            value="campanhas"
            className="rounded-xl border border-border bg-card px-1 py-2 flex flex-col items-center justify-center gap-1 text-muted-foreground data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            <Megaphone className="h-4 w-4" />
            <span className="text-[11px] font-medium leading-none">Camp. {kpis.campanhas}</span>
          </TabsTrigger>
          <TabsTrigger
            value="notas"
            className="rounded-xl border border-border bg-card px-1 py-2 flex flex-col items-center justify-center gap-1 text-muted-foreground data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            <StickyNote className="h-4 w-4" />
            <span className="text-[11px] font-medium leading-none">Notas</span>
          </TabsTrigger>
        </TabsList>

        {/* Desktop: rail clássico */}
        <TabsList className="hidden sm:inline-flex">
          <TabsTrigger value="visao" className="gap-1.5"><LayoutDashboard className="h-3.5 w-3.5" /> Visão geral</TabsTrigger>
          <TabsTrigger value="musicas">Músicas <span className="ml-1.5 text-muted-foreground">{kpis.musicas}</span></TabsTrigger>
          <TabsTrigger value="deals">Deals <span className="ml-1.5 text-muted-foreground">{kpis.deals}</span></TabsTrigger>
          <TabsTrigger value="campanhas">Campanhas <span className="ml-1.5 text-muted-foreground">{kpis.campanhas}</span></TabsTrigger>
          <TabsTrigger value="notas">Notas</TabsTrigger>
        </TabsList>

        {/* ----- Visão geral ----- */}
        <TabsContent value="visao" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-5">
                <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-3">Contato</div>
                <div className="divide-y divide-border/40">
                  <InfoRow icon={Mail} label="E-mail" value={client.email} href={mailHref} />
                  <InfoRow icon={Phone} label="WhatsApp / Telefone" value={client.phone || client.contact} href={phoneHref} />
                  <InfoRow icon={Instagram} label="Instagram" value={client.instagram ? `@${client.instagram.replace(/^@/, "")}` : null} href={igHref} />
                  <InfoRow
                    icon={Music2}
                    label="Spotify do artista"
                    value={client.spotify_artist_url ? "Abrir perfil no Spotify" : null}
                    hint={null}
                    href={client.spotify_artist_url ?? undefined}
                  />
                  {!client.email && !client.phone && !client.contact && !client.instagram && !client.spotify_artist_url && (
                    <p className="text-sm text-muted-foreground py-2">Sem contatos.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-3">Perfil & Comercial</div>
                <div className="divide-y divide-border/40">
                  <InfoRow icon={Music2} label="Gênero principal" value={client.primary_genre} />
                  <InfoRow
                    icon={Users2}
                    label="Ouvintes mensais"
                    value={client.monthly_listeners != null ? client.monthly_listeners.toLocaleString("pt-BR") : null}
                  />
                  <InfoRow icon={FileText} label="Documento" value={client.document} />
                  <InfoRow icon={CreditCard} label="Condição de pagamento" value={client.payment_terms} />
                  {!client.primary_genre && client.monthly_listeners == null && !client.document && !client.payment_terms && (
                    <p className="text-sm text-muted-foreground py-2">Sem perfil comercial.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {client.notes && (
            <Card>
              <CardContent className="p-5">
                <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-3">Observações</div>
                <p className="text-sm text-foreground whitespace-pre-wrap">{client.notes}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ----- Músicas ----- */}
        <TabsContent value="musicas">
          {clientSongs.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <Music2 className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">
                  Sem músicas vinculadas. Selecione o cliente ao criar uma música no deal.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {clientSongs.map((s) => {
                const deal = dealById.get(s.deal_id);
                const url = (s.slug || s.client_token)
                  ? clientCampaignUrl({ slug: s.slug ?? null, client_token: s.client_token ?? null })
                  : null;
                return (
                  <Card key={s.id}>
                    <CardContent className="p-4 flex items-center gap-3 min-w-0">
                      <div className="h-12 w-12 rounded-lg overflow-hidden bg-elevated border border-border shrink-0">
                        {s.song_cover_url ? (
                          <img src={s.song_cover_url} alt={s.song_name} className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center"><Music2 className="h-5 w-5 text-muted-foreground" /></div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate">{s.song_name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {s.song_artist || "—"}{deal && <> · {deal.curator_name}</>}
                        </div>
                        {s.smartlink_url && (
                          <a href={s.smartlink_url} target="_blank" rel="noreferrer" className="text-[11px] text-primary inline-flex items-center gap-1 mt-1 hover:underline">
                            <Link2 className="h-3 w-3" /> smartlink <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                      {url && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button size="sm" variant="outline" className="h-8 w-8 p-0" title="Copiar link do cliente" onClick={() => copy(url)}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 w-8 p-0" title="Abrir painel do cliente" asChild>
                            <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ----- Deals ----- */}
        <TabsContent value="deals">
          {clientDeals.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <p className="text-sm text-muted-foreground">Sem deals vinculados.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {clientDeals.map((d) => {
                const isClosed = !!d.closed_at;
                const status = !isClosed
                  ? { label: "Ativo", icon: CheckCircle2, cls: "text-primary" }
                  : d.closed_status === "completed"
                  ? { label: "Concluído", icon: CheckCircle2, cls: "text-emerald-400" }
                  : { label: "Cancelado", icon: XCircle, cls: "text-muted-foreground" };
                const Icon = status.icon;
                return (
                  <Link key={d.id} to={`/deals/${d.id}`}>
                    <Card className="hover:border-foreground/20 transition-colors">
                      <CardContent className="p-4 flex items-center gap-3 min-w-0">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">{d.curator_name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {d.song_name}{d.song_artist && <> · {d.song_artist}</>}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            Iniciado {formatDistanceToNow(new Date(d.started_at), { addSuffix: true, locale: ptBR })}
                            {d.cost != null && <> · {formatBRL(d.cost)}</>}
                          </div>
                        </div>
                        <div className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium shrink-0", status.cls)}>
                          <Icon className="h-3.5 w-3.5" /> {status.label}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ----- Campanhas ----- */}
        <TabsContent value="campanhas">
          {clientCampaigns.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <p className="text-sm text-muted-foreground">Sem campanhas vinculadas a este cliente.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {clientCampaigns.map((c) => {
                const cobrado = Number(c.valor_cobrado) || 0;
                const recebido = Number(c.valor_recebido) || 0;
                const pendente = Math.max(0, cobrado - recebido);
                const statusLabel = c.status === "active" ? "Ativa"
                  : c.status === "completed" ? "Concluída"
                  : c.status === "paused" ? "Pausada"
                  : c.status === "cancelled" ? "Cancelada"
                  : c.status === "draft" ? "Rascunho"
                  : c.status;
                const statusCls = c.status === "active" ? "text-primary"
                  : c.status === "completed" ? "text-emerald-400"
                  : c.status === "cancelled" ? "text-muted-foreground"
                  : "text-foreground/70";
                return (
                  <Link key={c.id} to={`/campanhas/${c.id}`}>
                    <Card className="hover:border-foreground/20 transition-colors">
                      <CardContent className="p-4 flex items-center gap-3 min-w-0">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">{c.track_name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {c.artist || "—"}
                            {c.campaign_type && <> · {c.campaign_type}</>}
                            <> · iniciada {formatDistanceToNow(new Date(c.created_at), { addSuffix: true, locale: ptBR })}</>
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                            Cobrado {formatBRL(cobrado)} · Recebido <span className="text-foreground/80">{formatBRL(recebido)}</span>
                            {pendente > 0 && <> · <span className="text-warning">{formatBRL(pendente)} pendente</span></>}
                          </div>
                        </div>
                        <div className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium shrink-0", statusCls)}>
                          {statusLabel}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </TabsContent>


        {/* ----- Notas ----- */}
        <TabsContent value="notas">
          <Card>
            <CardContent className="p-5">
              {client.notes ? (
                <p className="text-sm text-foreground whitespace-pre-wrap">{client.notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sem observações.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit dialog */}
      <ClientFormDialog
        open={editing}
        client={client}
        onClose={() => setEditing(false)}
        onSubmit={async (input) => {
          try {
            await updateClient(client.id, input);
            toast.success("Cliente atualizado");
            await reload();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao salvar cliente");
          }
        }}
      />

      {/* Delete confirm */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              {kpis.musicas > 0 || kpis.deals > 0
                ? `${client.name} possui músicas/deals vinculados. A exclusão desvincula o cliente, mas o histórico permanece. Esta ação não pode ser desfeita.`
                : `${client.name} será removido permanentemente. Esta ação não pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                try {
                  await deleteClient(client.id);
                  toast.success("Cliente excluído");
                  navigate("/clientes");
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
    </PageContainer>
  );
}
