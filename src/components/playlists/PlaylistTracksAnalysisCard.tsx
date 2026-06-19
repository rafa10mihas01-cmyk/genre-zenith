import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Music2,
  TrendingDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  AlertTriangle,
  UserPlus,
  Flame,
  ShieldCheck,
  ArrowRightLeft,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "keep" | "remove" | "promote" | "demote" | "protected";
type Zone = "anchor" | "premium" | "support" | "tail";

type TrackRow = {
  spotify_track_id: string;
  track_name: string | null;
  artist_name: string | null;
  position: number;
  status: Status;
  reasons: string[];
  recurrence_in_genre: number;
  popularity: number | null;
  artist_popularity?: number | null;
  saturation_pct?: number;
  age_days_in_playlist?: number | null;
  release_date?: string | null;
  // zona editorial
  current_zone?: Zone;
  best_zone?: Zone;
  target_position?: number | null;
  anchor_eligible?: boolean;
  zone_scores?: { anchor: number; premium: number; support: number; tail: number };
  // proteção de campanha
  is_protected?: boolean;
  protected_campaign_id?: string | null;
  protected_campaign_status?: string | null;
  protected_planned_streams?: number | null;
  // legacy
  streams_28d?: number | null;
  growth_28d_pct?: number | null;
};

type Summary = {
  total?: number;
  keep?: number;
  remove?: number;
  promote?: number;
  demote?: number;
  protected?: number;
  saturated?: number;
  saturated_pct?: number;
  no_data?: number;
  missing_artists?: { artist: string; count: number }[];
  zone_current?: Record<Zone, number>;
  zone_best?: Record<Zone, number>;
  anchor_has_eligible?: boolean;
  anchor_misuse?: number;
  add?: number;
  add_from_missing?: number;
  substitutions?: number;
  zone_deficits?: Record<Zone, number>;
  zone_ideal?: Record<Zone, number>;
};

type Substitution = {
  replaces_track_id: string;
  replaces_track_name: string | null;
  replaces_artist_name: string | null;
  replaces_position: number;
  slot_zone: Zone;
  slot_zone_label: string;
  candidate: {
    spotify_track_id: string;
    nome: string;
    artista: string;
    popularity: number | null;
    recurrence_in_genre: number;
    zone_fit_score: number;
    function_role: string;
    from_missing_artist: boolean;
    trending_position?: number | null;
    suggested_position: number;
  } | null;
};

type Suggestion = {
  spotify_track_id: string;
  nome: string;
  artista: string;
  count: number;
  popularity?: number | null;
  from_missing_artist?: boolean;
  trending_position?: number | null;
  target_zone?: Zone;
  target_zone_label?: string;
  function_role?: string;
  zone_fit_score?: number;
  suggested_position?: number;
  fills_deficit?: boolean;
  is_substitution?: boolean;
  replaces_track_name?: string | null;
  replaces_artist_name?: string | null;
};

const ZONE_LABELS: Record<Zone, string> = {
  anchor: "Fachada",
  premium: "Premium",
  support: "Sustentação",
  tail: "Cauda",
};
const ZONE_HINT: Record<Zone, string> = {
  anchor: "#1-2 · só hits dominantes",
  premium: "#3-6 · zona de impulsionamento",
  support: "#7-12 · sustenta retenção",
  tail: "#13+ · descoberta e catálogo",
};

function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat("pt-BR").format(n);
}

const STATUS_META: Record<Status, { label: string; cls: string; icon: any }> = {
  protected: { label: "Protegida", cls: "border-domain-campaigns/40 text-domain-campaigns bg-domain-campaigns/5", icon: ShieldCheck },
  keep: { label: "Manter", cls: "border-primary/30 text-primary bg-primary/5", icon: CheckCircle2 },
  remove: { label: "Remover", cls: "border-destructive/40 text-destructive bg-destructive/5", icon: TrendingDown },
  promote: { label: "Promover", cls: "border-warning/40 text-warning bg-warning/5", icon: ArrowUp },
  demote: { label: "Rebaixar", cls: "border-muted-foreground/30 text-muted-foreground bg-muted/20", icon: ArrowDown },
};

