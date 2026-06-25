import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Music2, Users, AlertCircle, CheckCircle2, Radar, Disc3 } from "lucide-react";
import { useSnapshotGate } from "@/hooks/useSnapshotGate";

type NameReason = {
  type: string;
  value?: string | number | null;
  benchmark_p50?: number | null;
  benchmark_p90?: number | null;
};

type TrackSuggestion = {
  cover_url?: string | null;
  nome?: string | null;
  name?: string | null;
  artista?: string | null;
  artist?: string | null;
  target_zone_label?: string | null;
  function_role?: string | null;
  count?: number | null;
  zone_fit_score?: number | null;
};

type CompetitorRow = {
  spotify_playlist_id: string;
  name?: string | null;
  followers?: number | null;
};

type RecurringTrack = {
  cover_url?: string | null;
  title?: string | null;
  artist?: string | null;
  niche_playlists_count?: number | null;
};

type DiagnosisRaw = {
  market_insights?: {
    top_recurring_tracks?: RecurringTrack[];
  } | null;
};

type DiagnosisRow = {
  id: string;
  created_at: string;
  name_score: number | null;
  name_current: string | null;
  name_suggestion: string | null;
  name_reasons: NameReason[] | null;
  tracks_suggestions: TrackSuggestion[] | null;
  competitors: CompetitorRow[] | null;
  raw: DiagnosisRaw | null;
};

function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("pt-BR").format(n);
}

function scoreTone(score: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 60) return "text-primary";
  if (score >= 30) return "text-warning";
  return "text-destructive";
}

