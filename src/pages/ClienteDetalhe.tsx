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
        .select("id, track_name, artist, status, campaign_type, created_at, valor_cobrado, valor_recebido, recebido_em, deadline, snapshot_locked_at")
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
        snapshot_locked_at: string | null;
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
    const curadoresAtivos = new Set(
      clientDeals.filter((d) => !d.closed_at && d.curator_id).map((d) => d.curator_id as string),
    ).size;
    const campanhasAtivas = clientCampaigns.filter((c) => c.status === "active").length;

    // KPIs financeiros — fonte ÚNICA: v_financial_summary (agregada por campanha).
    const sum = (k: "valor_cobrado" | "valor_recebido" | "receita_pendente" | "margem_bruta" | "total_pago_curadores") =>
      financeRows.reduce((acc, r) => acc + (Number(r[k]) || 0), 0);
    const investido = sum("valor_cobrado");
    const receita = sum("valor_recebido");
    const saldoPendente = sum("receita_pendente");
    const margem = sum("margem_bruta");
    const custoOperacional = sum("total_pago_curadores");
    const margemPrevista = investido - custoOperacional;

    return {
      musicas: clientSongs.length,
      deals: clientDeals.length,
      ativos,
      concluidos,
      cancelados,
      curadoresAtivos,
      campanhasAtivas,
      investido,
      receita,
      margem,
      margemPrevista,
      custoOperacional,
      saldoPendente,
      campanhas: clientCampaigns.length,
    };
  }, [clientDeals, clientSongs, clientCampaigns, financeRows]);

  // Agregados por campanha — derivados dos dados já carregados (sem novas queries).
  const campaignAggregates = useMemo(() => {
    const map = new Map<string, { deals: number; dealsAtivos: number; dealsConcluidos: number; curadores: number; songs: number; ultimaAtividade: number | null }>();
    for (const c of clientCampaigns) {
      const cDeals = clientDeals.filter((d) => d.campaign_id === c.id);
      const cSongs = clientSongs.filter((s) => clientDeals.some((d) => d.id === s.deal_id && d.campaign_id === c.id));
      const curadores = new Set(cDeals.filter((d) => d.curator_id).map((d) => d.curator_id as string)).size;
      const ts = [
        new Date(c.created_at).getTime(),
        ...cDeals.map((d) => new Date(d.started_at).getTime()),
        ...cDeals.filter((d) => d.closed_at).map((d) => new Date(d.closed_at as string).getTime()),
      ].filter((n) => Number.isFinite(n));
      map.set(c.id, {
        deals: cDeals.length,
        dealsAtivos: cDeals.filter((d) => !d.closed_at).length,
        dealsConcluidos: cDeals.filter((d) => d.closed_status === "completed").length,
        curadores,
        songs: cSongs.length,
        ultimaAtividade: ts.length ? Math.max(...ts) : null,
      });
    }
    return map;
  }, [clientCampaigns, clientDeals, clientSongs]);

  // Timeline — últimos eventos consolidados do cliente.
  const timeline = useMemo(() => {
    const events: Array<{ when: string; label: string; icon: LucideIcon; tone?: string }> = [];
    for (const c of clientCampaigns) {
      events.push({ when: c.created_at, label: `Campanha criada · ${c.track_name}`, icon: Megaphone });
      if (c.snapshot_locked_at) events.push({ when: c.snapshot_locked_at, label: `Plano aprovado · ${c.track_name}`, icon: CheckCircle2, tone: "text-primary" });
      if (c.recebido_em) events.push({ when: c.recebido_em, label: `Pagamento recebido · ${c.track_name}`, icon: CreditCard, tone: "text-emerald-400" });
    }
    for (const d of clientDeals) {
      events.push({ when: d.started_at, label: `Deal iniciado · ${d.curator_name}`, icon: FileText });
      if (d.closed_at) events.push({ when: d.closed_at, label: `Deal ${d.closed_status === "completed" ? "concluído" : "encerrado"} · ${d.curator_name}`, icon: d.closed_status === "completed" ? CheckCircle2 : XCircle, tone: d.closed_status === "completed" ? "text-emerald-400" : "text-muted-foreground" });
    }
    return events
      .filter((e) => e.when)
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
      .slice(0, 8);
  }, [clientCampaigns, clientDeals]);

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



      {/* Cliente com campanhas ativas (modelo novo) usa shell enxuta: só Visão + Campanhas.
          Clientes legados sem nenhuma campanha mantêm as abas antigas (Músicas/Deals/Notas)
          até serem migrados. */}
      {(() => null)()}
      <Tabs defaultValue="visao" className="space-y-4">
        {kpis.campanhas > 0 ? (
          <>
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
          </>
        ) : (
          <>
            {/* Mobile (legado) */}
            <TabsList className="grid grid-cols-4 gap-1.5 sm:hidden bg-transparent p-0 h-auto">
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
                value="notas"
                className="rounded-xl border border-border bg-card px-1 py-2 flex flex-col items-center justify-center gap-1 text-muted-foreground data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <StickyNote className="h-4 w-4" />
                <span className="text-[11px] font-medium leading-none">Notas</span>
              </TabsTrigger>
            </TabsList>
            {/* Desktop (legado) */}
            <TabsList className="hidden sm:inline-flex">
              <TabsTrigger value="visao" className="gap-1.5"><LayoutDashboard className="h-3.5 w-3.5" /> Visão geral</TabsTrigger>
              <TabsTrigger value="musicas">Músicas <span className="ml-1.5 text-muted-foreground">{kpis.musicas}</span></TabsTrigger>
              <TabsTrigger value="deals">Deals <span className="ml-1.5 text-muted-foreground">{kpis.deals}</span></TabsTrigger>
              <TabsTrigger value="notas">Notas</TabsTrigger>
            </TabsList>
          </>
        )}

        {/* ----- Visão geral ----- */}
        <TabsContent value="visao" className="space-y-4">
          {/* Linha 2 — KPIs Operacionais */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            <Stat label="Campanhas ativas" value={kpis.campanhasAtivas} tone={kpis.campanhasAtivas > 0 ? "primary" : "muted"} />
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
            <div className={cn("grid gap-3", clientCampaigns.length === 1 ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2")}>
              {clientCampaigns.map((c) => {
                const agg = campaignAggregates.get(c.id);
                const cobrado = Number(c.valor_cobrado) || 0;
                const recebido = Number(c.valor_recebido) || 0;
                const pendente = Math.max(0, cobrado - recebido);
                const dealsTotal = agg?.deals ?? 0;
                const dealsConcluidos = agg?.dealsConcluidos ?? 0;
                const progresso = dealsTotal > 0 ? Math.round((dealsConcluidos / dealsTotal) * 100) : 0;
                const entrega = cobrado > 0 ? Math.min(100, Math.round((recebido / cobrado) * 100)) : 0;
                const statusLabel = c.status === "active" ? "Ativa"
                  : c.status === "completed" ? "Concluída"
                  : c.status === "paused" ? "Pausada"
                  : c.status === "cancelled" ? "Cancelada"
                  : c.status === "draft" ? "Rascunho"
                  : c.status;
                const statusCls = c.status === "active" ? "bg-primary/15 text-primary border-primary/30"
                  : c.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  : c.status === "cancelled" ? "bg-muted/40 text-muted-foreground border-border"
                  : "bg-muted/30 text-foreground/70 border-border";
                const inicio = format(new Date(c.created_at), "dd MMM", { locale: ptBR });
                const fim = c.deadline ? format(new Date(c.deadline), "dd MMM", { locale: ptBR }) : null;
                const href = c.snapshot_locked_at ? `/campanhas/${c.id}/execucao` : `/campanhas/${c.id}`;
                return (
                  <Card key={c.id} className="hover:border-foreground/20 transition-colors">
                    <CardContent className="p-5 space-y-4">
                      <div className="flex items-start justify-between gap-3 min-w-0">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">{c.track_name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {c.artist || "—"}
                            {c.campaign_type && <> · {c.campaign_type}</>}
                            <> · {inicio}{fim ? ` → ${fim}` : ""}</>
                          </div>
                        </div>
                        <span className={cn("inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0", statusCls)}>
                          {statusLabel}
                        </span>
                      </div>

                      {/* Progresso operacional */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">Progresso operacional</span>
                          <span className="tabular-nums font-medium">{dealsConcluidos}/{dealsTotal} deals · {progresso}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
                          <div className="h-full bg-primary/70 transition-all" style={{ width: `${progresso}%` }} />
                        </div>
                      </div>

                      {/* Entrega financeira */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">Entrega financeira</span>
                          <span className="tabular-nums font-medium">{formatBRL(recebido)} / {formatBRL(cobrado)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
                          <div className="h-full bg-emerald-500/70 transition-all" style={{ width: `${entrega}%` }} />
                        </div>
                      </div>

                      {/* Métricas em linha */}
                      <div className="grid grid-cols-4 gap-2 pt-1">
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Curadores</div>
                          <div className="text-sm font-semibold tabular-nums">{agg?.curadores ?? 0}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Deals</div>
                          <div className="text-sm font-semibold tabular-nums">{agg?.dealsAtivos ?? 0}<span className="text-muted-foreground text-xs"> ativos</span></div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Meta</div>
                          <div className="text-sm font-semibold tabular-nums">{formatBRL(cobrado)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pendente</div>
                          <div className={cn("text-sm font-semibold tabular-nums", pendente > 0 ? "text-warning" : "text-muted-foreground")}>{formatBRL(pendente)}</div>
                        </div>
                      </div>

                      <div className="pt-1">
                        <Button asChild size="sm" variant="outline" className="w-full gap-1.5">
                          <Link to={href}>Abrir campanha <ExternalLink className="h-3.5 w-3.5" /></Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
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
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {clientCampaigns.map((c) => {
                const agg = campaignAggregates.get(c.id);
                const cobrado = Number(c.valor_cobrado) || 0;
                const recebido = Number(c.valor_recebido) || 0;
                const pendente = Math.max(0, cobrado - recebido);
                const dealsTotal = agg?.deals ?? 0;
                const dealsConcluidos = agg?.dealsConcluidos ?? 0;
                const progresso = dealsTotal > 0 ? Math.round((dealsConcluidos / dealsTotal) * 100) : 0;
                const entrega = cobrado > 0 ? Math.min(100, Math.round((recebido / cobrado) * 100)) : 0;
                const statusLabel = c.status === "active" ? "Ativa"
                  : c.status === "completed" ? "Concluída"
                  : c.status === "paused" ? "Pausada"
                  : c.status === "cancelled" ? "Cancelada"
                  : c.status === "draft" ? "Rascunho"
                  : c.status;
                const statusCls = c.status === "active" ? "bg-primary/15 text-primary border-primary/30"
                  : c.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  : c.status === "cancelled" ? "bg-muted/40 text-muted-foreground border-border"
                  : "bg-muted/30 text-foreground/70 border-border";
                const inicio = format(new Date(c.created_at), "dd MMM", { locale: ptBR });
                const fim = c.deadline ? format(new Date(c.deadline), "dd MMM", { locale: ptBR }) : null;
                const href = c.snapshot_locked_at ? `/campanhas/${c.id}/execucao` : `/campanhas/${c.id}`;
                return (
                  <Card key={c.id} className="hover:border-foreground/20 transition-colors">
                    <CardContent className="p-5 space-y-4">
                      <div className="flex items-start justify-between gap-3 min-w-0">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">{c.track_name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {c.artist || "—"}
                            {c.campaign_type && <> · {c.campaign_type}</>}
                            <> · {inicio}{fim ? ` → ${fim}` : ""}</>
                          </div>
                        </div>
                        <span className={cn("inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0", statusCls)}>
                          {statusLabel}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">Progresso operacional</span>
                          <span className="tabular-nums font-medium">{dealsConcluidos}/{dealsTotal} · {progresso}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
                          <div className="h-full bg-primary/70 transition-all" style={{ width: `${progresso}%` }} />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">Entrega financeira</span>
                          <span className="tabular-nums font-medium">{entrega}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
                          <div className="h-full bg-emerald-500/70 transition-all" style={{ width: `${entrega}%` }} />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Curadores</div>
                          <div className="text-sm font-semibold tabular-nums">{agg?.curadores ?? 0}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Deals ativos</div>
                          <div className="text-sm font-semibold tabular-nums">{agg?.dealsAtivos ?? 0}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Meta</div>
                          <div className="text-sm font-semibold tabular-nums">{formatBRL(cobrado)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pendente</div>
                          <div className={cn("text-sm font-semibold tabular-nums", pendente > 0 ? "text-warning" : "text-muted-foreground")}>{formatBRL(pendente)}</div>
                        </div>
                      </div>

                      <div className="pt-1">
                        <Button asChild size="sm" variant="outline" className="w-full gap-1.5">
                          <Link to={href}>Abrir campanha <ExternalLink className="h-3.5 w-3.5" /></Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
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
