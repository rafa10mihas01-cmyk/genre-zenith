import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type SignalStatus = "ok" | "warn" | "dead";
type Signal = { name: string; value: number; variance: number; status: SignalStatus };
type HealthItem = {
  genre_id: string;
  generated_at?: string;
  signals?: Signal[];
  pool?: {
    fresh_pct: number;
    snapshot_age_days: number;
    search_tracks_age_days: number;
    top40_size?: number;
    release_metadata_coverage?: number;
  };
  diversity?: { cover_repeat_rate: number; tracks_under_365d_pct: number };
  dead_signals?: string[];
  error?: string;
};

const SIGNAL_LABEL: Record<string, string> = {
  recencia_variance: "Recência (var)",
  velocity_coverage: "Velocity cov.",
  leader_rel_variance: "Leader-rel (var)",
};

const STATUS_TONE: Record<SignalStatus, string> = {
  ok: "bg-primary/15 text-primary border-primary/30",
  warn: "bg-warning/15 text-warning border-warning/30",
  dead: "bg-destructive/15 text-destructive border-destructive/30",
};

const DOT_TONE: Record<SignalStatus, string> = {
  ok: "bg-primary",
  warn: "bg-warning",
  dead: "bg-destructive",
};

function poolBadge(label: string, value: string, status: SignalStatus) {
  return (
    <div
      className={cn(
        "rounded-md border px-2 py-1 text-[10px] flex items-center gap-1.5",
        STATUS_TONE[status],
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT_TONE[status])} />
      <span className="font-medium">{label}</span>
      <span className="tabular-nums opacity-80">{value}</span>
    </div>
  );
}

function poolStatus(item: HealthItem): {
  fresh: SignalStatus;
  snap: SignalStatus;
  st: SignalStatus;
  repeat: SignalStatus;
  under365: SignalStatus;
} {
  const p = item.pool;
  const d = item.diversity;
  return {
    fresh: !p ? "dead" : p.fresh_pct > 30 ? "ok" : p.fresh_pct >= 15 ? "warn" : "dead",
    snap: !p ? "dead" : p.snapshot_age_days <= 2 ? "ok" : p.snapshot_age_days <= 4 ? "warn" : "dead",
    st: !p ? "dead" : p.search_tracks_age_days <= 3 ? "ok" : p.search_tracks_age_days <= 5 ? "warn" : "dead",
    repeat: !d ? "warn" : d.cover_repeat_rate < 25 ? "ok" : d.cover_repeat_rate < 50 ? "warn" : "dead",
    under365: !d ? "warn" : d.tracks_under_365d_pct > 40 ? "ok" : d.tracks_under_365d_pct >= 20 ? "warn" : "dead",
  };
}

export function EngineHealthGrid() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<HealthItem[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // engine-health reads query params (GET), then invoke direct via fetch
        const url = `${import.meta.env.VITE_SUPABASE_URL ?? ""}/functions/v1/engine-health?all=1`;
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${session?.access_token ?? ""}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        });
        const j = res.ok ? await res.json() : null;
        const list: HealthItem[] = j?.items ?? [];
        if (cancelled) return;
        setItems(list);

        const ids = list.map((i) => i.genre_id).filter(Boolean);
        if (ids.length > 0) {
          const { data: genres } = await supabase
            .from("genres")
            .select("id, nome")
            .in("id", ids);
          const map: Record<string, string> = {};
          for (const g of (genres ?? []) as Array<{ id: string; nome: string }>) map[g.id] = g.nome;
          if (!cancelled) setLabels(map);
        }
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
      void error;
    })();
    return () => {
      cancelled = true;
    };
    // intencionalmente só no mount; error é lido via closure só pra suprimir o lint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && items.length === 0) {
    return (
      <div className="nx-card p-6 text-center text-xs text-muted-foreground">
        Medindo saúde dos sinais editoriais…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="nx-card p-6 text-center text-xs text-muted-foreground">
        Sem gêneros ativos para medir.
      </div>
    );
  }

  return (
    <div className="max-h-[31rem] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
      <div className="grid grid-cols-1 gap-3">
      {items.map((item) => {
        const ps = poolStatus(item);
        const dead = item.dead_signals ?? [];
        const headerStatus: SignalStatus =
          dead.length > 0
            ? "dead"
            : item.signals?.some((s) => s.status === "warn")
              ? "warn"
              : "ok";
        return (
          <div key={item.genre_id} className="nx-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">
                  {labels[item.genre_id] ?? item.genre_id.slice(0, 8)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {dead.length === 0
                    ? "Todos os sinais ativos"
                    : `${dead.length} sinal(is) morto(s): ${dead.join(", ")}`}
                </div>
              </div>
              <span
                className={cn(
                  "h-2 w-2 rounded-full shrink-0",
                  DOT_TONE[headerStatus],
                )}
              />
            </div>

            {item.error ? (
              <div className="text-[11px] text-destructive">{item.error}</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {(item.signals ?? []).map((s) => (
                    <div
                      key={s.name}
                      className={cn(
                        "rounded-md border px-2 py-1.5 space-y-0.5",
                        STATUS_TONE[s.status],
                      )}
                    >
                      <div className="text-[10px] uppercase tracking-wider opacity-80">
                        {SIGNAL_LABEL[s.name] ?? s.name}
                      </div>
                      <div className="text-sm font-semibold tabular-nums">
                        {s.name === "velocity_coverage"
                          ? `${s.value}%`
                          : s.value.toFixed(1)}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {poolBadge("fresh", `${item.pool?.fresh_pct ?? 0}%`, ps.fresh)}
                  {poolBadge("snap", `${item.pool?.snapshot_age_days ?? "?"}d`, ps.snap)}
                  {poolBadge(
                    "search",
                    `${item.pool?.search_tracks_age_days ?? "?"}d`,
                    ps.st,
                  )}
                  {poolBadge(
                    "repeat",
                    `${item.diversity?.cover_repeat_rate ?? 0}%`,
                    ps.repeat,
                  )}
                  {poolBadge(
                    "<365d",
                    `${item.diversity?.tracks_under_365d_pct ?? 0}%`,
                    ps.under365,
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
