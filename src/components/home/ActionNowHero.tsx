import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Zap, Handshake, AlertTriangle, Gauge, ChevronRight, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useActiveManagedPlaylists } from "@/hooks/useActiveManagedPlaylists";

/**
 * Hero acionável do Cockpit — soma o que EXIGE ação agora.
 *
 * Fontes:
 *  - Deals pendentes: curator_deals.state ∈ (awaiting_playlists, awaiting_review, pending)
 *  - Curadores em risco: curator_brain com algum signal severity='high'
 *  - Playlists saturadas: playlist_brain headroom_pct < 15 AND confidence_score >= 40
 *
 * Fase 4B.1: migrado pra React Query, share de active managed_playlists,
 * .limit(500) em curator_brain. Lógica preservada 1:1.
 */
export function ActionNowHero() {
  const { data: activeMp = [] } = useActiveManagedPlaylists();
  const activeCanonicals = activeMp
    .map((r) => r.canonical_playlist_id)
    .filter(Boolean) as string[];

  const { data: counts } = useQuery({
    queryKey: ["action_now_hero", activeCanonicals.length],
    staleTime: 30_000,
    refetchInterval: 30_000,
    enabled: true,
    queryFn: async () => {
      const [dealsRes, brainsRes, satRes] = await Promise.all([
        supabase
          .from("curator_deals")
          .select("id", { count: "exact", head: true })
          .in("state", ["awaiting_playlists", "awaiting_review", "pending"]),
        supabase.from("curator_brain").select("signals").limit(500),
        activeCanonicals.length
          ? supabase
              .from("playlist_brain")
              .select("id", { count: "exact", head: true })
              .in("playlist_id", activeCanonicals)
              .lt("headroom_pct", 15)
              .gte("confidence_score", 40)
          : Promise.resolve({ count: 0 } as any),
      ]);

      const curatorsAtRisk = (brainsRes.data ?? []).filter((b: any) => {
        const sigs = Array.isArray(b.signals) ? b.signals : [];
        return sigs.some((s: any) => s?.severity === "high");
      }).length;

      return {
        dealsPending: dealsRes.count ?? 0,
        curatorsAtRisk,
        playlistsSaturated: (satRes as any).count ?? 0,
      };
    },
  });

  const c = counts ?? { dealsPending: 0, curatorsAtRisk: 0, playlistsSaturated: 0 };
  const loading = !counts;
  const total = c.dealsPending + c.curatorsAtRisk + c.playlistsSaturated;
  const tone = total === 0 ? "success" : total >= 10 ? "destructive" : "warning";

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card p-6 md:p-7",
        tone === "destructive" && "border-l-2 border-l-destructive",
        tone === "warning" && "border-l-2 border-l-warning",
        tone === "success" && "border-l-2 border-l-success",
      )}
    >
      {/* glow sutil — domínio de ação */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -top-20 -right-20 h-48 w-48 rounded-full blur-3xl",
          tone === "destructive" && "bg-destructive/15",
          tone === "warning" && "bg-warning/15",
          tone === "success" && "bg-success/15",
        )}
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] font-semibold text-muted-foreground">
          <Zap className="h-3.5 w-3.5" />
          Ação agora
        </div>
      </div>

      {loading ? (
        <div className="relative mt-4 h-16 w-40 rounded-md bg-muted/40 animate-pulse" />
      ) : total === 0 ? (
        <div className="relative mt-4 flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-success" />
          <div>
            <div className="text-2xl font-semibold text-foreground leading-tight">
              Nada exige sua ação agora
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Sem deals pendentes, curadores em risco ou playlists saturadas.
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="relative mt-3 flex items-baseline gap-3">
            <span
              className={cn(
                "text-6xl font-semibold tabular-nums tracking-tight leading-none",
                tone === "destructive" ? "text-destructive" : "text-warning",
              )}
            >
              {total}
            </span>
            <span className="text-sm text-muted-foreground">
              {total === 1 ? "item exige sua ação" : "itens exigem sua ação"}
            </span>
          </div>

          <ul className="relative mt-5 space-y-1.5">
            <ActionRow
              icon={Handshake}
              to="/deals"
              label="Deals aguardando você"
              count={c.dealsPending}
              tone={c.dealsPending > 0 ? "warning" : "muted"}
            />
            <ActionRow
              icon={AlertTriangle}
              to="/curadores"
              label="Curadores com sinal de severidade alta"
              count={c.curatorsAtRisk}
              tone={c.curatorsAtRisk > 0 ? "destructive" : "muted"}
            />
            <ActionRow
              icon={Gauge}
              to="/catalogo"
              label="Playlists saturadas (sem folga)"
              count={c.playlistsSaturated}
              tone={c.playlistsSaturated > 0 ? "warning" : "muted"}
            />
          </ul>
        </>
      )}
    </section>
  );
}

function ActionRow({
  icon: Icon,
  to,
  label,
  count,
  tone,
}: {
  icon: any;
  to: string;
  label: string;
  count: number;
  tone: "destructive" | "warning" | "muted";
}) {
  const tones = {
    destructive: "text-destructive",
    warning: "text-warning",
    muted: "text-muted-foreground/60",
  } as const;
  return (
    <li>
      <Link
        to={to}
        className={cn(
          "group flex items-center gap-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5 transition-colors hover:bg-muted/20",
          count === 0 && "opacity-60",
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", tones[tone])} />
        <span className="text-sm font-medium text-foreground flex-1 truncate">{label}</span>
        <span className={cn("text-base font-semibold tabular-nums tracking-tight", tones[tone])}>
          {count}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}
