import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, TrendingUp, Users, Layers, Activity } from "lucide-react";
import { formatInt } from "@/lib/campaignEngine";
import { cn } from "@/lib/utils";

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
};

type CuratorMeta = { id: string; name: string | null };
type CuratorPlaylistStatus = { playlist_id: string; curator_id: string; status: string };

export function ExecucaoView({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<GrowthRow[] | null>(null);
  const [curators, setCurators] = useState<Record<string, CuratorMeta>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({}); // key: curator_id::playlist_id

  useEffect(() => {
    (async () => {
      const { data: g } = await supabase
        .from("vw_campaign_playlist_growth" as any)
        .select("*")
        .eq("campaign_id", campaignId);
      const list = (g ?? []) as GrowthRow[];
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
        for (const s of (ccp ?? []) as CuratorPlaylistStatus[]) {
          smap[`${s.curator_id}::${s.playlist_id}`] = s.status;
        }
        setStatuses(smap);
      }
    })();
  }, [campaignId]);

  const groups = useMemo(() => {
    const eco: GrowthRow[] = [];
    const organic: GrowthRow[] = [];
    const byCurator = new Map<string, GrowthRow[]>();
    for (const r of rows ?? []) {
      if (r.attributed_to === "ecosystem") eco.push(r);
      else if (r.attributed_to.startsWith("curator:") && r.attributed_curator_id) {
        const arr = byCurator.get(r.attributed_curator_id) ?? [];
        arr.push(r);
        byCurator.set(r.attributed_curator_id, arr);
      } else organic.push(r);
    }
    return { eco, organic, byCurator };
  }, [rows]);

  if (!rows) return <Skeleton className="h-96 w-full" />;

  const sum = (arr: GrowthRow[], key: "baseline_plays" | "current_plays" | "delta") =>
    arr.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

  const totalDelta = sum(rows, "delta");
  const ecoDelta = sum(groups.eco, "delta");
  const curatorDelta = Array.from(groups.byCurator.values()).flat().reduce((a, r) => a + Number(r.delta ?? 0), 0);
  const organicDelta = sum(groups.organic, "delta");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard icon={TrendingUp} label="Crescimento total" value={totalDelta} accent />
        <KpiCard icon={Layers} label="Ecossistema" value={ecoDelta} />
        <KpiCard icon={Users} label="Curadores" value={curatorDelta} />
        <KpiCard icon={Activity} label="Orgânico" value={organicDelta} />
        <KpiCard icon={Layers} label="Playlists monitoradas" value={rows.length} raw />
      </div>

      <Section title="Ecossistema" count={groups.eco.length}>
        <GrowthTable rows={groups.eco} />
        <Subtotal rows={groups.eco} />
      </Section>

      <Section title="Curadores" count={Array.from(groups.byCurator.values()).flat().length}>
        {groups.byCurator.size === 0 ? (
          <EmptyState text="Nenhuma playlist atribuída a curador." />
        ) : (
          <div className="space-y-4">
            {Array.from(groups.byCurator.entries()).map(([curatorId, list]) => (
              <Card key={curatorId}>
                <CardContent className="p-0">
                  <div className="flex items-center justify-between p-4 border-b border-border">
                    <div>
                      <div className="font-semibold text-foreground">{curators[curatorId]?.name ?? "Curador"}</div>
                      <div className="text-xs text-muted-foreground">{list.length} playlist(s)</div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Entregue: <span className="text-foreground font-semibold tabular-nums">{formatInt(sum(list, "delta"))}</span>
                    </div>
                  </div>
                  <GrowthTable rows={list} showStatus statusFor={(r) => statuses[`${curatorId}::${r.playlist_id}`] ?? "pending_match"} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Orgânico" count={groups.organic.length}>
        <GrowthTable rows={groups.organic} showFirstSeen />
        <Subtotal rows={groups.organic} />
      </Section>
    </div>
  );
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

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">{count} playlist(s)</span>
      </div>
      {children}
    </div>
  );
}

function GrowthTable({
  rows,
  showStatus,
  showFirstSeen,
  statusFor,
}: {
  rows: GrowthRow[];
  showStatus?: boolean;
  showFirstSeen?: boolean;
  statusFor?: (r: GrowthRow) => string;
}) {
  if (rows.length === 0) return <EmptyState text="Sem playlists neste grupo." />;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Playlist</TableHead>
              {showStatus && <TableHead>Status</TableHead>}
              <TableHead className="text-right">Baseline</TableHead>
              <TableHead className="text-right">Atual</TableHead>
              <TableHead className="text-right">Crescimento</TableHead>
              {showFirstSeen && <TableHead>First seen</TableHead>}
              <TableHead>Última coleta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.playlist_id}>
                <TableCell>
                  <div className="font-medium text-foreground">{r.current_name ?? r.baseline_name ?? "—"}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{r.playlist_id.slice(0, 12)}…</span>
                    {r.playlist_url && (
                      <a href={r.playlist_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-primary">
                        abrir <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </TableCell>
                {showStatus && (
                  <TableCell><MatchStatusBadge status={statusFor!(r)} /></TableCell>
                )}
                <TableCell className="text-right tabular-nums text-muted-foreground">{formatInt(Number(r.baseline_plays ?? 0))}</TableCell>
                <TableCell className="text-right tabular-nums text-foreground">{formatInt(Number(r.current_plays ?? 0))}</TableCell>
                <TableCell className={cn("text-right tabular-nums font-semibold", Number(r.delta) > 0 ? "text-primary" : "text-muted-foreground")}>
                  {Number(r.delta) > 0 ? "+" : ""}{formatInt(Number(r.delta ?? 0))}
                </TableCell>
                {showFirstSeen && (
                  <TableCell className="text-muted-foreground text-sm">
                    {r.first_seen_at ? new Date(r.first_seen_at).toLocaleDateString("pt-BR") : "—"}
                  </TableCell>
                )}
                <TableCell className="text-muted-foreground text-sm">
                  {r.last_captured_at ? new Date(r.last_captured_at).toLocaleString("pt-BR") : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Subtotal({ rows }: { rows: GrowthRow[] }) {
  if (rows.length === 0) return null;
  const b = rows.reduce((a, r) => a + Number(r.baseline_plays ?? 0), 0);
  const c = rows.reduce((a, r) => a + Number(r.current_plays ?? 0), 0);
  const d = rows.reduce((a, r) => a + Number(r.delta ?? 0), 0);
  return (
    <div className="flex items-center justify-end gap-6 text-sm text-muted-foreground pt-1 pr-2">
      <span>Baseline: <span className="text-foreground tabular-nums">{formatInt(b)}</span></span>
      <span>Atual: <span className="text-foreground tabular-nums">{formatInt(c)}</span></span>
      <span>Δ: <span className="text-primary font-semibold tabular-nums">{d > 0 ? "+" : ""}{formatInt(d)}</span></span>
    </div>
  );
}

function MatchStatusBadge({ status }: { status: string }) {
  if (status === "matched") return <Badge className="bg-primary text-primary-foreground">matched</Badge>;
  if (status === "pending_match") return <Badge variant="outline">pending_match</Badge>;
  if (status === "not_found_yet") return <Badge variant="outline" className="border-destructive/40 text-destructive">not_found_yet</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function EmptyState({ text }: { text: string }) {
  return <Card><CardContent className="p-8 text-center text-muted-foreground">{text}</CardContent></Card>;
}