export function PlaylistTracksAnalysisCard({ managedId }: { managedId: string }) {
  const [analysis, setAnalysis] = useState<TrackRow[]>([]);
  const [summary, setSummary] = useState<Summary>({});
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [substitutions, setSubstitutions] = useState<Substitution[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Status>("all");

  useEffect(() => {
    if (!managedId) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("playlist_diagnoses")
        .select("tracks_analysis, tracks_summary, tracks_suggestions, raw")
        .eq("playlist_id", managedId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (active) {
        setAnalysis(Array.isArray(data?.tracks_analysis) ? (data!.tracks_analysis as any) : []);
        setSummary((data?.tracks_summary as any) ?? {});
        setSuggestions(Array.isArray(data?.tracks_suggestions) ? (data!.tracks_suggestions as any) : []);
        const raw = (data?.raw as any) ?? {};
        setSubstitutions(Array.isArray(raw?.substitutions) ? raw.substitutions : []);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [managedId]);

  const visible = useMemo(() => {
    if (filter === "all") return analysis;
    return analysis.filter((t) => t.status === filter);
  }, [analysis, filter]);

  if (loading) {
    return (
      <Card className="p-5 h-32 grid place-items-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!analysis.length) {
    return (
      <Card className="p-5 text-sm text-muted-foreground">
        Sem análise faixa-a-faixa ainda. Clique em <span className="text-foreground font-medium">Diagnosticar agora</span> para gerar.
      </Card>
    );
  }

  const counts = {
    total: summary.total ?? analysis.length,
    keep: summary.keep ?? analysis.filter((x) => x.status === "keep").length,
    remove: summary.remove ?? analysis.filter((x) => x.status === "remove").length,
    promote: summary.promote ?? analysis.filter((x) => x.status === "promote").length,
    demote: summary.demote ?? analysis.filter((x) => x.status === "demote").length,
    protected: summary.protected ?? analysis.filter((x) => x.status === "protected").length,
  };
  const missingArtists = summary.missing_artists ?? [];

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Music2 className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Análise faixa-a-faixa</h2>
          <span className="text-xs text-muted-foreground ml-1">{counts.total} faixas</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs">
          {[
            { key: "protected" as Status, n: counts.protected, label: "Protegidas" },
            { key: "keep" as Status, n: counts.keep, label: "Manter" },
            { key: "remove" as Status, n: counts.remove, label: "Remover" },
            { key: "promote" as Status, n: counts.promote, label: "Promover" },
            { key: "demote" as Status, n: counts.demote, label: "Rebaixar" },
          ].map((kpi) => {
            const meta = STATUS_META[kpi.key];
            return (
              <div key={kpi.key} className={cn("rounded-lg border p-3", meta.cls)}>
                <div className="text-[10px] uppercase tracking-wider opacity-80">{kpi.label}</div>
                <div className="text-xl font-semibold tabular-nums">{kpi.n}</div>
              </div>
            );
          })}
          <div className="rounded-lg border border-border p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Saturadas</div>
            <div className="text-xl font-semibold tabular-nums">
              {summary.saturated ?? 0}
              {summary.saturated_pct != null && (
                <span className="text-xs text-muted-foreground ml-1">({summary.saturated_pct}%)</span>
              )}
            </div>
          </div>
        </div>

        {counts.protected > 0 && (
          <div className="flex items-start gap-2 text-xs text-foreground/80 bg-domain-campaigns/5 border border-domain-campaigns/30 rounded-md p-2">
            <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-domain-campaigns" />
            <span>
              {counts.protected} faixa{counts.protected > 1 ? "s estão" : " está"} em campanha ativa — protegida{counts.protected > 1 ? "s" : ""} contra remoção e rebaixamento automático até a meta ser entregue.
            </span>
          </div>
        )}

        {summary.no_data != null && summary.no_data > 0 && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-border rounded-md p-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {summary.no_data} faixas ainda sem dados de performance — o ecosystem score precisa de mais snapshots pra classificar com confiança.
            </span>
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
            className="h-7 text-xs"
          >
            Todas ({counts.total})
          </Button>
          {(["protected", "remove", "promote", "demote", "keep"] as Status[]).map((k) => {
            const meta = STATUS_META[k];
            const n = counts[k];
            return (
              <Button
                key={k}
                size="sm"
                variant={filter === k ? "default" : "outline"}
                onClick={() => setFilter(k)}
                disabled={n === 0}
                className="h-7 text-xs"
              >
                {meta.label} ({n})
              </Button>
            );
          })}
        </div>
      </Card>

      {/* Estrutura editorial — zonas atuais vs. ideais */}
      {summary.zone_current && summary.zone_best && (
        <Card className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Estrutura editorial</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Distribuição atual vs. ideal por zona da playlist
              </p>
            </div>
            {summary.anchor_has_eligible === false && (
              <Badge variant="outline" className="text-[10px] border-warning/40 text-warning bg-warning/5 gap-1 shrink-0">
                <AlertTriangle className="h-3 w-3" />
                Fachada sem hit dominante
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {(["anchor", "premium", "support", "tail"] as Zone[]).map((z) => {
              const cur = summary.zone_current?.[z] ?? 0;
              const best = summary.zone_best?.[z] ?? 0;
              const diff = best - cur;
              return (
                <div key={z} className="rounded-lg border border-border p-3 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{ZONE_LABELS[z]}</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl font-semibold tabular-nums">{cur}</span>
                    <span className="text-[11px] text-muted-foreground">faixas hoje</span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px]">
                    <span className="text-muted-foreground">ideal {best}</span>
                    {diff !== 0 && (
                      <span className={cn(
                        "tabular-nums",
                        diff > 0 ? "text-warning" : "text-muted-foreground",
                      )}>
                        ({diff > 0 ? "+" : ""}{diff})
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground/80 pt-1 border-t border-border/40">
                    {ZONE_HINT[z]}
                  </div>
                </div>
              );
            })}
          </div>
          {!!summary.anchor_misuse && summary.anchor_misuse > 0 && (
            <div className="flex items-start gap-2 text-xs text-warning bg-warning/5 border border-warning/30 rounded-md p-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                {summary.anchor_misuse} faixa{summary.anchor_misuse > 1 ? "s ocupam" : " ocupa"} a fachada sem força pra sustentar.
                A fachada (#1-2) exige popularity ≥ 70 + artista forte ou recorrência alta no nicho.
              </span>
            </div>
          )}
        </Card>
      )}

      {/* Substituições editoriais — pareia cada faixa que sai com candidata que cumpre a MESMA função */}
      {substitutions.filter((s) => s.candidate).length > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Substituições por função editorial</h2>
            <span className="text-xs text-muted-foreground">{substitutions.filter((s) => s.candidate).length}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Para cada faixa que sai, o sistema sugere outra do nicho que cumpre o mesmo papel na mesma zona — preservando o equilíbrio da playlist.
          </p>
          <div className="space-y-2">
            {substitutions.filter((s) => s.candidate).map((s) => (
              <div
                key={s.replaces_track_id}
                className="grid grid-cols-1 sm:grid-cols-[1fr,auto,1fr] gap-2 sm:gap-3 items-center rounded-md border border-border bg-card/40 p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>Sai · #{s.replaces_position + 1}</span>
                    <span className="opacity-60">·</span>
                    <span>{s.slot_zone_label}</span>
                  </div>
                  <div className="text-xs font-medium text-foreground/90 truncate">{s.replaces_track_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground truncate">{s.replaces_artist_name ?? "—"}</div>
                </div>
                <ArrowRightLeft className="h-3.5 w-3.5 text-primary mx-auto rotate-0 sm:rotate-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary">
                    <span>Entra · #{(s.candidate!.suggested_position + 1)}</span>
                    <span className="opacity-60">·</span>
                    <span className="truncate">{s.candidate!.function_role}</span>
                  </div>
                  <div className="text-xs font-medium text-foreground/90 truncate flex items-center gap-1.5">
                    {s.candidate!.nome}
                    {s.candidate!.trending_position != null && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1 border-primary/40 text-primary bg-primary/5">
                        🔥 #{s.candidate!.trending_position} Top 200
                      </Badge>
                    )}
                    {s.candidate!.from_missing_artist && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1 border-warning/40 text-warning bg-warning/5">
                        artista faltando
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {s.candidate!.artista}
                    <span className="ml-1.5 tabular-nums opacity-70">
                      · pop {s.candidate!.popularity ?? "—"} · {s.candidate!.recurrence_in_genre}× no nicho · fit {s.candidate!.zone_fit_score}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Adições por função (deficits de zona) */}
      {suggestions.filter((s) => !s.is_substitution).length > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Adicionar por função editorial</h2>
            <span className="text-xs text-muted-foreground">{suggestions.filter((s) => !s.is_substitution).length}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Faixas do nicho que ocupariam zonas com déficit — entram cumprindo o papel que está faltando, não só por popularidade.
          </p>
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left font-medium py-2 pr-2 w-12">Pos</th>
                  <th className="text-left font-medium py-2 pr-2">Faixa</th>
                  <th className="text-left font-medium py-2 pr-2">Zona-alvo</th>
                  <th className="text-left font-medium py-2 pr-2">Função</th>
                  <th className="text-right font-medium py-2 pr-2">Popularity</th>
                  <th className="text-right font-medium py-2 pr-2">No nicho</th>
                  <th className="text-right font-medium py-2">Fit</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.filter((s) => !s.is_substitution).map((s) => (
                  <tr key={s.spotify_track_id} className="border-b border-border/40 last:border-0 align-top">
                    <td className="py-2 pr-2 text-muted-foreground tabular-nums">
                      {s.suggested_position != null ? `#${s.suggested_position + 1}` : "—"}
                    </td>
                    <td className="py-2 pr-2 min-w-[180px]">
                      <div className="font-medium text-foreground/90 truncate max-w-[260px] flex items-center gap-1.5">
                        {s.nome}
                        {s.trending_position != null && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1 border-primary/40 text-primary bg-primary/5">
                            🔥 #{s.trending_position}
                          </Badge>
                        )}
                        {s.from_missing_artist && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1 border-warning/40 text-warning bg-warning/5">
                            artista faltando
                          </Badge>
                        )}
                        {s.fills_deficit && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1 border-primary/40 text-primary bg-primary/5">
                            preenche déficit
                          </Badge>
                        )}
                      </div>
                      <div className="text-muted-foreground truncate max-w-[260px]">{s.artista}</div>
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap text-foreground/90">
                      {s.target_zone_label ?? (s.target_zone ? ZONE_LABELS[s.target_zone] : "—")}
                    </td>
                    <td className="py-2 pr-2 text-muted-foreground max-w-[200px] truncate">{s.function_role ?? "—"}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {s.popularity == null ? <span className="text-muted-foreground">—</span> : s.popularity}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{s.count}×</td>
                    <td className="py-2 text-right tabular-nums text-foreground/90">{s.zone_fit_score ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}


      {/* Artistas faltando */}
      {missingArtists.length > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-warning" />
            <h2 className="text-sm font-semibold">Artistas faltando no nicho</h2>
            <span className="text-xs text-muted-foreground">{missingArtists.length}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Estão presentes nas playlists vencedoras do gênero mas não na sua.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {missingArtists.slice(0, 12).map((a) => (
              <Badge key={a.artist} variant="outline" className="text-[11px]">
                {a.artist}
                <span className="ml-1.5 text-muted-foreground tabular-nums">×{a.count}</span>
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {/* Tabela operacional */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">
            {filter === "all" ? "Todas as faixas" : STATUS_META[filter].label}
          </h2>
          <span className="text-xs text-muted-foreground">{visible.length}</span>
        </div>
        {visible.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma faixa neste filtro.
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left font-medium py-2 pr-2 w-10">#</th>
                  <th className="text-left font-medium py-2 pr-2">Faixa</th>
                  <th className="text-left font-medium py-2 pr-2">Zona</th>
                  <th className="text-left font-medium py-2 pr-2">Status</th>
                  <th className="text-left font-medium py-2 pr-2">Motivo</th>
                  <th className="text-right font-medium py-2 pr-2">Popularity</th>
                  <th className="text-right font-medium py-2 pr-2">Saturação</th>
                  <th className="text-right font-medium py-2 pr-2">No nicho</th>
                  <th className="text-right font-medium py-2">Idade</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const meta = STATUS_META[t.status];
                  const Icon = meta.icon;
                  const pop = t.popularity;
                  const sat = t.saturation_pct ?? 0;
                  const age = t.age_days_in_playlist;
                  const curZone = t.current_zone;
                  const bestZone = t.best_zone;
                  const zoneMoved = curZone && bestZone && curZone !== bestZone;
                  return (
                    <tr key={t.spotify_track_id} className="border-b border-border/40 last:border-0 align-top">
                      <td className="py-2 pr-2 text-muted-foreground tabular-nums">{t.position + 1}</td>
                      <td className="py-2 pr-2 min-w-[180px]">
                        <div className="font-medium text-foreground/90 truncate max-w-[260px]">{t.track_name ?? "—"}</div>
                        <div className="text-muted-foreground truncate max-w-[260px]">{t.artist_name ?? "—"}</div>
                      </td>
                      <td className="py-2 pr-2 whitespace-nowrap">
                        {curZone ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[11px] text-foreground/90">{ZONE_LABELS[curZone]}</span>
                            {zoneMoved && (
                              <span className="text-[10px] text-warning">→ {ZONE_LABELS[bestZone!]}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <Badge variant="outline" className={cn("text-[10px] gap-1", meta.cls)}>
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="py-2 pr-2 text-muted-foreground max-w-[300px]">
                        {(t.reasons ?? []).join(" · ") || "—"}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {pop == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className={cn(
                            pop >= 60 ? "text-primary" : pop < 30 ? "text-destructive" : "text-foreground",
                          )}>{pop}</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {sat >= 70 ? (
                          <span className="inline-flex items-center gap-0.5 text-destructive">
                            <Flame className="h-3 w-3" />
                            {sat}%
                          </span>
                        ) : sat > 0 ? (
                          <span className="text-foreground">{sat}%</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {t.recurrence_in_genre > 0 ? (
                          <span className="text-foreground">{t.recurrence_in_genre}×</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {age == null ? "—" : `${age}d`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
