import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  TrendingDown,
  Brain,
  Gauge,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * ProactiveAlertsCard — surface things going wrong before user looks.
 *
 * Detecta (regras / thresholds INTOCADOS):
 *  - Curadores com queda de trust score (vs penúltima medição histórica) ≥ 10 pts
 *  - Curadores com sinais de severidade alta abertos
 *  - Playlists saturadas (headroom < 15% AND confidence ≥ 40)
 *
 * Fase 4B.2 — perf:
 *  - 5 awaits sequenciais → 2 fases paralelas (RTT 5 → 2)
 *  - React Query (staleTime 60s) — cache entre navegações
 *  - Lógica, thresholds, ordenação e copy: idênticos ao original
 */

type AlertItem = {
  id: string;
  kind: "trust_drop" | "high_signal" | "saturated";
  title: string;
  detail: string;
  to: string;
  severity: "high" | "medium";
};

async function fetchProactiveAlerts(): Promise<AlertItem[]> {
  const out: AlertItem[] = [];

  // ============================================================
  // FASE 1 (paralela) — queries sem dependência entre si
  //   A1: curator_brain  (universo de curadores com cérebro)
  //   B4: playlist_brain (playlists saturadas)
  // ============================================================
  const [brainsRes, pBrainsRes] = await Promise.all([
    supabase
      .from("curator_brain")
      .select("curator_id, trust_score, signals")
      .limit(500),
    supabase
      .from("playlist_brain")
      .select("playlist_id, headroom_pct, confidence_score")
      .lt("headroom_pct", 15)
      .gte("confidence_score", 40)
      .limit(20),
  ]);

  const brains = brainsRes.data ?? [];
  const pBrains = pBrainsRes.data ?? [];
  const curatorIds = brains.map((b) => b.curator_id);
  const pIds = pBrains.map((p) => p.playlist_id);

  // ============================================================
  // FASE 2 (paralela) — queries dependentes dos IDs da fase 1
  //   A2: curators                (nomes/archived dos curadores)
  //   A3: curator_brain_history   (penúltima medição para detectar queda)
  //   B5: managed_playlists       (nomes das playlists saturadas)
  // ============================================================
  const [curRes, histRes, plsRes] = await Promise.all([
    curatorIds.length
      ? supabase
          .from("curators")
          .select("id, name, archived_at")
          .in("id", curatorIds)
      : Promise.resolve({ data: [] as any[] }),
    curatorIds.length
      ? supabase
          .from("curator_brain_history")
          .select("curator_id, trust_score, calculated_at")
          .in("curator_id", curatorIds)
          .order("calculated_at", { ascending: false })
          .limit(curatorIds.length * 5)
      : Promise.resolve({ data: [] as any[] }),
    pIds.length
      ? supabase
          .from("managed_playlists")
          .select("id, name, canonical_playlist_id, archived_at")
          .in("canonical_playlist_id", pIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const cur = curRes.data ?? [];
  const hist = histRes.data ?? [];
  const pls = plsRes.data ?? [];

  // ============================================================
  // PROCESSAMENTO — idêntico ao original
  // ============================================================
  const nameById = new Map<string, string>();
  const archivedById = new Map<string, string | null>();
  cur.forEach((c) => {
    nameById.set(c.id, c.name);
    archivedById.set(c.id, c.archived_at);
  });

  // 2ª medição mais recente por curador (1ª deve ser o snapshot atual)
  const prevTrustByCurator = new Map<string, number>();
  const seenCount = new Map<string, number>();
  hist.forEach((h) => {
    const n = (seenCount.get(h.curator_id) ?? 0) + 1;
    seenCount.set(h.curator_id, n);
    if (n === 2 && h.trust_score !== null) {
      prevTrustByCurator.set(h.curator_id, Number(h.trust_score));
    }
  });

  for (const b of brains) {
    if (archivedById.get(b.curator_id)) continue;
    const name = nameById.get(b.curator_id) ?? "Curador";
    const sigs = Array.isArray(b.signals) ? b.signals : [];
    const highSigs = sigs.filter((s) => s?.severity === "high");
    const prev = prevTrustByCurator.get(b.curator_id);
    const curScore = Number(b.trust_score ?? 0);
    if (prev !== undefined && prev - curScore >= 10) {
      out.push({
        id: `trust-${b.curator_id}`,
        kind: "trust_drop",
        title: name,
        detail: `Trust caiu ${prev - curScore} pts (${prev} → ${curScore})`,
        to: `/curadores/${b.curator_id}`,
        severity: prev - curScore >= 20 ? "high" : "medium",
      });
    } else if (highSigs.length > 0) {
      out.push({
        id: `sig-${b.curator_id}`,
        kind: "high_signal",
        title: name,
        detail: `${highSigs.length} sinal(is) de severidade alta`,
        to: `/curadores/${b.curator_id}`,
        severity: "high",
      });
    }
  }

  for (const p of pls) {
    if (p.archived_at) continue;
    const b = pBrains.find((x) => x.playlist_id === p.canonical_playlist_id);
    out.push({
      id: `sat-${p.id}`,
      kind: "saturated",
      title: p.name,
      detail: `Folga ${Math.round(Number(b?.headroom_pct ?? 0))}% — sem espaço pra novas plays`,
      to: `/playlists/${p.canonical_playlist_id}`,
      severity: "medium",
    });
  }

  // ordenar high primeiro, limitar
  out.sort((a, b) => (a.severity === "high" ? -1 : 1) - (b.severity === "high" ? -1 : 1));
  return out.slice(0, 50);
}

export function ProactiveAlertsCard() {
  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ["proactive_alerts"],
    staleTime: 60_000,
    queryFn: fetchProactiveAlerts,
  });

  const counts = useMemo(() => {
    const high = alerts.filter((a) => a.severity === "high").length;
    return { high, total: alerts.length };
  }, [alerts]);

  return (
    <Card className="p-4 md:p-5 h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className={cn(
              "h-4 w-4",
              counts.high > 0 ? "text-destructive" : alerts.length > 0 ? "text-warning" : "text-success",
            )}
          />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Alertas proativos
          </span>
        </div>
        {alerts.length > 0 && (
          <span
            className={cn(
              "text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded",
              counts.high > 0
                ? "bg-destructive/15 text-destructive"
                : "bg-warning/15 text-warning",
            )}
          >
            {counts.total}
            {counts.high > 0 ? ` · ${counts.high} alto` : ""}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="text-[12px] text-muted-foreground">Analisando…</div>
      ) : alerts.length === 0 ? (
        <div className="flex items-center gap-2 text-[12px] text-success">
          <CheckCircle2 className="h-4 w-4" /> Tudo sob controle
        </div>
      ) : (
        <ul className="space-y-1.5 max-h-[228px] overflow-y-auto pr-1">
          {alerts.map((a) => {
            const Icon =
              a.kind === "trust_drop"
                ? TrendingDown
                : a.kind === "high_signal"
                ? Brain
                : Gauge;
            return (
              <li key={a.id}>
                <Link
                  to={a.to}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-[12px] transition-colors group",
                    a.severity === "high"
                      ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
                      : "border-warning/30 bg-warning/5 hover:bg-warning/10",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      a.severity === "high" ? "text-destructive" : "text-warning",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{a.title}</div>
                    <div className="text-muted-foreground text-[11px] truncate">{a.detail}</div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
