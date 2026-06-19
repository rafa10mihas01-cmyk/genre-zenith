import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Grid3x3, AlertTriangle, Sparkles, HelpCircle, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Row = {
  playlist_id: string;
  headroom_pct: number | null;
  confidence_score: number;
  health_trend: string;
  signals_count: number;
  name: string;
  cover_url: string | null;
};

type Quadrant = "bet" | "saturated" | "explore" | "avoid";

const QUADRANT_META: Record<Quadrant, { label: string; color: string; ring: string; icon: LucideIcon }> = {
  bet: { label: "Apostar pesado", color: "text-success", ring: "ring-success/40", icon: Sparkles },
  saturated: { label: "Saturado — validar", color: "text-destructive", ring: "ring-destructive/40", icon: AlertTriangle },
  explore: { label: "Explorar — coletar dados", color: "text-primary", ring: "ring-primary/40", icon: HelpCircle },
  avoid: { label: "Evitar agora", color: "text-muted-foreground", ring: "ring-muted-foreground/30", icon: X },
};

function classify(headroom: number, confidence: number): Quadrant {
  const highH = headroom >= 50;
  const highC = confidence >= 50;
  if (highH && highC) return "bet";
  if (!highH && highC) return "saturated";
  if (highH && !highC) return "explore";
  return "avoid";
}

export default function MatrizPlaylists({ embedded = false }: { embedded?: boolean } = {}) {
  const [selected, setSelected] = useState<Quadrant | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["matriz_playlists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playlist_brain")
        .select(
          "playlist_id, headroom_pct, confidence_score, health_trend, signals, managed_playlists!inner ( name, cover_url, archived_at )",
        )
        .not("headroom_pct", "is", null)
        .is("managed_playlists.archived_at", null);
      if (error) throw error;
      return (data ?? [])
        .map((r: any) => ({
          playlist_id: r.playlist_id,
          headroom_pct: r.headroom_pct !== null ? Number(r.headroom_pct) : null,
          confidence_score: r.confidence_score ?? 0,
          health_trend: r.health_trend ?? "novo",
          signals_count: Array.isArray(r.signals) ? r.signals.length : 0,
          name: r.managed_playlists?.name ?? "Sem nome",
          cover_url: r.managed_playlists?.cover_url ?? null,
        }))
        .filter((r: Row) => r.headroom_pct !== null) as Row[];
    },
  });

  const counts = useMemo(() => {
    const c: Record<Quadrant, Row[]> = { bet: [], saturated: [], explore: [], avoid: [] };
    rows.forEach((r) => c[classify(r.headroom_pct ?? 0, r.confidence_score)].push(r));
    return c;
  }, [rows]);

  const visible = selected ? counts[selected] : rows;

  return (
    <div className="space-y-8">
      {!embedded && (
        <>
          <PageHeader
            domain="playlists"
            title="Matriz de prioridade"
            subtitle="Capacidade × confiança"
          />
          <AnalyticsTabs />
        </>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(Object.keys(QUADRANT_META) as Quadrant[]).map((q) => {
          const meta = QUADRANT_META[q];
          const Icon = meta.icon;
          const active = selected === q;
          return (
            <button
              key={q}
              onClick={() => setSelected(active ? null : q)}
              className={cn(
                "text-left rounded-2xl p-4 bg-card border border-border transition",
                "hover:bg-accent",
                active && "ring-2",
                active && meta.ring,
              )}
            >
              <div className="flex items-center justify-between">
                <Icon className={cn("h-4 w-4", meta.color)} />
                <span className="text-2xl font-semibold">{counts[q].length}</span>
              </div>
              <div className={cn("mt-1.5 text-xs font-medium", meta.color)}>{meta.label}</div>
            </button>
          );
        })}
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Grid3x3 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Folga (X) × Confiança (Y)</span>
          </div>
          <span className="text-[11px] text-muted-foreground">{rows.length} playlists com perfil vivo</span>
        </div>

        <div className="relative aspect-[4/3] w-full bg-background rounded-xl border border-border overflow-hidden">
          {/* Quadrant lines */}
          <div className="absolute inset-y-0 left-1/2 w-px bg-border/60" />
          <div className="absolute inset-x-0 top-1/2 h-px bg-border/60" />

          {/* Quadrant labels */}
          <div className="absolute top-2 left-2 text-[10px] text-muted-foreground uppercase tracking-wide">Saturado</div>
          <div className="absolute top-2 right-2 text-[10px] text-success uppercase tracking-wide">Apostar</div>
          <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground uppercase tracking-wide">Evitar</div>
          <div className="absolute bottom-2 right-2 text-[10px] text-primary uppercase tracking-wide">Explorar</div>

          {/* Axis labels */}
          <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[11px] text-muted-foreground">
            folga →
          </div>
          <div className="absolute top-1/2 -left-2 -translate-y-1/2 -rotate-90 text-[11px] text-muted-foreground">
            ← confiança
          </div>

          {/* Dots */}
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
              Carregando…
            </div>
          ) : (
            rows.map((r) => {
              const x = Math.min(99, Math.max(1, r.headroom_pct ?? 0));
              const y = Math.min(99, Math.max(1, r.confidence_score));
              const q = classify(r.headroom_pct ?? 0, r.confidence_score);
              const meta = QUADRANT_META[q];
              const dim = selected && selected !== q;
              return (
                <Link
                  key={r.playlist_id}
                  to={`/playlists/${r.playlist_id}`}
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 transition-opacity",
                    dim && "opacity-15",
                  )}
                  style={{ left: `${x}%`, bottom: `${y}%` }}
                  title={`${r.name} — H ${x.toFixed(0)}% · C ${y}`}
                >
                  <div
                    className={cn(
                      "h-2.5 w-2.5 rounded-full ring-2 ring-background hover:scale-150 transition",
                      q === "bet" && "bg-success",
                      q === "saturated" && "bg-destructive",
                      q === "explore" && "bg-primary",
                      q === "avoid" && "bg-muted-foreground",
                    )}
                  />
                </Link>
              );
            })
          )}
        </div>
      </Card>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">
            {selected ? QUADRANT_META[selected].label : "Todas as playlists"} ({visible.length})
          </h2>
          {selected && (
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              <X className="h-3.5 w-3.5 mr-1" /> Limpar filtro
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : visible.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Vazio.
          </Card>
        ) : (
          <div className="space-y-2">
            {visible
              .sort((a, b) => (b.headroom_pct ?? 0) * (b.confidence_score / 100) - (a.headroom_pct ?? 0) * (a.confidence_score / 100))
              .slice(0, 50)
              .map((r) => {
                const q = classify(r.headroom_pct ?? 0, r.confidence_score);
                const meta = QUADRANT_META[q];
                return (
                  <Link
                    key={r.playlist_id}
                    to={`/playlists/${r.playlist_id}`}
                    className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:bg-accent transition"
                  >
                    {r.cover_url ? (
                      <img src={r.cover_url} alt="" className="h-10 w-10 rounded-md object-cover" />
                    ) : (
                      <div className="h-10 w-10 rounded-md bg-muted" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{r.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        Folga {(r.headroom_pct ?? 0).toFixed(0)}% · Confiança {r.confidence_score} · {r.signals_count} {r.signals_count === 1 ? "sinal" : "sinais"}
                      </div>
                    </div>
                    <span className={cn("text-[11px] font-medium", meta.color)}>{meta.label}</span>
                  </Link>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
