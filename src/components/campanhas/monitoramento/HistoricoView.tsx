import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatInt } from "@/lib/campaignEngine";
import { usePlaylistCovers } from "@/hooks/usePlaylistCovers";
import { PlaylistCell } from "./PlaylistCell";

type Coll = {
  playlist_id: string;
  playlist_url: string | null;
  playlist_name_at_capture: string | null;
  plays_7d: number | null;
  captured_at: string;
  is_baseline: boolean | null;
};

type PlaylistGroup = {
  playlist_id: string;
  current_name: string | null;
  playlist_url: string | null;
  first_seen_at: string;
  baseline_at: string | null;
  last_captured_at: string;
  timeline: { captured_at: string; plays_7d: number; name: string | null; is_baseline: boolean }[];
  name_changes: { captured_at: string; name: string }[];
};

export function HistoricoView({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<Coll[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data: r } = await supabase
        .from("campaign_playlist_collections")
        .select("playlist_id, playlist_url, playlist_name_at_capture, plays_7d, captured_at, is_baseline")
        .eq("campaign_id", campaignId)
        .order("captured_at", { ascending: true });
      setData((r ?? []) as Coll[]);
    })();
  }, [campaignId]);

  const groups = useMemo<PlaylistGroup[]>(() => {
    if (!data) return [];
    const map = new Map<string, Coll[]>();
    for (const c of data) {
      const arr = map.get(c.playlist_id) ?? [];
      arr.push(c);
      map.set(c.playlist_id, arr);
    }
    const out: PlaylistGroup[] = [];
    for (const [pid, arr] of map.entries()) {
      arr.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
      const timeline = arr.map((c) => ({
        captured_at: c.captured_at,
        plays_7d: Number(c.plays_7d ?? 0),
        name: c.playlist_name_at_capture,
        is_baseline: !!c.is_baseline,
      }));
      const name_changes: { captured_at: string; name: string }[] = [];
      let lastName: string | null = null;
      for (const c of arr) {
        const n = c.playlist_name_at_capture ?? null;
        if (n && n !== lastName) {
          name_changes.push({ captured_at: c.captured_at, name: n });
          lastName = n;
        }
      }
      const baseline = arr.find((c) => c.is_baseline);
      out.push({
        playlist_id: pid,
        current_name: arr[arr.length - 1]?.playlist_name_at_capture ?? null,
        playlist_url: arr[arr.length - 1]?.playlist_url ?? null,
        first_seen_at: arr[0].captured_at,
        baseline_at: baseline?.captured_at ?? null,
        last_captured_at: arr[arr.length - 1].captured_at,
        timeline,
        name_changes,
      });
    }
    out.sort((a, b) =>
      (b.timeline[b.timeline.length - 1]?.plays_7d ?? 0) - (a.timeline[a.timeline.length - 1]?.plays_7d ?? 0),
    );
    return out;
  }, [data]);

  const covers = usePlaylistCovers(groups.map((g) => g.playlist_id));

  if (!data) return <Skeleton className="h-96 w-full" />;
  if (groups.length === 0)
    return <Card><CardContent className="p-8 text-center text-muted-foreground">Nenhuma coleta registrada ainda.</CardContent></Card>;

  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const meta = covers[g.playlist_id];
        return (
        <Card key={g.playlist_id}>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <PlaylistCell
                  playlistId={g.playlist_id}
                  name={g.current_name ?? meta?.name ?? null}
                  url={g.playlist_url}
                  coverUrl={meta?.cover_url ?? null}
                  followers={meta?.followers ?? null}
                />
              </div>
              <div className="text-right text-xs text-muted-foreground space-y-0.5 shrink-0">
                <div>First seen: <span className="text-foreground">{new Date(g.first_seen_at).toLocaleDateString("pt-BR")}</span></div>
                <div>Baseline: <span className="text-foreground">{g.baseline_at ? new Date(g.baseline_at).toLocaleDateString("pt-BR") : "—"}</span></div>
                <div>Última: <span className="text-foreground">{new Date(g.last_captured_at).toLocaleString("pt-BR")}</span></div>
              </div>
            </div>

            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Timeline · plays 7d</div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {g.timeline.map((t, i) => (
                  <div key={i} className="rounded-md border border-border p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {new Date(t.captured_at).toLocaleDateString("pt-BR")}
                      </span>
                      {t.is_baseline && <Badge variant="outline" className="text-[10px] px-1 py-0">B</Badge>}
                    </div>
                    <div className="text-foreground tabular-nums font-semibold mt-0.5">{formatInt(t.plays_7d)}</div>
                  </div>
                ))}
              </div>
            </div>

            {g.name_changes.length > 1 && (
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Histórico de nomes</div>
                <ul className="text-sm space-y-1">
                  {g.name_changes.map((nc, i) => (
                    <li key={i} className="text-muted-foreground">
                      <span className="font-mono text-xs">{new Date(nc.captured_at).toLocaleDateString("pt-BR")}</span>
                      {" → "}
                      <span className="text-foreground">{nc.name}</span>
                      {i > 0 && <span className="text-muted-foreground"> (renamed)</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
