// DriftVisualTab — ANTES → AGORA por playlist (mix de gêneros).
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Snap = { playlist_id: string; genre_mix: Record<string, number>; captured_at: string; dominant_genre: string | null };

function MixBar({ mix }: { mix: Record<string, number> }) {
  const entries = Object.entries(mix).sort(([, a], [, b]) => b - a).slice(0, 6);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  const palette = ["bg-primary", "bg-violet-500", "bg-amber-500", "bg-rose-500", "bg-emerald-500", "bg-sky-500"];
  return (
    <div>
      <div className="flex h-3 rounded-md overflow-hidden border border-border">
        {entries.map(([k, v], i) => (
          <div key={k} className={cn(palette[i % palette.length], "h-full")} style={{ width: `${(v / total) * 100}%` }} title={`${k}: ${Math.round((v / total) * 100)}%`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {entries.map(([k, v], i) => (
          <span key={k} className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", palette[i % palette.length])} />
            {k} <span className="text-foreground font-medium">{Math.round((v / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function DriftVisualTab() {
  const [playlists, setPlaylists] = useState<Array<{ id: string; name: string }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("playlist_drift_snapshots")
        .select("playlist_id")
        .order("captured_at", { ascending: false })
        .limit(500);
      const ids = [...new Set((data ?? []).map((r: any) => r.playlist_id))].slice(0, 50);
      if (!ids.length) { setLoading(false); return; }
      const { data: pls } = await supabase.from("playlists").select("id, name").in("id", ids);
      const list = (pls ?? []).map((p: any) => ({ id: p.id, name: p.name }));
      setPlaylists(list);
      setSelected(list[0]?.id ?? null);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;
    (async () => {
      const { data } = await supabase
        .from("playlist_drift_snapshots")
        .select("playlist_id, genre_mix, captured_at, dominant_genre")
        .eq("playlist_id", selected)
        .order("captured_at", { ascending: true });
      setSnaps((data ?? []) as Snap[]);
    })();
  }, [selected]);

  const before = snaps[0];
  const after = snaps[snaps.length - 1];

  const diff = useMemo(() => {
    if (!before || !after || before === after) return [] as Array<{ k: string; from: number; to: number; delta: number }>;
    const keys = new Set([...Object.keys(before.genre_mix), ...Object.keys(after.genre_mix)]);
    return [...keys]
      .map(k => ({ k, from: before.genre_mix[k] ?? 0, to: after.genre_mix[k] ?? 0, delta: (after.genre_mix[k] ?? 0) - (before.genre_mix[k] ?? 0) }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 5);
  }, [snaps, before, after]);

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Drift visual</h3>
        <p className="text-[12px] text-muted-foreground">como a identidade da playlist mudou ao longo do tempo</p>
      </div>

      {loading ? <Skeleton className="h-64" /> : playlists.length === 0 ? (
        <div className="nx-card p-8 text-center text-sm text-muted-foreground">
          Nenhum snapshot de mix ainda. A captura roda diariamente — volte amanhã.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {playlists.slice(0, 30).map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={cn(
                  "px-2.5 py-1 text-[11px] rounded-md border transition-colors",
                  selected === p.id ? "bg-card border-primary/40 text-foreground" : "border-border text-muted-foreground hover:bg-elevated",
                )}
              >
                {p.name}
              </button>
            ))}
          </div>

          {snaps.length < 2 ? (
            <div className="nx-card p-6 text-sm text-muted-foreground text-center">
              Só 1 snapshot dessa playlist ainda. Próximas capturas vão revelar o drift.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="nx-card p-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Antes · {before.captured_at.slice(0, 10)}</p>
                <MixBar mix={before.genre_mix} />
              </div>
              <div className="nx-card p-4">
                <p className="text-[11px] uppercase tracking-wide text-primary mb-1">Agora · {after.captured_at.slice(0, 10)}</p>
                <MixBar mix={after.genre_mix} />
              </div>
              {diff.length > 0 && (
                <div className="nx-card p-4 md:col-span-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Maiores mudanças</p>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {diff.map(d => {
                      const pct = Math.round(d.delta * 100);
                      const up = pct > 0;
                      return (
                        <div key={d.k} className="px-3 py-2 rounded-md bg-elevated">
                          <p className="text-[11px] text-muted-foreground truncate">{d.k}</p>
                          <p className={cn("text-sm font-semibold", up ? "text-success" : pct < 0 ? "text-destructive" : "")}>{up ? "+" : ""}{pct}%</p>
                          <p className="text-[10px] text-muted-foreground">{Math.round(d.from * 100)}% → {Math.round(d.to * 100)}%</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