export function PlaylistDiagnosisCard({ managedId }: { managedId: string }) {
  const [diag, setDiag] = useState<DiagnosisRow | null>(null);
  const [loading, setLoading] = useState(true);
  const { loading: gateLoading, gate } = useSnapshotGate(managedId);

  const canRead = gate.kind === "ready" || gate.kind === "no_snapshot";

  useEffect(() => {
    if (!managedId || !canRead) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("playlist_diagnoses")
        .select("id, created_at, name_score, name_current, name_suggestion, name_reasons, tracks_suggestions, competitors, raw")
        .eq("playlist_id", managedId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (active) {
        setDiag(data as DiagnosisRow | null);
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [managedId, canRead]);

  // Phase 4.2 — bloqueia render durante pipeline processando.
  if (gateLoading) {
    return (
      <Card className="p-5 h-32 grid place-items-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (gate.kind === "processing") {
    return (
      <Card className="p-5 text-sm text-muted-foreground flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Pipeline de análise em execução — diagnóstico será exibido quando o snapshot ficar pronto.
      </Card>
    );
  }

  if (gate.kind === "failed") {
    return (
      <Card className="p-5 text-sm text-warning border-warning/30">
        Última análise falhou{gate.failureReason ? `: ${gate.failureReason}` : ""}. Exibindo último diagnóstico válido abaixo.
        {/* fallback continua com o último diag persistido — sem mistura de estados visuais */}
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="p-5 h-32 grid place-items-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!diag) {
    return (
      <Card className="p-5 text-sm text-muted-foreground">
        Ainda não há diagnóstico. Clique em <span className="text-foreground font-medium">Diagnosticar agora</span> para gerar.
      </Card>
    );
  }

  const reasons: NameReason[] = Array.isArray(diag.name_reasons) ? diag.name_reasons : [];
  const missingKeywords = reasons.filter((r) => r?.type === "missing_keyword").map((r) => r.value).filter(Boolean) as string[];
  const sizeReasons = reasons.filter((r) => r?.type === "too_many_tracks" || r?.type === "too_few_tracks");
  const tracks: TrackSuggestion[] = Array.isArray(diag.tracks_suggestions) ? diag.tracks_suggestions : [];
  const competitors: CompetitorRow[] = Array.isArray(diag.competitors) ? diag.competitors : [];
  const market = diag.raw?.market_insights ?? {};
  const topRecurring: RecurringTrack[] = Array.isArray(market?.top_recurring_tracks) ? market.top_recurring_tracks : [];

  // Total agregado de followers nos concorrentes para calcular "dominância"
  const totalCompFollowers = competitors.reduce((acc, c) => acc + (Number(c.followers) || 0), 0);

  return (
    <div className="space-y-4">
      {/* Assinatura visual do nicho — DNA editorial */}
      {topRecurring.length > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Disc3 className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">DNA do nicho</h2>
            <span className="text-xs text-muted-foreground">faixas que definem o gênero agora</span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-3">
            {topRecurring.slice(0, 8).map((t, i) => (
              <div key={i} className="space-y-1.5">
                <div className="aspect-square rounded-md overflow-hidden bg-muted border border-border">
                  {t.cover_url ? (
                    <img src={t.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full grid place-items-center">
                      <Music2 className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="text-[10px] text-foreground/90 font-medium leading-tight line-clamp-2">{t.title ?? "—"}</div>
                <div className="text-[10px] text-muted-foreground leading-tight line-clamp-1">{t.artist ?? "—"}</div>
                {t.niche_playlists_count != null && (
                  <div className="text-[9px] text-muted-foreground tabular-nums">
                    {t.niche_playlists_count}× no nicho
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Análise de nome */}
        <Card className="p-5 space-y-3 lg:col-span-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Análise do nome</h2>
            </div>
            <span className={`text-lg font-semibold tabular-nums ${scoreTone(diag.name_score)}`}>
              {diag.name_score ?? "—"}<span className="text-xs text-muted-foreground">/100</span>
            </span>
          </div>

          {diag.name_suggestion && (
            <div className="text-xs space-y-1">
              <div className="text-muted-foreground uppercase tracking-wider">Sugestão</div>
              <div className="text-foreground/90 leading-snug">{diag.name_suggestion}</div>
            </div>
          )}

          {missingKeywords.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                Palavras-chave faltando
              </div>
              <div className="flex flex-wrap gap-1">
                {missingKeywords.slice(0, 10).map((k: string) => (
                  <Badge key={k} variant="outline" className="text-[10px] border-warning/40 text-warning">
                    {k}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {sizeReasons.map((r, i) => (
            <div key={i} className="flex gap-2 items-start text-xs text-warning bg-warning/5 border border-warning/30 rounded-md p-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                {r.type === "too_many_tracks"
                  ? `Playlist com ${fmtNum(Number(r.value))} faixas (acima do p90 do gênero: ${fmtNum(r.benchmark_p90)})`
                  : `Playlist com ${fmtNum(Number(r.value))} faixas (abaixo da metade do p50: ${fmtNum(r.benchmark_p50)})`}
              </div>
            </div>
          ))}

          {missingKeywords.length === 0 && sizeReasons.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              Nenhum ajuste sugerido.
            </div>
          )}
        </Card>

        {/* Faixas para adicionar — agora com capas */}
        <Card className="p-5 space-y-3 lg:col-span-1">
          <div className="flex items-center gap-2">
            <Music2 className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Faixas para adicionar</h2>
            <span className="text-xs text-muted-foreground">{tracks.length}</span>
          </div>
          {tracks.length === 0 ? (
            <div className="text-xs text-muted-foreground">Sem sugestões de faixas.</div>
          ) : (
            <ul className="space-y-2.5">
              {tracks.slice(0, 10).map((t, i) => (
                <li key={i} className="flex gap-2.5 items-start text-xs">
                  <div className="w-10 h-10 rounded-md bg-muted overflow-hidden shrink-0 border border-border">
                    {t.cover_url ? (
                      <img src={t.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full grid place-items-center">
                        <Music2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground/90 font-medium truncate">{t.nome ?? t.name ?? "—"}</div>
                    <div className="text-muted-foreground truncate">{t.artista ?? t.artist ?? "—"}</div>
                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                      {t.target_zone_label && (
                        <Badge variant="outline" className="text-[9px] border-primary/30 text-primary">
                          {t.target_zone_label}
                        </Badge>
                      )}
                      {t.function_role && (
                        <span className="text-[9px] text-muted-foreground truncate">{t.function_role}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    {t.count != null && (
                      <div className="text-[10px] text-muted-foreground tabular-nums">{t.count}× nicho</div>
                    )}
                    {t.zone_fit_score != null && (
                      <div className="text-[10px] text-primary tabular-nums">fit {t.zone_fit_score}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Radar competitivo — visual neutro, sem capas de terceiros */}
        <Card className="p-5 space-y-3 lg:col-span-1">
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Radar do nicho</h2>
            <span className="text-xs text-muted-foreground">{competitors.length}</span>
          </div>
          {competitors.length === 0 ? (
            <div className="text-xs text-muted-foreground">Sem leitura de mercado disponível.</div>
          ) : (
            <ul className="space-y-2">
              {competitors.slice(0, 8).map((c, i) => {
                const followers = Number(c.followers) || 0;
                const dom = totalCompFollowers > 0 ? Math.round((followers / totalCompFollowers) * 100) : null;
                return (
                  <li key={i} className="flex gap-2 items-center text-xs">
                    <div className="w-7 h-7 rounded-md bg-muted/40 border border-border grid place-items-center shrink-0">
                      <Music2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <a
                        href={`https://open.spotify.com/playlist/${c.spotify_playlist_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground/90 font-medium truncate block hover:text-primary"
                      >
                        {c.name ?? "—"}
                      </a>
                      <div className="text-muted-foreground tabular-nums">
                        {fmtNum(followers)} seguidores
                      </div>
                    </div>
                    {dom != null && (
                      <Badge variant="outline" className="text-[10px] border-border text-muted-foreground tabular-nums">
                        {dom}%
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
