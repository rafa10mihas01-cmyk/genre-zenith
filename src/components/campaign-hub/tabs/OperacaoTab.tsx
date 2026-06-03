import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Music, Users, ExternalLink, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { EcoAllocation } from "../types";

type EcoSnap = {
  id?: string;
  managed_playlist_id: string;
  plays_24h: number | null;
  plays_7d: number | null;
  plays_28d: number | null;
  captured_at?: string;
};

export type ExternalItemRow = {
  id: string;
  curator_name: string;
  assigned_streams: number;
  assigned_cost: number;
  curator_deal_id: string | null;
  delivered_plays: number;
  state: string | null;
};

type Row = {
  key: string;
  source: "internal" | "external";
  name: string;
  subtitle: string;
  cover_url: string | null;
  spotify_url: string | null;
  planned: number;
  delivered: number;
  cost: number;
  status: string;
  deal_link?: string | null;
};

type Props = {
  allocations: EcoAllocation[];
  snapshots: EcoSnap[];
  externalItems: ExternalItemRow[];
  totalDays?: number;
  startedAt?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  active: "No ar",
  dispatched: "No ar",
  done: "Concluído",
  pending: "Aguardando",
  awaiting_playlists: "Aguardando",
  paused: "Pausado",
  failed: "Falhou",
  cancelled: "Cancelado",
};

const ROW_LIMIT = 50;

