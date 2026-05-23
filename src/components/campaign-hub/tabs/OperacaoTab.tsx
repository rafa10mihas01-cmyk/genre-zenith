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
  managed_playlist_id: string;
  plays_24h: number | null;
  plays_7d: number | null;
  plays_28d: number | null;
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
    const m = new Map<string, EcoSnap>();
    for (const s of snapshots) if (!m.has(s.managed_playlist_id)) m.set(s.managed_playlist_id, s);
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

  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-elevated/30 transition-colors">
      <td className="px-4 py-3 align-middle">
        <Badge
          variant="outline"
          className={cn(
            "gap-1 text-[10px] uppercase font-semibold border-2",
            isInternal
              ? "border-primary/40 text-primary"
              : "border-purple-500/40 text-purple-400",
          )}
        >
          {isInternal ? <Sparkles className="h-3 w-3" /> : <Users className="h-3 w-3" />}
          {isInternal ? "NexEngine" : "Curador"}
        </Badge>
      </td>
      <td className="px-4 py-3 align-middle min-w-[200px]">
        <div className="flex items-center gap-2.5">
          {row.cover_url ? (
            <img src={row.cover_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded bg-muted grid place-items-center shrink-0">
              <Music className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0">
            <div className="font-medium truncate leading-tight">{row.name}</div>
            <div className="text-[11px] text-muted-foreground truncate">{row.subtitle}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 align-middle text-right min-w-[180px]">
        <div className="tabular-nums text-xs font-medium">
          {formatInt(row.delivered)} <span className="text-muted-foreground">/ {formatInt(row.planned)}</span>
        </div>
        <div className="h-1 rounded-full bg-muted overflow-hidden mt-1.5">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      </td>
      <td className="px-4 py-3 align-middle text-right tabular-nums text-xs">
        {row.cost > 0 ? formatBRL(row.cost) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3 align-middle">
        <span className="text-xs text-foreground-body">{statusLabel}</span>
      </td>
      <td className="px-4 py-3 align-middle text-right">
        <div className="flex items-center justify-end gap-2">
          {row.spotify_url && (
            <a
              href={row.spotify_url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
              title="Abrir no Spotify"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {row.deal_link && (
            <Link
              to={row.deal_link}
              className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              Ver deal
            </Link>
          )}
        </div>
      </td>
    </tr>
  );
}

function SummaryKpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className="text-xl font-semibold tabular-nums leading-tight mt-1">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function pct(a: number, b: number) {
  if (!b) return 0;
  return Math.round((a / b) * 100);
}
