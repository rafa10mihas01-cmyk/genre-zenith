import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Clock, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/campaignEngine";

type Deal = {
  id: string;
  curator_id: string | null;
  curator_name: string;
  song_name: string;
  target_plays: number;
  reconciled_total_plays: number;
  last_reconciled_at: string | null;
};

type HistoryEntry = {
  captured_at: string;
  is_initial_capture: boolean;
  playlists_count: number;
  total_plays: number;
  playlists: Array<{
    playlist_id: string;
    playlist_name: string;
    image_url: string | null;
    spotify_url: string | null;
    plays: number | null;
  }>;
};

type Props = { campaignId: string };

function toneFor(pct: number): { text: string; bar: string; bg: string; label: string } {
  if (pct >= 80) return { text: "text-success", bar: "bg-success", bg: "bg-success/10 border-success/30", label: "no ritmo" };
  if (pct >= 40) return { text: "text-warning", bar: "bg-warning", bg: "bg-warning/10 border-warning/30", label: "abaixo do esperado" };
  return { text: "text-destructive", bar: "bg-destructive", bg: "bg-destructive/10 border-destructive/30", label: "crítico" };
}

function timeAgo(iso: string | null): string {
  if (!iso) return "nunca";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

export function CampaignCuratorDeals({ campaignId }: Props) {
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [historyByDeal, setHistoryByDeal] = useState<Map<string, HistoryEntry[]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data: pkg } = await supabase
        .from("campaign_external_package_items")
        .select("curator_deal_id, campaign_external_packages!inner(campaign_id)")
        .eq("campaign_external_packages.campaign_id", campaignId)
        .not("curator_deal_id", "is", null);
      const dealIds = (pkg ?? [])
        .map((p: any) => p.curator_deal_id as string)
        .filter(Boolean);
      if (dealIds.length === 0) {
        if (!cancelled) { setDeals([]); setHistoryByDeal(new Map()); setLoading(false); }
        return;
      }
      const { data: dealRows } = await supabase
        .from("curator_deals")
        .select("id, curator_id, curator_name, song_name, target_plays, reconciled_total_plays, last_reconciled_at")
        .in("id", dealIds);
      const ds = (dealRows ?? []) as Deal[];

      const histEntries = await Promise.all(
        ds.map(async (d) => {
          const { data } = await supabase.rpc("get_curator_deal_snapshot_history", { p_deal_id: d.id });
          const arr = Array.isArray(data) ? (data as HistoryEntry[]) : [];
          return [d.id, arr] as const;
        }),
      );
      if (cancelled) return;
      setDeals(ds);
      setHistoryByDeal(new Map(histEntries));
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [campaignId]);

  if (loading) return <Skeleton className="h-48" />;
  if (deals.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
          Externos
        </span>
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">({deals.length})</span>
        <div className="flex-1 h-px bg-border/40" />
      </div>

      {deals.map((d) => {
        const isInternal = !d.curator_id;
        const pct = d.target_plays > 0 ? Math.min(100, (d.reconciled_total_plays / d.target_plays) * 100) : 0;
        const tone = toneFor(pct);
        const history = historyByDeal.get(d.id) ?? [];
        const nonBaseline = history.filter((h) => !h.is_initial_capture);
        const sparkValues = nonBaseline.slice(-7).map((h) => h.total_plays);
        const displayName = isInternal ? "Deal interno da campanha" : d.curator_name;
        const initial = (displayName?.trim()?.[0] ?? "C").toUpperCase();

        return (
          <Card
            key={d.id}
            className="overflow-hidden transition-colors hover:border-foreground/20"
          >
            <CardContent className="p-4 space-y-3">
              {/* Header em uma linha — avatar + nome + chip da música + status */}
              <div className="flex items-center gap-3">
                <div className={cn(
                  "h-8 w-8 rounded-md border flex items-center justify-center text-[11px] font-bold shrink-0",
                  isInternal
                    ? "bg-muted/30 border-border/60 text-muted-foreground"
                    : "bg-domain-curators/15 border-domain-curators/25 text-domain-curators",
                )}>
                  {initial}
                </div>
                <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    "text-[13px] font-semibold truncate",
                    isInternal ? "text-muted-foreground italic" : "text-foreground",
                  )}>
                    {displayName}
                  </span>
                  <span className="text-muted-foreground/40 text-xs shrink-0">·</span>
                  <span className="px-1.5 py-0.5 rounded-md bg-elevated border border-border/60 text-[10.5px] text-muted-foreground truncate max-w-[180px]">
                    {d.song_name}
                  </span>
                </div>
                {!isInternal && (
                  <div className={cn(
                    "shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10.5px] font-medium tabular-nums",
                    pct >= 80
                      ? "border-success/30 text-success bg-success/5"
                      : pct >= 40
                      ? "border-warning/30 text-warning bg-warning/5"
                      : "border-destructive/30 text-destructive bg-destructive/5",
                  )}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", tone.bar)} />
                    {Math.round(pct)}% · {tone.label}
                  </div>
                )}
              </div>

              {/* Progresso — número grande + sparkline (oculto para deals internos sem curador) */}
              {isInternal ? (
                <div className="text-[11px] text-muted-foreground italic">
                  Sem curador atribuído — entrega contabilizada pelo orgânico/ecossistema da campanha.
                </div>
              ) : (
                <div className="flex items-end gap-4">
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3 tabular-nums">
                      <span className={cn("text-[22px] font-semibold leading-none", tone.text)}>
                        {formatInt(d.reconciled_total_plays)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        / {formatInt(d.target_plays)} plays
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-foreground/5 overflow-hidden">
                      <div
                        className={cn("h-full transition-[width] duration-500", tone.bar)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  {sparkValues.length >= 2 && (
                    <Sparkline values={sparkValues} colorClass={tone.text} />
                  )}
                </div>
              )}

              {/* Linha sutil — último update + estado vazio */}
              <div className="flex items-center justify-between gap-3 text-[10.5px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  Último update: {timeAgo(d.last_reconciled_at)}
                </span>
                {nonBaseline.length === 0 && (
                  <span className="text-muted-foreground/70 italic">Aguardando primeira entrega</span>
                )}
              </div>

              {/* Histórico (só quando existe) */}
              {nonBaseline.length > 0 && (
                <div className="rounded-md border border-border/60 overflow-hidden">
                  <div className="bg-elevated/30 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/60">
                    Histórico de capturas ({nonBaseline.length})
                  </div>
                  <div className="max-h-64 overflow-auto divide-y divide-border/40">
                    {nonBaseline.map((h, i) => {
                      const prev = nonBaseline[i - 1];
                      const delta = prev ? h.total_plays - prev.total_plays : h.total_plays;
                      const date = new Date(h.captured_at).toLocaleString("pt-BR", {
                        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                      });
                      return (
                        <div key={`${h.captured_at}-${i}`} className="px-3 py-2 hover:bg-primary/5">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground tabular-nums">{date}</span>
                            <div className="flex items-baseline gap-2 tabular-nums">
                              <span className="font-medium text-foreground">{formatInt(h.total_plays)}</span>
                              {prev && (
                                <span className={cn("text-[10px] font-medium", delta > 0 ? "text-success" : "text-muted-foreground")}>
                                  {delta > 0 ? `+${formatInt(delta)}` : formatInt(delta)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                            {h.playlists.slice(0, 3).map((p) => (
                              <span key={p.playlist_id} className="inline-flex items-center gap-1 truncate max-w-[180px]">
                                {p.spotify_url ? (
                                  <a
                                    href={p.spotify_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 hover:text-foreground truncate"
                                  >
                                    <span className="truncate">{p.playlist_name}</span>
                                    <ExternalLink className="h-2.5 w-2.5 opacity-60 shrink-0" />
                                  </a>
                                ) : (
                                  <span className="truncate">{p.playlist_name}</span>
                                )}
                                <span className="tabular-nums">· {formatInt(p.plays ?? 0)}</span>
                              </span>
                            ))}
                            {h.playlists.length > 3 && (
                              <span>+{h.playlists.length - 3}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Sparkline({ values, colorClass }: { values: number[]; colorClass: string }) {
  const w = 72, h = 28, pad = 2;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const xs = (i: number) => pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2);
  const ys = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"} ${xs(i)} ${ys(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-7 w-[72px] shrink-0", colorClass)} preserveAspectRatio="none">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
    </svg>
  );
}
