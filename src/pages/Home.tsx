import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Activity, ArrowRight, AlertTriangle, Music2, Handshake, UserPlus, Bell,
  TrendingUp, TrendingDown, ChevronRight, Users,
} from "lucide-react";
import { formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { useSetSidebarKpis } from "@/contexts/SidebarContext";
import { OperationalHealthCard } from "@/components/home/OperationalHealthCard";
import { WeeklySummaryCard } from "@/components/home/WeeklySummaryCard";
import { DealsPendingCard } from "@/components/home/DealsPendingCard";
import { BrainFreshnessCard } from "@/components/home/BrainFreshnessCard";
import { ProactiveAlertsCard } from "@/components/home/ProactiveAlertsCard";
import { ManagedPlaylistsKpis } from "@/components/home/ManagedPlaylistsKpis";
import { PlaylistsInDeclineCard } from "@/components/home/PlaylistsInDeclineCard";

/**
 * HOJE — Centro de comando único do sistema.
 * Foco: tudo de mais valioso da operação em uma página só.
 */

type CuratorRow = {
  name: string;
  valor: number;
  target: number;
  entregue: number;
};

type Snapshot = {
  catalogPlaylists: number;
  catalogFollowers: number;
  dealsActive: number;
  dealsValor: number;
  dealsTarget: number;
  dealsEntregue: number;
  crmNovo: number;
  crmNovoFollowers: number;
  notifUnread: number;
  clients: number;
  campaignsActive: number;
  topCurator: CuratorRow | null;
  topCuratorShare: number;
  underdeliverDeals: number;
};

type ActivityRow = {
  id: string;
  acao: string;
  status: string;
  mensagem: string | null;
  created_at: string;
};

export default function Home() {
  const [s, setS] = useState<Snapshot | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [
      mpRes, dealsRes, crmRes, notifRes, clientsRes, campaignsRes, curatorsRes, logsRes,
    ] = await Promise.all([
      supabase.from("managed_playlists").select("followers", { count: "exact" }).is("archived_at", null),
      supabase.from("curator_deals")
        .select("cost, target_plays, reconciled_total_plays, curator_id, curators(name)")
        .is("closed_at", null),
      supabase.from("external_curators").select("followers", { count: "exact" }).eq("status", "novo"),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("read", false),
      supabase.from("clients").select("id", { count: "exact", head: true }).is("archived_at", null),
      supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("curators").select("id, name"),
      supabase.from("collection_logs").select("id,acao,status,mensagem,created_at").order("created_at", { ascending: false }).limit(6),
    ]);

    const mpRows = (mpRes.data ?? []) as { followers: number | null }[];
    const catalogFollowers = mpRows.reduce((a, r) => a + (r.followers ?? 0), 0);

    const dealRows = (dealsRes.data ?? []) as any[];
    const dealsValor = dealRows.reduce((a, r) => a + (Number(r.cost) || 0), 0);
    const dealsTarget = dealRows.reduce((a, r) => a + (Number(r.target_plays) || 0), 0);
    const dealsEntregue = dealRows.reduce((a, r) => a + (Number(r.reconciled_total_plays) || 0), 0);

    const byCurator = new Map<string, CuratorRow>();
    dealRows.forEach(r => {
      const name = r.curators?.name ?? "Sem curador";
      const prev = byCurator.get(name) ?? { name, valor: 0, target: 0, entregue: 0 };
      prev.valor += Number(r.cost) || 0;
      prev.target += Number(r.target_plays) || 0;
      prev.entregue += Number(r.reconciled_total_plays) || 0;
      byCurator.set(name, prev);
    });
    const ranked = [...byCurator.values()].sort((a, b) => b.valor - a.valor);
    const topCurator = ranked[0] ?? null;
    const topCuratorShare = topCurator && dealsValor > 0 ? (topCurator.valor / dealsValor) * 100 : 0;
    const underdeliverDeals = dealRows.filter(r => {
      const tgt = Number(r.target_plays) || 0;
      const del = Number(r.reconciled_total_plays) || 0;
      return tgt > 0 && del / tgt < 0.01;
    }).length;

    const crmRows = (crmRes.data ?? []) as { followers: number | null }[];
    const crmNovoFollowers = crmRows.reduce((a, r) => a + (r.followers ?? 0), 0);

    setS({
      catalogPlaylists: mpRes.count ?? 0,
      catalogFollowers,
      dealsActive: dealRows.length,
      dealsValor, dealsTarget, dealsEntregue,
      crmNovo: crmRes.count ?? 0,
      crmNovoFollowers,
      notifUnread: notifRes.count ?? 0,
      clients: clientsRes.count ?? 0,
      campaignsActive: campaignsRes.count ?? 0,
      topCurator,
      topCuratorShare,
      underdeliverDeals,
    });
    setActivity((logsRes.data ?? []) as ActivityRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  useSetSidebarKpis(
    s
      ? [
          { label: "Playlists", value: s.catalogPlaylists, intent: "default" },
          { label: "Curadores ativos", value: s.dealsActive, intent: "default" },
          { label: "Notificações", value: s.notifUnread, intent: s.notifUnread > 0 ? "warning" : "default" },
        ]
      : [],
  );

  return (
    <>
      <PageHeader title="Hoje" subtitle="Cockpit" />

      <PageContainer>
        {/* PULSO DO SISTEMA — 4 KPIs principais */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <PulseCard
            to="/playlists"
            icon={Music2}
            label="Catálogo"
            value={loading ? "—" : formatNumber(s?.catalogPlaylists)}
            hint={loading ? " " : `${formatNumber(s?.catalogFollowers)} seguidores`}
            accent="text-foreground"
          />
          <PulseCard
            to="/deals"
            icon={Handshake}
            label="Curadoria ativa"
            value={loading ? "—" : `R$ ${formatNumber(s?.dealsValor)}`}
            hint={loading ? " " : `${s?.dealsActive ?? 0} deals abertos`}
            accent="text-primary"
          />
          <PulseCard
            to="/curadores"
            icon={UserPlus}
            label="Prospecção CRM"
            value={loading ? "—" : formatNumber(s?.crmNovo)}
            hint={loading ? " " : `${formatNumber(s?.crmNovoFollowers)} seguidores`}
            accent="text-foreground"
          />
          <PulseCard
            to="/sistema?tab=alertas"
            icon={Bell}
            label="Notificações"
            value={loading ? "—" : formatNumber(s?.notifUnread)}
            hint={s && s.notifUnread > 0 ? "não lidas" : "tudo limpo"}
            accent={s && s.notifUnread > 0 ? "text-warning" : "text-foreground"}
            highlight={!!s && s.notifUnread > 0}
          />
        </section>

        {/* KPIs DAS PLAYLISTS GERIDAS */}
        <ManagedPlaylistsKpis />

        {/* AÇÃO AGORA */}
        <section className="space-y-3">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
            Ação agora
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PlaylistsInDeclineCard />
            <DealsPendingCard />
          </div>
        </section>

        {/* CURADORIA — entrega & risco */}
        <section className="space-y-3">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
            Curadoria · entrega & risco
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DeliveryCard s={s} loading={loading} />
            <ConcentrationCard s={s} loading={loading} />
          </div>
        </section>

        {/* CRM — prospecção pendente */}
        <section className="space-y-3">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
            CRM · prospecção pendente
          </h2>
          <ProspectionCard s={s} loading={loading} />
        </section>

        {/* ALERTAS DOS CURADORES */}
        <section className="space-y-3">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
            Alertas dos curadores
          </h2>
          <ProactiveAlertsCard />
        </section>

        {/* RESUMO SEMANAL */}
        <section className="space-y-3">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
            Resumo semanal
          </h2>
          <WeeklySummaryCard />
        </section>

        {/* SAÚDE DO SISTEMA */}
        <section className="space-y-3">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
            Saúde do sistema
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <OperationalHealthCard />
            <BrainFreshnessCard />
          </div>
        </section>

        {/* ATIVIDADE RECENTE */}
        <section className="space-y-3">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
            Atividade recente
          </h2>
          <div className="nx-card overflow-hidden">
            {loading && activity.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground">Carregando…</div>
            )}
            {!loading && activity.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground">Sem atividade registrada.</div>
            )}
            <ul className="divide-y divide-border">
              {activity.map(l => {
                const tone =
                  l.status === "sucesso" ? "text-primary bg-primary/10"
                  : l.status === "erro" ? "text-destructive bg-destructive/10"
                  : "text-warning bg-warning/10";
                return (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={cn("h-7 w-7 rounded-full flex items-center justify-center shrink-0", tone)}>
                      <Activity className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold leading-tight truncate">{prettyAction(l.acao)}</div>
                      {l.mensagem && (
                        <div className="text-[11px] text-muted-foreground truncate mt-0.5">{prettyMessage(l.mensagem)}</div>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                      {timeAgo(l.created_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </PageContainer>
    </>
  );
}

/* ============================================================
 * Subcomponentes
 * ============================================================ */

function PulseCard({
  to, icon: Icon, label, value, hint, accent = "text-foreground", highlight = false,
}: {
  to: string;
  icon: any;
  label: string;
  value: string;
  hint: string;
  accent?: string;
  highlight?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "nx-card-hover p-4 flex flex-col gap-2 group min-h-[110px]",
        highlight && "ring-1 ring-warning/40",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            {label}
          </span>
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className={cn("text-2xl font-bold tabular-nums leading-none", accent)}>{value}</div>
      <div className="text-[11px] text-muted-foreground truncate">{hint}</div>
    </Link>
  );
}

function DeliveryCard({ s, loading }: { s: Snapshot | null; loading: boolean }) {
  const pct = s && s.dealsTarget > 0 ? (s.dealsEntregue / s.dealsTarget) * 100 : 0;
  return (
    <Link to="/deals" className="nx-card-hover p-5 flex flex-col gap-4 group h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Entrega global dos deals
          </span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      {loading ? (
        <div className="h-20 rounded-md bg-muted/40 animate-pulse" />
      ) : (
        <>
          <div className="grid grid-cols-3 rounded-xl border border-border/60 bg-muted/10 overflow-hidden divide-x divide-border/60">
            <div className="flex flex-col items-center justify-center text-center py-4 px-2">
              <div className="text-xl font-bold tabular-nums leading-none">{formatNumber(s?.dealsTarget)}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Contratado</div>
            </div>
            <div className="flex flex-col items-center justify-center text-center py-4 px-2">
              <div className="text-xl font-bold tabular-nums leading-none text-primary">{formatNumber(s?.dealsEntregue)}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Entregue</div>
            </div>
            <div className="flex flex-col items-center justify-center text-center py-4 px-2">
              <div className={cn("text-xl font-bold tabular-nums leading-none", pct < 5 ? "text-destructive" : pct < 30 ? "text-warning" : "text-primary")}>
                {pct.toFixed(1)}%
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Progresso</div>
            </div>
          </div>
          <div className="h-1.5 w-full bg-muted/40 rounded-full overflow-hidden">
            <div
              className={cn("h-full transition-all", pct < 5 ? "bg-destructive" : pct < 30 ? "bg-warning" : "bg-primary")}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          {(s?.underdeliverDeals ?? 0) > 0 && (
            <div className="text-xs text-warning flex items-center justify-center gap-1.5 text-center">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span><b>{s?.underdeliverDeals}</b> deals com entrega abaixo de 1%</span>
            </div>
          )}
        </>
      )}
    </Link>
  );
}

function ConcentrationCard({ s, loading }: { s: Snapshot | null; loading: boolean }) {
  const top = s?.topCurator;
  const share = s?.topCuratorShare ?? 0;
  const risk = share > 50;
  return (
    <Link to="/curadores" className="nx-card-hover p-5 flex flex-col gap-4 group h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Concentração de receita
          </span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      {loading ? (
        <div className="h-20 rounded-md bg-muted/40 animate-pulse" />
      ) : !top ? (
        <div className="text-xs text-muted-foreground py-4">Nenhum deal aberto.</div>
      ) : (
        <>
          <div className="flex-1 flex flex-col items-center justify-center text-center rounded-xl border border-border/60 bg-muted/10 py-6 px-4 gap-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Maior curador</div>
            <div className="text-lg font-bold leading-tight truncate max-w-full">{top.name}</div>
            <div className={cn("text-4xl font-bold tabular-nums mt-1", risk ? "text-destructive" : "text-foreground")}>
              {share.toFixed(0)}%
            </div>
            <div className="text-[11px] text-muted-foreground">
              R$ {formatNumber(top.valor)} de R$ {formatNumber(s?.dealsValor)}
            </div>
          </div>
          {risk && (
            <div className="text-xs text-destructive flex items-center justify-center gap-1.5 text-center">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Risco alto — diversifique a base de curadores</span>
            </div>
          )}
        </>
      )}
    </Link>
  );
}

function ProspectionCard({ s, loading }: { s: Snapshot | null; loading: boolean }) {
  const novo = s?.crmNovo ?? 0;
  return (
    <Link to="/curadores?tab=prospeccao" className="nx-card-hover p-5 flex items-center gap-5 group">
      <div className="h-12 w-12 rounded-full flex items-center justify-center bg-primary/10 text-primary shrink-0">
        <UserPlus className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        {loading ? (
          <div className="h-10 rounded-md bg-muted/40 animate-pulse" />
        ) : (
          <>
            <div className="text-sm font-semibold leading-tight">
              <b className="text-foreground tabular-nums">{formatNumber(novo)}</b> curadores nunca contactados
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              {formatNumber(s?.crmNovoFollowers)} seguidores em potencial · acionar prospecção
            </div>
          </>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </Link>
  );
}

function prettyAction(a: string): string {
  const map: Record<string, string> = {
    "analyze-genre": "Análise de gênero",
    "collect-batch": "Coleta de playlists",
    "daily-collect": "Coleta diária",
    "enrich-playlists": "Enriquecimento",
    "track-playlist-metrics": "Coleta de métricas",
    "track_playlist_metrics": "Coleta de métricas",
    "track_external_metrics": "Métricas externas",
    "learning-loop": "Aprendizado contínuo",
    "audit-brain": "Auditoria do cérebro",
    "recover_print_batches": "Recuperação de evidências",
    "spotify_token_watchdog": "Verificação do token Spotify",
    "fetch_tracks_spotify": "Leitura de faixas no Spotify",
    "fetch-tracks-spotify": "Leitura de faixas no Spotify",
    "bot_ingest_dom": "Bot leu dados do Spotify",
    "bot_collect": "Bot coletou dados do Spotify",
    "sync-kworb-charts": "Sincronização Top 200 (kworb)",
  };
  return map[a] ?? a.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function prettyMessage(msg: string | null | undefined): string {
  if (!msg) return "";
  const m = msg.trim();
  // stuck=0 dispatched=0
  const stuckMatch = m.match(/stuck=(\d+)\s+dispatched=(\d+)/);
  if (stuckMatch) {
    const [, stuck, disp] = stuckMatch;
    if (stuck === "0" && disp === "0") return "Nenhum lote travado · nada a redespachar";
    return `${stuck} travados · ${disp} redespachados`;
  }
  // checked=1 ok=1 fail=0 app_refreshed=false
  const checkMatch = m.match(/checked=(\d+)\s+ok=(\d+)\s+fail=(\d+)(?:\s+app_refreshed=(\w+))?/);
  if (checkMatch) {
    const [, , ok, fail, refreshed] = checkMatch;
    const base = `${ok} válidos · ${fail} com falha`;
    return refreshed === "true" ? `${base} · token renovado` : base;
  }
  return m;
}

