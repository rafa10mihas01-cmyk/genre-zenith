// ClienteDetalhe — página dedicada do cliente. Substitui o antigo drawer lateral.
// Mostra ficha completa + extrato (músicas, deals, financeiro, observações).
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useClientOverview } from "@/hooks/useCampaignOverview";
import type { CampaignOverviewRow } from "@/services/campaignOverview";
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
  FileText,
  CreditCard,
  Users2,
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
import { MetricCell } from "@/components/ui/metric-cell";
import { Progress } from "@/components/ui/progress";
import { StatusDot, type StatusVariant } from "@/components/ui/status-dot";
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

function Stat({ label, value, tone, tier = "default", className }: { label: string; value: string | number; tone?: "primary" | "success" | "warning" | "muted"; tier?: "default" | "hero"; className?: string }) {
  return (
    <div className={cn("nx-card !p-4", className)}>
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-bold tabular-nums mt-1",
          tier === "hero" ? "text-4xl sm:text-2xl" : "text-2xl",
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

function CampaignCard({ ov }: { ov: CampaignOverviewRow }) {
  // Componente apenas renderiza. Zero cálculo. Tudo vem do v_campaign_overview.
  const cobrado = ov.contratado;
  const recebido = ov.recebido;
  const pendente = ov.pendente;
  const dealsTotal = ov.deals_total;
  const dealsConcluidos = ov.deals_concluidos;
  const dealsAtivos = ov.deals_abertos;
  const curadores = ov.curadores_unicos;
  const entrega = cobrado > 0 ? Math.round((recebido / cobrado) * 100) : 0;
  const progresso = ov.progresso_pct;

  const status: { variant: StatusVariant; label: string } =
    ov.status === "active" ? { variant: "success", label: "Ativa" }
    : ov.status === "completed" ? { variant: "primary", label: "Concluída" }
    : ov.status === "paused" ? { variant: "warning", label: "Pausada" }
    : ov.status === "cancelled" ? { variant: "danger", label: "Cancelada" }
    : ov.status === "draft" ? { variant: "neutral", label: "Rascunho" }
    : { variant: "neutral", label: ov.status ?? "—" };

  const initials = (ov.track_name ?? "")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((s) => s[0]?.toUpperCase()).join("");
  const inicio = format(new Date(ov.created_at), "dd MMM", { locale: ptBR });
  const href = `/campanhas/${ov.campaign_id}`;

  return (
    <Link
      to={href}
      className={cn(
        "group relative block rounded-2xl border border-border/50 bg-card transition-colors",
        "border-l-2 border-l-domain-campaigns/60",
        "hover:border-foreground/20 hover:border-l-domain-campaigns hover:bg-[hsl(var(--elevated))]",
      )}
    >
      {/* Identidade */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 min-w-0">
        <div className="h-8 w-8 rounded-md bg-domain-campaigns/15 border border-domain-campaigns/25 flex items-center justify-center text-[11px] font-bold text-domain-campaigns shrink-0">
          {initials || <Megaphone className="h-3.5 w-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-foreground truncate leading-tight group-hover:text-primary transition-colors">
            {ov.track_name}
          </div>
          <div className="text-[10.5px] text-muted-foreground truncate mt-0.5">
            <span className="truncate">{ov.artist || "—"}</span>
            <span className="mx-1 opacity-50">·</span>
            <span className="tabular-nums">{inicio}</span>
          </div>
        </div>
        <StatusDot variant={status.variant} label={status.label} className="shrink-0" />
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0" />
      </div>

      <div className="mx-3 border-t border-border/40" />

      {/* Métricas + progresso */}
      <div className="px-3 py-2.5 space-y-2 min-w-0">
        <div className="grid grid-cols-2 gap-2">
          <MetricCell label="Curadores" value={curadores} size="sm" />
          <MetricCell label="Deals ativos" value={dealsAtivos} size="sm" />
        </div>
        {cobrado > 0 && (
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center justify-between text-[9.5px] text-muted-foreground">
              <span className="uppercase tracking-[0.12em] font-medium">Entrega financeira</span>
              <span className="tabular-nums font-semibold text-foreground">{entrega}%</span>
            </div>
            <Progress value={entrega} className="h-1 rounded-full" />
            <div className="text-[9.5px] text-muted-foreground tabular-nums">
              {formatBRLHero(recebido)} / {formatBRLHero(cobrado)}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground pt-1 border-t border-border/30">
          {dealsTotal > 0 && (
            <span className="inline-flex items-center gap-0.5 tabular-nums">
              <CheckCircle2 className="h-2.5 w-2.5" />
              <span className="text-foreground font-medium">{dealsConcluidos}/{dealsTotal}</span> · {progresso}%
            </span>
          )}
          {pendente > 0 ? (
            <span className="inline-flex items-center gap-0.5 ml-auto tabular-nums text-warning">
              <span className="opacity-70">Pendente</span>
              <span className="font-semibold">{formatBRLHero(pendente)}</span>
            </span>
          ) : cobrado > 0 ? (
            <span className="inline-flex items-center gap-0.5 ml-auto tabular-nums text-success">
              <CheckCircle2 className="h-2.5 w-2.5" /> Quitada
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}





export default function ClienteDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { clients, loading: loadingClients, updateClient, archiveClient, deleteClient, reload } = useClients();
  const { deals, songs, loading: loadingDeals } = useCuratorDeals();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // FASE 14.1 — Fonte ÚNICA de verdade: useClientOverview → v_campaign_overview.
  // Componente NÃO recalcula nada: nem somas, nem margens, nem progresso, nem contagens.
  const overviewQuery = useClientOverview(id);
  const overview = overviewQuery.data;
  const clientCampaigns = useMemo(() => overview?.campaigns ?? [], [overview]);
  const overviewTimeline = useMemo(() => overview?.timeline ?? [], [overview]);

  const client = useMemo(() => clients.find((c) => c.id === id), [clients, id]);

  // Apoio: deals/músicas só pras abas legadas (Músicas/Deals/Notas) — não entram em KPIs.
  const dealById = useMemo(() => {
    const m = new Map<string, (typeof deals)[number]>();
    for (const d of deals) m.set(d.id, d);
    return m;
  }, [deals]);
  const campaignIdSet = useMemo(() => new Set(clientCampaigns.map((c) => c.campaign_id)), [clientCampaigns]);
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

  // KPIs lidos do overview (totals já agregados pelo service).
  const t = overview?.totals;
  const kpis = useMemo(() => ({
    musicas: clientSongs.length, // métrica auxiliar da aba legada
    deals: t?.deals_total ?? 0,
    ativos: t?.deals_abertos ?? 0,
    concluidos: t?.deals_concluidos ?? 0,
    cancelados: 0,
    curadoresAtivos: t?.curadores_unicos ?? 0,
    campanhasAtivas: t?.campanhas_ativas ?? 0,
    investido: t?.contratado ?? 0,
    receita: t?.recebido ?? 0,
    margem: t?.margem_prevista ?? 0,
    margemPrevista: t?.margem_prevista ?? 0,
    custoOperacional: t?.custo_operacional ?? 0,
    saldoPendente: t?.pendente ?? 0,
    campanhas: t?.campanhas_total ?? 0,
  }), [t, clientSongs.length]);

  // Timeline visual (ícones) montada a partir da timeline já vinda do service.
  const timeline = useMemo(() => {
    const ICONS: Record<string, { icon: LucideIcon; tone?: string }> = {
      campaign_created: { icon: Megaphone },
      plan_approved: { icon: CheckCircle2, tone: "text-primary" },
      client_approved: { icon: CheckCircle2, tone: "text-primary" },
      baseline_captured: { icon: FileText },
      eco_dispatched: { icon: CreditCard, tone: "text-emerald-400" },
      campaign_closed: { icon: XCircle, tone: "text-muted-foreground" },
    };
    return overviewTimeline.slice(0, 8).map((e) => ({
      when: e.when,
      label: e.label,
      icon: ICONS[e.kind]?.icon ?? FileText,
      tone: ICONS[e.kind]?.tone,
    }));
  }, [overviewTimeline]);

  const ultimaAtividade = timeline[0]?.when ?? null;




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





      {/* Linha 1 — KPIs Financeiros (fonte canônica: v_financial_summary) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 pt-4 mb-4">
        <KpiBig
          label="Valor contratado"
          value={formatBRLHero(kpis.investido)}
          icon={FileText}
          hint={`${kpis.campanhas} campanha${kpis.campanhas === 1 ? "" : "s"}`}
          tier="hero"
          domain="clients"
          className="col-span-2 md:col-span-1"
        />
        <KpiBig
          label="Valor recebido"
          value={formatBRLHero(kpis.receita)}
          icon={CreditCard}
          hint="Pago pelo cliente"
          tone="primary"
          domain="clients"
        />
        <KpiBig
          label="Saldo em aberto"
          value={formatBRLHero(kpis.saldoPendente)}
          icon={FileText}
          hint="Cobrado e não recebido"
          tone={kpis.saldoPendente > 0 ? "warning" : undefined}
          domain="campaigns"
        />
        <KpiBig
          label="Custo operacional"
          value={formatBRLHero(kpis.custoOperacional)}
          icon={Users2}
          hint="Pago a curadores"
          domain="deals"
        />
        <KpiBig
          label="Margem prevista"
          value={formatBRLHero(kpis.margemPrevista)}
          icon={CheckCircle2}
          hint="Contratado − custo"
          tone={kpis.margemPrevista >= 0 ? "primary" : "warning"}
          domain="campaigns"
        />
      </div>



      {/* Shell única: Visão + Campanhas (fallback legado de Músicas/Deals/Notas removido). */}
      <Tabs defaultValue="visao" className="space-y-4">
        {/* Mobile */}
        <TabsList className="grid grid-cols-2 gap-1.5 sm:hidden bg-transparent p-0 h-auto">
          <TabsTrigger
            value="visao"
            className="rounded-xl border border-border bg-card px-1 py-2 flex flex-col items-center justify-center gap-1 text-muted-foreground data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            <LayoutDashboard className="h-4 w-4" />
            <span className="text-[11px] font-medium leading-none">Visão</span>
          </TabsTrigger>
          <TabsTrigger
            value="campanhas"
            className="rounded-xl border border-border bg-card px-1 py-2 flex flex-col items-center justify-center gap-1 text-muted-foreground data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            <Megaphone className="h-4 w-4" />
            <span className="text-[11px] font-medium leading-none">Camp. {kpis.campanhas}</span>
          </TabsTrigger>
        </TabsList>
        {/* Desktop */}
        <TabsList className="hidden sm:inline-flex">
          <TabsTrigger value="visao" className="gap-1.5"><LayoutDashboard className="h-3.5 w-3.5" /> Visão geral</TabsTrigger>
          <TabsTrigger value="campanhas">Campanhas <span className="ml-1.5 text-muted-foreground">{kpis.campanhas}</span></TabsTrigger>
        </TabsList>


        {/* ----- Visão geral ----- */}
        <TabsContent value="visao" className="space-y-4">
          {/* Linha 2 — KPIs Operacionais */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            <Stat
              label="Campanhas ativas"
              value={kpis.campanhasAtivas}
              tone={kpis.campanhasAtivas > 0 ? "primary" : "muted"}
              tier="hero"
              className="col-span-2 md:col-span-1"
            />
            <Stat label="Deals ativos" value={kpis.ativos} tone={kpis.ativos > 0 ? "primary" : "muted"} />
            <Stat label="Curadores trabalhando" value={kpis.curadoresAtivos} tone="muted" />
            <Stat label="Músicas em campanha" value={kpis.musicas} tone="muted" />
            <Stat
              label="Última atividade"
              value={ultimaAtividade ? formatDistanceToNow(new Date(ultimaAtividade), { addSuffix: true, locale: ptBR }) : "—"}
              tone="muted"
            />
          </div>

          {/* Linha 3 — Campanhas (card por campanha) */}
          {clientCampaigns.length > 0 && (
            <div className={cn("grid gap-3", clientCampaigns.length === 1 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4")}>
              {clientCampaigns.map((c) => (
                <CampaignCard key={c.campaign_id} ov={c} />
              ))}
            </div>
          )}


          {/* Linha 4 — Timeline + Linha 5 — Contato lado a lado */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {timeline.length > 0 && (
              <Card className="lg:col-span-2">
                <CardContent className="p-5">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-3">Linha do tempo</div>
                  <ol className="relative space-y-3">
                    {timeline.map((e, i) => {
                      const Icon = e.icon;
                      return (
                        <li key={i} className="flex items-start gap-3">
                          <div className="h-7 w-7 rounded-full bg-elevated border border-border/60 flex items-center justify-center shrink-0 mt-0.5">
                            <Icon className={cn("h-3.5 w-3.5", e.tone ?? "text-muted-foreground")} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-foreground truncate">{e.label}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {formatDistanceToNow(new Date(e.when), { addSuffix: true, locale: ptBR })}
                              <span className="mx-1.5">·</span>
                              {format(new Date(e.when), "dd MMM yyyy", { locale: ptBR })}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </CardContent>
              </Card>
            )}

            {(client.email || client.phone || client.contact || client.instagram || client.spotify_artist_url) && (
              <Card>
                <CardContent className="p-5">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-2">Contato</div>
                  <div className="divide-y divide-border/40">
                    <InfoRow
                      icon={Music2}
                      label="Spotify"
                      value={client.spotify_artist_url ? "Abrir perfil" : null}
                      href={client.spotify_artist_url ?? undefined}
                    />
                    <InfoRow
                      icon={Instagram}
                      label="Instagram"
                      value={client.instagram ? `@${client.instagram.replace(/^@/, "")}` : null}
                      href={igHref}
                    />
                    <InfoRow icon={Mail} label="E-mail" value={client.email} href={mailHref} />
                    <InfoRow icon={Phone} label="WhatsApp" value={client.phone || client.contact} href={phoneHref} />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Linha 6 — Observações (somente se houver) */}
          {client.notes && (
            <Card>
              <CardContent className="p-5">
                <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-2">Observações</div>
                <p className="text-sm text-foreground whitespace-pre-wrap">{client.notes}</p>
              </CardContent>
            </Card>
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
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {clientCampaigns.map((c) => (
                <CampaignCard key={c.campaign_id} ov={c} />
              ))}
            </div>
          )}
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
