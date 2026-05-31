import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatInt } from "@/lib/campaignEngine";
import { usePlaylistCovers } from "@/hooks/usePlaylistCovers";
import { PlaylistCell } from "./PlaylistCell";
import { ProofThumb } from "./ProofThumb";

type Coll = {
  playlist_id: string;
  playlist_url: string | null;
  playlist_name_at_capture: string | null;
  plays_7d: number | null;
  captured_at: string;
  is_baseline: boolean | null;
  proof_screenshot_url: string | null;
  proof_screenshot_urls: string[] | null;
};

export function PlaylistHistoryDrawer({
  campaignId,
  playlistId,
  open,
  onOpenChange,
}: {
  campaignId: string;
  playlistId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [data, setData] = useState<Coll[] | null>(null);
  const covers = usePlaylistCovers(playlistId ? [playlistId] : []);

  useEffect(() => {
    if (!open || !playlistId) return;
    setData(null);
    (async () => {
      const { data: r } = await supabase
        .from("campaign_playlist_collections")
        .select("playlist_id, playlist_url, playlist_name_at_capture, plays_7d, captured_at, is_baseline, proof_screenshot_url, proof_screenshot_urls")
        .eq("campaign_id", campaignId)
        .eq("playlist_id", playlistId)
        .order("captured_at", { ascending: true });
      setData((r ?? []) as Coll[]);
    })();
  }, [campaignId, playlistId, open]);

  const meta = playlistId ? covers[playlistId] : undefined;
  const baseline = data?.find((c) => c.is_baseline);
  const last = data?.[data.length - 1];
  const first = data?.[0];

  const nameChanges: { captured_at: string; name: string }[] = [];
  if (data) {
    let prev: string | null = null;
    for (const c of data) {
      const n = c.playlist_name_at_capture ?? null;
      if (n && n !== prev) {
        nameChanges.push({ captured_at: c.captured_at, name: n });
        prev = n;
      }
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Histórico da playlist</SheetTitle>
        </SheetHeader>

        {!data ? (
          <Skeleton className="h-64 w-full mt-6" />
        ) : !playlistId || data.length === 0 ? (
          <div className="text-muted-foreground text-sm mt-6">Sem coletas registradas.</div>
        ) : (
          <div className="space-y-6 mt-6">
            <PlaylistCell
              playlistId={playlistId}
              name={last?.playlist_name_at_capture ?? meta?.name ?? null}
              url={last?.playlist_url ?? null}
              coverUrl={meta?.cover_url ?? null}
              followers={meta?.followers ?? null}
            />

            <div className="grid grid-cols-3 gap-2 text-xs">
              <Stat label="First seen" value={first ? new Date(first.captured_at).toLocaleDateString("pt-BR") : "—"} />
              <Stat label="Baseline" value={baseline ? new Date(baseline.captured_at).toLocaleDateString("pt-BR") : "—"} />
              <Stat label="Última" value={last ? new Date(last.captured_at).toLocaleString("pt-BR") : "—"} />
            </div>

            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Timeline · plays 7d</div>
              <div className="grid grid-cols-3 gap-2">
                {data.map((c, i) => (
                  <div key={i} className="rounded-md border border-border p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(c.captured_at).toLocaleDateString("pt-BR")}
                      </span>
                      {c.is_baseline && <Badge variant="outline" className="text-[10px] px-1 py-0">B</Badge>}
                    </div>
                    <div className="text-foreground tabular-nums font-semibold mt-0.5 text-sm">
                      {formatInt(Number(c.plays_7d ?? 0))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {nameChanges.length > 1 && (
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Histórico de nomes</div>
                <ul className="text-sm space-y-1">
                  {nameChanges.map((nc, i) => (
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

            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Provas (prints do bot)</div>
              <div className="space-y-2">
                {data.filter((c) => (c.proof_screenshot_urls && c.proof_screenshot_urls.length > 0) || c.proof_screenshot_url).map((c, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border border-border p-2">
                    <div className="text-xs">
                      <div className="text-foreground">{new Date(c.captured_at).toLocaleString("pt-BR")}</div>
                      <div className="text-muted-foreground">{c.is_baseline ? "Baseline" : "Coleta"}</div>
                    </div>
                    <ProofThumb urls={c.proof_screenshot_urls} url={c.proof_screenshot_url} />
                  </div>
                ))}
                {data.every((c) => !c.proof_screenshot_url && (!c.proof_screenshot_urls || c.proof_screenshot_urls.length === 0)) && (
                  <div className="text-xs text-muted-foreground">Sem prints registrados.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-foreground text-sm font-medium mt-0.5">{value}</div>
    </div>
  );
}
