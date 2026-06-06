import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, Users, Layers, Activity, Search, Download, ArrowUpDown } from "lucide-react";
import { formatInt } from "@/lib/campaignEngine";
import { cn } from "@/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import { usePlaylistCovers, type PlaylistMeta } from "@/hooks/usePlaylistCovers";
import { PlaylistCell } from "./PlaylistCell";
import { KpiBig } from "@/components/KpiBig";
import { useIsMobile } from "@/hooks/use-mobile";

type GrowthRow = {
  campaign_id: string;
  playlist_id: string;
  playlist_url: string | null;
  current_name: string | null;
  baseline_name: string | null;
  baseline_plays: number | null;
  current_plays: number | null;
  delta: number;
  baseline_at: string | null;
  last_captured_at: string | null;
  first_seen_at: string | null;
  attributed_to: string;
  attributed_curator_id: string | null;
  is_baseline_conflict: boolean | null;
};

type CuratorMeta = { id: string; name: string | null };
type SortKey = "delta" | "current" | "baseline" | "name";

const ROW_H = 64;
const ROW_H_MOBILE = 56;

export function ExecucaoView({
  campaignId,
  onOpenHistory,
  mode = "all",
}: {
  campaignId: string;
  onOpenHistory?: (playlistId: string) => void;
  mode?: "all" | "ecosystem" | "curators" | "organic";
}) {
  const initialScope: "all" | "ecosystem" | "curator" | "organic" =
    mode === "curators" ? "curator" : mode === "ecosystem" ? "ecosystem" : mode === "organic" ? "organic" : "all";
  const scopeLocked = mode !== "all";
  const [rows, setRows] = useState<GrowthRow[] | null>(null);
  const [curators, setCurators] = useState<Record<string, CuratorMeta>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});

  // filters
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"all" | "ecosystem" | "curator" | "organic">(initialScope);
  const [curatorFilter, setCuratorFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("delta");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    (async () => {
      const { data: g } = await (supabase as any)
        .from("vw_campaign_playlist_growth")
        .select("*")
        .eq("campaign_id", campaignId);
      const list = ((g ?? []) as unknown) as GrowthRow[];
      setRows(list);

      const curatorIds = Array.from(new Set(list.map((r) => r.attributed_curator_id).filter(Boolean) as string[]));
      if (curatorIds.length > 0) {
        const [{ data: cs }, { data: ccp }] = await Promise.all([
          supabase.from("curators").select("id, name").in("id", curatorIds),
          supabase
            .from("curator_campaign_playlists")
            .select("playlist_id, curator_id, status")
            .eq("campaign_id", campaignId)
            .in("curator_id", curatorIds),
        ]);
        const cmap: Record<string, CuratorMeta> = {};
        for (const c of (cs ?? []) as CuratorMeta[]) cmap[c.id] = c;
        setCurators(cmap);
        const smap: Record<string, string> = {};
        for (const s of (ccp ?? []) as any[]) {
          smap[`${s.curator_id}::${s.playlist_id}`] = s.status;
        }
        setStatuses(smap);
      }
    })();
  }, [campaignId]);

  const totals = useMemo(() => {
    const t = { total: 0, eco: 0, curator: 0, organic: 0, conflict: 0, conflictCount: 0, n: rows?.length ?? 0 };
    for (const r of rows ?? []) {
      const d = Number(r.delta ?? 0);
      // Baseline conflict: NÃO é entrega válida. Não soma como crescimento da campanha
      // nem como crescimento de curador. Fica isolado num bucket próprio (informativo).
      if (r.is_baseline_conflict) {
        t.conflict += d;
        t.conflictCount += 1;
        continue;
      }
      t.total += d;
      if (r.attributed_to === "ecosystem") t.eco += d;
      else if (r.attributed_to.startsWith("curator:")) t.curator += d;
      else t.organic += d;
    }
    return t;
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const qn = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (scope === "ecosystem" && r.attributed_to !== "ecosystem") return false;
      if (scope === "curator" && !r.attributed_to.startsWith("curator:")) return false;
      if (scope === "organic" && (r.attributed_to === "ecosystem" || r.attributed_to.startsWith("curator:"))) return false;
      if (curatorFilter !== "all" && r.attributed_curator_id !== curatorFilter) return false;
      if (statusFilter !== "all") {
        const st = r.attributed_curator_id ? statuses[`${r.attributed_curator_id}::${r.playlist_id}`] ?? "pending_match" : null;
        if (st !== statusFilter) return false;
      }
      if (qn) {
        const name = (r.current_name ?? r.baseline_name ?? "").toLowerCase();
        if (!name.includes(qn) && !r.playlist_id.toLowerCase().includes(qn)) return false;
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    const pick = (r: GrowthRow): [number | string, number, number] => {
      const cur = Number(r.current_plays ?? 0);
      const base = Number(r.baseline_plays ?? 0);
      const del = Number(r.delta ?? 0);
      const primary = sort === "delta" ? del
        : sort === "current" ? cur
        : sort === "baseline" ? base
        : (r.current_name ?? r.baseline_name ?? "").toLowerCase();
      return [primary, cur, base];
    };
    out.sort((a, b) => {
      const [pa, ca, ba] = pick(a);
      const [pb, cb, bb] = pick(b);
      if (pa < pb) return -1 * dir;
      if (pa > pb) return 1 * dir;
      // tiebreakers: sempre desc (mais relevante primeiro), independente da direção
      if (cb !== ca) return cb - ca;
      return bb - ba;
    });
    return out;
  }, [rows, q, scope, curatorFilter, statusFilter, sort, sortDir, statuses]);

  const filteredTotals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        acc.baseline += Number(r.baseline_plays ?? 0);
        acc.current += Number(r.current_plays ?? 0);
        acc.delta += Number(r.delta ?? 0);
        return acc;
      },
      { baseline: 0, current: 0, delta: 0 }
    );
  }, [filtered]);

  const curatorOptions = useMemo(
    () =>
      Object.values(curators)
        .map((c) => ({ id: c.id, name: c.name ?? "Curador" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [curators]
  );

  const exportCsv = () => {
    const head = ["playlist_id", "playlist", "atribuicao", "curador", "status", "baseline", "atual", "delta", "first_seen", "ultima_coleta"];
    const lines = [head.join(",")];
    for (const r of filtered) {
      const cur = r.attributed_curator_id ? curators[r.attributed_curator_id]?.name ?? "" : "";
      const st = r.attributed_curator_id ? statuses[`${r.attributed_curator_id}::${r.playlist_id}`] ?? "" : "";
      const name = (r.current_name ?? r.baseline_name ?? "").replace(/"/g, '""');
      lines.push(
        [
          r.playlist_id,
          `"${name}"`,
          r.attributed_to,
          `"${cur}"`,
          st,
          r.baseline_plays ?? 0,
          r.current_plays ?? 0,
          r.delta,
          r.first_seen_at ?? "",
          r.last_captured_at ?? "",
        ].join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `execucao-${campaignId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const lastCapturedAt = useMemo(() => {
    let latest: string | null = null;
    for (const r of rows ?? []) {
      if (r.last_captured_at && (!latest || r.last_captured_at > latest)) latest = r.last_captured_at;
    }
    return latest;
  }, [rows]);

  if (!rows) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-4">
      {/* KPI grid — mesmo padrão de Performance (2 cols mobile / 4 cols desktop) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <KpiBig
          label="Crescimento total"
          value={`${totals.total > 0 ? "+" : ""}${formatInt(totals.total)}`}
          icon={TrendingUp}
          tone={totals.total > 0 ? "success" : "default"}
          hint={`${totals.n} playlists monitoradas`}
        />
        <KpiBig
          label="Ecossistema"
          value={`${totals.eco > 0 ? "+" : ""}${formatInt(totals.eco)}`}
          icon={Layers}
          domain="playlists"
          hint="Playlists internas"
        />
        <KpiBig
          label="Curadores"
          value={`${totals.curator > 0 ? "+" : ""}${formatInt(totals.curator)}`}
          icon={Users}
          domain="curators"
          hint="Atribuído a parceiros"
        />
        <KpiBig
          label="Orgânico"
          value={`${totals.organic > 0 ? "+" : ""}${formatInt(totals.organic)}`}
          icon={Activity}
          tone="default"
          hint={lastCapturedAt
            ? `Atualizado ${new Date(lastCapturedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${new Date(lastCapturedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
            : "Sem atribuição"}
        />
      </div>

      {totals.conflictCount > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-3 flex items-start gap-3">
            <span className="mt-0.5 h-2 w-2 rounded-full bg-destructive shrink-0" />
            <div className="text-[12px] text-foreground-body leading-relaxed">
              <strong className="text-destructive">Conflito de baseline:</strong>{" "}
              {totals.conflictCount} playlist(s) já continham a música antes do início da campanha.
              Não contam como entrega válida e foram excluídas dos totais de Curadores/Ecossistema.
              {totals.conflict !== 0 && (
                <> O Δ observado nelas ({totals.conflict > 0 ? "+" : ""}{formatInt(totals.conflict)}) reflete apenas ganho de posição, não entrega nova.</>
              )}
              {" "}Use o filtro <em>Status → Conflito baseline</em> para auditar.
            </div>
          </CardContent>
        </Card>
      )}



      <CuratorSummary
        rows={rows}
        curators={curators}
        statuses={statuses}
        onPick={(curatorId) => {
          setScope("curator");
          setCuratorFilter(curatorId);
        }}
      />



      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar playlist..."
              className="pl-8 h-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={scope} onValueChange={(v) => setScope(v as any)}>
              <SelectTrigger className="h-9 flex-1 min-w-0 md:flex-none md:w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas atribuições</SelectItem>
                <SelectItem value="ecosystem">Ecossistema</SelectItem>
                <SelectItem value="curator">Curadores</SelectItem>
                <SelectItem value="organic">Orgânico</SelectItem>
              </SelectContent>
            </Select>
            <Select value={curatorFilter} onValueChange={setCuratorFilter} disabled={scope === "ecosystem" || scope === "organic"}>
              <SelectTrigger className="h-9 flex-1 min-w-0 md:flex-none md:w-[180px]"><SelectValue placeholder="Curador" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos curadores</SelectItem>
                {curatorOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 flex-1 min-w-0 md:flex-none md:w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="matched">Matched</SelectItem>
                <SelectItem value="pending_match">Pending</SelectItem>
                <SelectItem value="baseline_conflict">Conflito baseline</SelectItem>
                <SelectItem value="not_found_yet">Not found</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-9 px-2 md:px-3 shrink-0" onClick={exportCsv}>
              <Download className="h-4 w-4 md:mr-1" /> <span className="hidden md:inline">CSV</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-muted-foreground border-b border-border/60 bg-card/40">
            <span className="shrink-0">{filtered.length}/{rows.length}</span>
            <span className="flex items-center gap-2 md:gap-3 tabular-nums">
              <span className="hidden xs:inline">Base <span className="text-foreground">{formatInt(filteredTotals.baseline)}</span></span>
              <span>Atual <span className="text-foreground">{formatInt(filteredTotals.current)}</span></span>
              <span>Δ <span className={cn("font-semibold", filteredTotals.delta > 0 ? "text-primary" : "text-muted-foreground")}>{filteredTotals.delta > 0 ? "+" : ""}{formatInt(filteredTotals.delta)}</span></span>
            </span>
          </div>
          <VirtualTable
            rows={filtered}
            curators={curators}
            statuses={statuses}
            sort={sort}
            sortDir={sortDir}
            onSort={(k) => {
              if (sort === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
              else { setSort(k); setSortDir("desc"); }
            }}
            onRowClick={onOpenHistory}
          />
        </CardContent>
      </Card>

    </div>
  );
}

function VirtualTable({
  rows,
  curators,
  statuses,
  sort,
  sortDir,
  onSort,
  onRowClick,
}: {
  rows: GrowthRow[];
  curators: Record<string, CuratorMeta>;
  statuses: Record<string, string>;
  sort: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  onRowClick?: (playlistId: string) => void;
}) {
  const isMobile = useIsMobile();
  const parentRef = useRef<HTMLDivElement>(null);
  const covers = usePlaylistCovers(rows.map((r) => r.playlist_id));
  const rowH = isMobile ? ROW_H_MOBILE : ROW_H;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 12,
  });

  if (rows.length === 0) {
    return <div className="p-8 text-center text-muted-foreground">Sem playlists para os filtros atuais.</div>;
  }

  return (
    <div>
      {/* Header — só desktop. Mobile usa layout em linha sem cabeçalho. */}
      <div className="hidden md:grid grid-cols-[44px_minmax(220px,2fr)_120px_110px_110px_120px_140px_150px] gap-3 px-4 py-2.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground border-b border-border bg-card/40">
        <div className="text-right">#</div>
        <SortHeader label="Playlist" k="name" sort={sort} dir={sortDir} onSort={onSort} />
        <div>Atribuição</div>
        <SortHeader label="Baseline" k="baseline" sort={sort} dir={sortDir} onSort={onSort} className="text-right justify-end" />
        <SortHeader label="Atual" k="current" sort={sort} dir={sortDir} onSort={onSort} className="text-right justify-end" />
        <SortHeader label="Δ" k="delta" sort={sort} dir={sortDir} onSort={onSort} className="text-right justify-end" />
        <div>Status</div>
        <div>Última coleta</div>
      </div>

      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ height: Math.min(640, Math.max(240, rows.length * rowH + 8)) }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const r = rows[vi.index];
            const meta: PlaylistMeta | undefined = covers[r.playlist_id];
            const curName = r.attributed_curator_id ? curators[r.attributed_curator_id]?.name ?? "Curador" : null;
            const st = r.attributed_curator_id ? statuses[`${r.attributed_curator_id}::${r.playlist_id}`] ?? "pending_match" : null;
            const isEven = vi.index % 2 === 0;
            const baseStyle: React.CSSProperties = {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: vi.size,
              transform: `translateY(${vi.start}px)`,
            };

            if (isMobile) {
              return (
                <div
                  key={vi.key}
                  onClick={() => onRowClick?.(r.playlist_id)}
                  className={cn(
                    "flex items-center gap-2.5 px-3 border-b border-border/40 hover:bg-accent/40 transition-colors",
                    isEven ? "bg-transparent" : "bg-card/30",
                    onRowClick && "cursor-pointer",
                  )}
                  style={baseStyle}
                >
                  <div className="w-5 text-right tabular-nums text-[10px] text-muted-foreground font-mono shrink-0">
                    {vi.index + 1}
                  </div>
                  <MobileCover
                    playlistId={r.playlist_id}
                    url={r.playlist_url}
                    coverUrl={meta?.cover_url ?? null}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-foreground truncate leading-tight">
                      {r.current_name ?? r.baseline_name ?? meta?.name ?? "—"}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground min-w-0">
                      <AttributionDot attr={r.attributed_to} />
                      <span className="truncate">
                        {r.attributed_to === "ecosystem"
                          ? "Ecossistema"
                          : r.attributed_to.startsWith("curator:")
                            ? curName ?? "Curador"
                            : "Orgânico"}
                      </span>
                      {meta?.followers != null && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="tabular-nums">{Intl.NumberFormat("pt-BR").format(meta.followers)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 leading-tight">
                    <div
                      className={cn(
                        "text-[13px] font-semibold tabular-nums",
                        Number(r.delta) > 0 ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {Number(r.delta) > 0 ? "+" : ""}{formatInt(Number(r.delta ?? 0))}
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                      {formatInt(Number(r.current_plays ?? 0))}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={vi.key}
                onClick={() => onRowClick?.(r.playlist_id)}
                className={cn(
                  "grid grid-cols-[44px_minmax(220px,2fr)_120px_110px_110px_120px_140px_150px] gap-3 items-center px-4 border-b border-border/40 hover:bg-accent/40 transition-colors",
                  isEven ? "bg-transparent" : "bg-card/30",
                  onRowClick && "cursor-pointer",
                )}
                style={baseStyle}
              >
                <div className="text-right tabular-nums text-xs text-muted-foreground font-mono">
                  {vi.index + 1}
                </div>

                <PlaylistCell
                  playlistId={r.playlist_id}
                  name={r.current_name ?? r.baseline_name ?? meta?.name ?? null}
                  url={r.playlist_url}
                  coverUrl={meta?.cover_url ?? null}
                  followers={meta?.followers ?? null}
                />
                <AttributionBadge attr={r.attributed_to} curatorName={curName} />
                <div className="text-right tabular-nums text-muted-foreground text-sm">{formatInt(Number(r.baseline_plays ?? 0))}</div>
                <div className="text-right tabular-nums text-foreground text-sm">{formatInt(Number(r.current_plays ?? 0))}</div>
                <div className={cn("text-right tabular-nums font-semibold text-sm", Number(r.delta) > 0 ? "text-primary" : "text-muted-foreground")}>
                  {Number(r.delta) > 0 ? "+" : ""}{formatInt(Number(r.delta ?? 0))}
                </div>
                <div>{st ? <MatchStatusBadge status={st} /> : <span className="text-xs text-muted-foreground">—</span>}</div>
                <div className="text-muted-foreground text-xs">
                  {r.last_captured_at ? new Date(r.last_captured_at).toLocaleString("pt-BR") : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

function SortHeader({
  label, k, sort, dir, onSort, className,
}: { label: string; k: SortKey; sort: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort === k;
  return (
    <button
      onClick={() => onSort(k)}
      className={cn("flex items-center gap-1 hover:text-foreground transition-colors text-left", active && "text-foreground", className)}
    >
      {label}
      <ArrowUpDown className={cn("h-3 w-3 opacity-50", active && "opacity-100")} />
      {active && <span className="text-[10px]">{dir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
}

function AttributionBadge({ attr, curatorName }: { attr: string; curatorName: string | null }) {
  if (attr === "ecosystem") return <Badge variant="outline" className="border-blue-500/40 text-blue-400">Ecossistema</Badge>;
  if (attr.startsWith("curator:")) return <Badge variant="outline" className="border-purple-500/40 text-purple-400 truncate max-w-full">{curatorName ?? "Curador"}</Badge>;
  return <Badge variant="outline" className="border-pink-500/40 text-pink-400">Orgânico</Badge>;
}

function AttributionDot({ attr }: { attr: string }) {
  const cls =
    attr === "ecosystem" ? "bg-blue-400"
    : attr.startsWith("curator:") ? "bg-purple-400"
    : "bg-pink-400";
  return <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cls)} aria-hidden />;
}

function MobileCover({
  playlistId, url, coverUrl,
}: { playlistId: string; url: string | null | undefined; coverUrl: string | null }) {
  const href = url || `https://open.spotify.com/playlist/${playlistId}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="h-9 w-9 shrink-0 rounded-md overflow-hidden bg-muted border border-border flex items-center justify-center"
    >
      {coverUrl ? (
        <img src={coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span className="text-[10px] text-muted-foreground">♪</span>
      )}
    </a>
  );
}


function MatchStatusBadge({ status }: { status: string }) {
  if (status === "matched") return <Badge className="bg-primary text-primary-foreground">matched</Badge>;
  if (status === "pending_match") return <Badge variant="outline">pending</Badge>;
  if (status === "baseline_conflict") return <Badge variant="outline" className="border-destructive/40 text-destructive">conflito baseline</Badge>;
  if (status === "not_found_yet") return <Badge variant="outline" className="border-destructive/40 text-destructive">not found</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function KpiCard({ icon: Icon, label, value, accent, raw }: { icon: any; label: string; value: number; accent?: boolean; raw?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
          <Icon className="h-3 w-3" /> {label}
        </div>
        <div className={cn("mt-2 text-2xl font-semibold tabular-nums", accent && "text-primary")}>
          {raw ? value : formatInt(value)}
        </div>
      </CardContent>
    </Card>
  );
}

function KpiCell({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="px-2 py-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-base font-semibold tabular-nums truncate", accent && "text-primary")}>
        {value > 0 && accent ? "+" : ""}{formatInt(value)}
      </div>
    </div>
  );
}

function CuratorSummary({
  rows,
  curators,
  statuses,
  onPick,
}: {
  rows: GrowthRow[];
  curators: Record<string, CuratorMeta>;
  statuses: Record<string, string>;
  onPick: (curatorId: string) => void;
}) {
  const summary = useMemo(() => {
    const map = new Map<string, { playlists: number; matched: number; pending: number; conflict: number; notFound: number; delta: number }>();
    for (const r of rows) {
      if (!r.attributed_curator_id) continue;
      const cur = r.attributed_curator_id;
      const agg = map.get(cur) ?? { playlists: 0, matched: 0, pending: 0, conflict: 0, notFound: 0, delta: 0 };
      agg.playlists += 1;
      // Δ de baseline_conflict NÃO conta como crescimento atribuído ao curador
      if (!r.is_baseline_conflict) agg.delta += Number(r.delta ?? 0);
      const st = statuses[`${cur}::${r.playlist_id}`] ?? "pending_match";
      if (st === "matched") agg.matched += 1;
      else if (st === "baseline_conflict") agg.conflict += 1;
      else if (st === "not_found_yet") agg.notFound += 1;
      else agg.pending += 1;
      map.set(cur, agg);
    }
    return Array.from(map.entries())
      .map(([id, s]) => ({ id, name: curators[id]?.name ?? "Curador", ...s }))
      .sort((a, b) => b.delta - a.delta);
  }, [rows, curators, statuses]);

  if (summary.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <div className="text-sm font-semibold text-foreground">Resumo por curador</div>
            <div className="text-xs text-muted-foreground">{summary.length} curador(es) com playlists atribuídas</div>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_80px_80px_80px_90px_110px_60px] gap-3 px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground border-b border-border/60 bg-card/40">
          <div>Curador</div>
          <div className="text-right">Playlists</div>
          <div className="text-right">Matched</div>
          <div className="text-right">Pending</div>
          <div className="text-right">Conflito</div>
          <div className="text-right">Δ</div>
          <div />
        </div>
        <div className="max-h-[320px] overflow-auto">
          {summary.map((s) => (
            <div
              key={s.id}
              className="grid grid-cols-[1fr_80px_80px_80px_90px_110px_60px] gap-3 items-center px-4 py-2.5 border-b border-border/40 hover:bg-accent/30"
            >
              <div className="font-medium text-foreground text-sm truncate">{s.name}</div>
              <div className="text-right tabular-nums text-sm text-foreground">{s.playlists}</div>
              <div className="text-right tabular-nums text-sm text-primary">{s.matched}</div>
              <div className="text-right tabular-nums text-sm text-muted-foreground">{s.pending}</div>
              <div className={cn("text-right tabular-nums text-sm", s.conflict > 0 ? "text-destructive font-semibold" : "text-muted-foreground")}>{s.conflict}</div>
              <div className={cn("text-right tabular-nums text-sm font-semibold", s.delta > 0 ? "text-primary" : "text-muted-foreground")}>
                {s.delta > 0 ? "+" : ""}{formatInt(s.delta)}
              </div>
              <div className="text-right">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onPick(s.id)}>ver</Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