export function OperacaoTab({ allocations, snapshots, externalItems, totalDays, startedAt }: Props) {
  const [expanded, setExpanded] = useState(false);
  const latestSnap = useMemo(() => {
    // Determinístico: maior captured_at por playlist, desempate por id.
    // Sem isso, duas abas podem mostrar totais diferentes porque a query
    // .order("captured_at desc").limit(500) não tem tiebreaker e o Postgres
    // devolve linhas com timestamps iguais em ordem indeterminada.
    const m = new Map<string, EcoSnap>();
    for (const s of snapshots) {
      const prev = m.get(s.managed_playlist_id);
      if (!prev) { m.set(s.managed_playlist_id, s); continue; }
      const a = s.captured_at ? new Date(s.captured_at).getTime() : 0;
      const b = prev.captured_at ? new Date(prev.captured_at).getTime() : 0;
      if (a > b || (a === b && (s.id ?? "") > (prev.id ?? ""))) m.set(s.managed_playlist_id, s);
    }
    return m;
  }, [snapshots]);

  const rows: Row[] = useMemo(() => {
    const internal: Row[] = allocations.map((a) => {
      const snap = latestSnap.get(a.managed_playlist_id);
      const delivered = Number(snap?.plays_28d ?? snap?.plays_7d ?? snap?.plays_24h ?? 0);
      return {
        key: `int-${a.id}`,
        source: "internal",
        name: a.managed_playlists?.name ?? "Playlist própria",
        subtitle: `${formatInt(a.managed_playlists?.followers ?? 0)} saves`,
        cover_url: a.managed_playlists?.cover_url ?? null,
        spotify_url: a.managed_playlists?.spotify_url ?? null,
        planned: a.planned_streams,
        delivered,
        cost: 0,
        status: a.status,
      };
    });

    const external: Row[] = externalItems.map((it) => ({
      key: `ext-${it.id}`,
      source: "external",
      name: it.curator_name,
      subtitle: "Curador externo",
      cover_url: null,
      spotify_url: null,
      planned: it.assigned_streams,
      delivered: it.delivered_plays,
      cost: it.assigned_cost,
      status: it.state ?? "pending",
      deal_link: it.curator_deal_id ? `/playlist-deals/${it.curator_deal_id}` : null,
    }));

    // Sort: ativos primeiro (delivered > 0 ou status ativo), depois pendentes
    const order = (r: Row) => {
      const isLive = r.delivered > 0 || r.status === "active" || r.status === "dispatched";
      return isLive ? 0 : 1;
    };
    return [...internal, ...external].sort((a, b) => order(a) - order(b) || b.delivered - a.delivered);
  }, [allocations, externalItems, latestSnap]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.planned += r.planned;
        acc.delivered += r.delivered;
        acc.cost += r.cost;
        if (r.source === "internal") acc.internalCount += 1;
        else acc.externalCount += 1;
        return acc;
      },
      { planned: 0, delivered: 0, cost: 0, internalCount: 0, externalCount: 0 },
    );
  }, [rows]);

  const [filter, setFilter] = useState<"all" | "internal" | "external">("all");
  const filteredRows = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.source === filter)),
    [rows, filter],
  );

  const scope = useMemo(() => {
    const planned = filteredRows.reduce((s, r) => s + r.planned, 0);
    const delivered = filteredRows.reduce((s, r) => s + r.delivered, 0);
    const cost = filteredRows.reduce((s, r) => s + r.cost, 0);
    const remaining = Math.max(0, planned - delivered);
    const coverage = planned > 0 ? Math.round((delivered / planned) * 100) : 0;

    const days = Math.max(1, totalDays ?? 30);
    let daysElapsed = 0;
    if (startedAt) {
      const ms = Date.now() - new Date(startedAt).getTime();
      daysElapsed = Math.max(0, Math.floor(ms / 86400000));
    }
    const daysLeft = Math.max(1, days - daysElapsed);
    const dailyNeeded = Math.round(remaining / daysLeft);

    return { planned, delivered, remaining, cost, coverage, dailyNeeded, daysLeft, days };
  }, [filteredRows, totalDays, startedAt]);

  const scopeLabel = filter === "internal" ? "interno" : filter === "external" ? "externo" : "total";

  return (
    <div className="space-y-4">
      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList>
          <TabsTrigger value="all">Todas <span className="ml-1.5 text-[10px] text-muted-foreground tabular-nums">{rows.length}</span></TabsTrigger>
          <TabsTrigger value="internal">Interno <span className="ml-1.5 text-[10px] text-muted-foreground tabular-nums">{totals.internalCount}</span></TabsTrigger>
          <TabsTrigger value="external">Externo <span className="ml-1.5 text-[10px] text-muted-foreground tabular-nums">{totals.externalCount}</span></TabsTrigger>
        </TabsList>

        <TabsContent value={filter} className="mt-3 space-y-3">
          {/* Régua de entrega — compacta, uma linha */}
          <div className="grid grid-cols-3 gap-2">
            <SummaryKpi label="Entregue" value={formatInt(scope.delivered)} sub={`de ${formatInt(scope.planned)}`} />
            <SummaryKpi label="Falta" value={formatInt(scope.remaining)} sub={scope.remaining === 0 ? "meta batida" : "pra bater"} />
            <SummaryKpi label="Cobertura" value={`${scope.coverage}%`} sub={scope.coverage >= 100 ? "no alvo" : scope.coverage >= 80 ? "perto" : "abaixo"} />
          </div>

          {filteredRows.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                Nenhuma fonte {filter === "internal" ? "interna" : filter === "external" ? "externa" : ""} nesta campanha.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y divide-border/40">
                  {(expanded ? filteredRows : filteredRows.slice(0, ROW_LIMIT)).map((r) => (
                    <OperacaoRow key={r.key} row={r} />
                  ))}
                </ul>
                {filteredRows.length > ROW_LIMIT && (
                  <div className="border-t border-border px-3 py-2 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground tabular-nums">
                      {expanded
                        ? `Mostrando todas (${filteredRows.length})`
                        : `Mostrando ${ROW_LIMIT} de ${filteredRows.length}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpanded((v) => !v)}
                      className="text-primary hover:underline font-medium"
                    >
                      {expanded ? "Mostrar menos" : `Ver todas (+${filteredRows.length - ROW_LIMIT})`}
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OperacaoRow({ row }: { row: Row }) {
  const progress = row.planned > 0 ? Math.min(100, Math.round((row.delivered / row.planned) * 100)) : 0;
  const statusLabel = STATUS_LABEL[row.status] ?? row.status;
  const isInternal = row.source === "internal";
  const isLive = row.status === "active" || row.status === "dispatched" || row.delivered > 0;
  const dotColor = isLive
    ? "bg-primary"
    : row.status === "paused" || row.status === "failed" || row.status === "cancelled"
      ? "bg-destructive/70"
      : "bg-muted-foreground/40";

  return (
    <li className="flex items-center gap-3 px-3 py-1.5 hover:bg-elevated/30 transition-colors text-xs">
      {/* Status dot + fonte */}
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColor)} title={statusLabel} />
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[9px] uppercase font-semibold shrink-0 w-[58px]",
          isInternal ? "text-primary" : "text-purple-400",
        )}
      >
        {isInternal ? <Sparkles className="h-2.5 w-2.5" /> : <Users className="h-2.5 w-2.5" />}
        {isInternal ? "Engine" : "Curador"}
      </span>

      {/* Capa + nome */}
      {row.cover_url ? (
        <img src={row.cover_url} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
      ) : (
        <div className="w-6 h-6 rounded bg-muted grid place-items-center shrink-0">
          <Music className="h-3 w-3 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate leading-tight">{row.name}</div>
        <div className="text-[10px] text-muted-foreground truncate leading-tight">{row.subtitle}</div>
      </div>

      {/* Custo (só externos com custo) */}
      {row.cost > 0 && (
        <span className="tabular-nums text-[11px] text-muted-foreground shrink-0 w-16 text-right">
          {formatBRL(row.cost)}
        </span>
      )}

      {/* Barra + entrega — coluna fixa */}
      <div className="shrink-0 w-[180px]">
        <div className="flex items-baseline justify-between gap-2 text-[11px] leading-none">
          <span className="tabular-nums font-medium">{formatInt(row.delivered)}</span>
          <span className="tabular-nums text-muted-foreground">/ {formatInt(row.planned)}</span>
        </div>
        <div className="h-0.5 rounded-full bg-muted overflow-hidden mt-1">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Ações */}
      <div className="flex items-center gap-1.5 shrink-0 w-12 justify-end">
        {row.spotify_url && (
          <a
            href={row.spotify_url}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground"
            title="Abrir no Spotify"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {row.deal_link && (
          <Link
            to={row.deal_link}
            className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            deal
          </Link>
        )}
      </div>
    </li>
  );
}

function SummaryKpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
        {sub && <span className="text-[10px] text-muted-foreground truncate">{sub}</span>}
      </div>
      <div className="text-base font-semibold tabular-nums leading-tight mt-0.5">{value}</div>
    </div>
  );
}
