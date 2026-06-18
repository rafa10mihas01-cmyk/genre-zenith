// MarketTab — refatorado na Fase 7D / D3.
// TabShell: Banner → KPIs (cobertura/recorrência/saturação/benchmark) → Primary (grid 2-col uniforme) → Secondary (líderes).
import { Card } from "@/components/ui/card";
import { Crown, Flame, Users, Check, Target, Sigma, BarChart3 } from "lucide-react";
import { TabShell } from "../shared/ds/TabShell";
import { TabContextBanner } from "../shared/ds/TabContextBanner";
import { TabKpiStrip } from "../shared/ds/TabKpiStrip";
import { KpiCard } from "../shared/ds/KpiCard";
import { SecondarySection } from "../shared/ds/SecondarySection";
import { useCockpit } from "../context/CockpitContext";
import { fmtNum, norm } from "../helpers";

export function MarketTab() {
  const {
    market, idealRange, currentTrackKeys, currentArtistKeys,
    suggestionByTitle, jumpToPlanAdd, liveTracksCount, genreName,
  } = useCockpit();
  if (!market) return null;

  const sampleSize = market.niche_playlist_count ?? 0;
  const benchmarkReady = Array.isArray(idealRange) && idealRange[0] != null && idealRange[1] != null;
  const saturation = market.avg_saturation_pct ?? null;
  const recurringTracks = market.top_recurring_tracks ?? [];
  const dominantArtists = market.top_artists ?? [];
  const leaders = market.leader_playlists ?? [];

  // ===== KPIs derivados (zero query nova) =====
  // Cobertura: % de faixas top-recorrentes do nicho que já estão na playlist
  const recurringTotal = recurringTracks.length;
  const recurringPresent = recurringTracks.filter((t) => currentTrackKeys.has(norm(t.title))).length;
  const coveragePct = recurringTotal > 0 ? Math.round((recurringPresent / recurringTotal) * 100) : null;

  // Recorrência média: média de niche_playlists_count das top recorrentes
  const avgRecurrence = recurringTotal > 0
    ? Math.round(recurringTracks.reduce((s: number, t: any) => s + (t.niche_playlists_count ?? 0), 0) / recurringTotal)
    : null;

  // Benchmark: posição da playlist vs faixa ideal
  let benchmarkValue = "—";
  let benchmarkHint = "sem benchmark";
  let benchmarkTone: "default" | "primary" | "warning" = "default";
  if (benchmarkReady) {
    const [lo, hi] = idealRange as [number, number];
    if (liveTracksCount < lo) {
      benchmarkValue = `+${lo - liveTracksCount}`;
      benchmarkHint = `para entrar na faixa ${lo}–${hi}`;
      benchmarkTone = "warning";
    } else if (liveTracksCount > hi) {
      benchmarkValue = `−${liveTracksCount - hi}`;
      benchmarkHint = `para sair acima de ${hi}`;
      benchmarkTone = "warning";
    } else {
      benchmarkValue = "OK";
      benchmarkHint = `dentro de ${lo}–${hi}`;
      benchmarkTone = "primary";
    }
  }

  const bannerStatus = (
    <>
      {genreName && (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Nicho</span>
          <span className="font-medium text-foreground">{genreName}</span>
        </div>
      )}
      {sampleSize > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Base</span>
          <span className="font-medium text-foreground tabular-nums">{sampleSize} playlists</span>
        </div>
      )}
    </>
  );

  return (
    <TabShell
      banner={
        <TabContextBanner
          title="Mercado"
          subtitle="Entenda o nicho e descubra o que falta para competir."
          status={bannerStatus}
        />
      }
      kpis={
        <TabKpiStrip>
          <KpiCard
            label="Cobertura"
            value={coveragePct != null ? `${coveragePct}%` : "—"}
            hint={coveragePct != null ? `${recurringPresent}/${recurringTotal} recorrentes presentes` : "sem dados do nicho"}
            tone={coveragePct != null && coveragePct >= 60 ? "primary" : coveragePct != null && coveragePct >= 30 ? "warning" : "muted"}
            icon={<Flame className="h-3.5 w-3.5" />}
          />
          <KpiCard
            label="Recorrência"
            value={avgRecurrence != null ? `${avgRecurrence}×` : "—"}
            hint={avgRecurrence != null ? "média no top recorrentes" : "sem amostra"}
            tone={avgRecurrence != null ? "default" : "muted"}
            icon={<BarChart3 className="h-3.5 w-3.5" />}
          />
          <KpiCard
            label="Saturação"
            value={saturation != null ? `${saturation}%` : "—"}
            hint={saturation != null ? (saturation < 40 ? "espaço livre" : saturation < 70 ? "mercado médio" : "muito saturado") : "sem dados"}
            tone={saturation != null && saturation < 40 ? "primary" : saturation != null && saturation > 70 ? "warning" : "default"}
            icon={<Sigma className="h-3.5 w-3.5" />}
          />
          <KpiCard
            label="Benchmark"
            value={benchmarkValue}
            hint={benchmarkHint}
            tone={benchmarkTone}
            icon={<Target className="h-3.5 w-3.5" />}
          />
        </TabKpiStrip>
      }
      primary={
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Faixas recorrentes */}
          <Card className="p-5 flex flex-col min-h-[420px]">
            <div className="flex items-center gap-2 mb-3">
              <Flame className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Faixas mais recorrentes do nicho</span>
            </div>
            {recurringTracks.length === 0 ? (
              <div className="flex-1 grid place-items-center text-xs text-muted-foreground">
                Sem amostra do nicho ainda.
              </div>
            ) : (
              <ul className="space-y-2 flex-1 overflow-y-auto nx-scroll pr-1">
                {recurringTracks.slice(0, 10).map((t, i: number) => {
                  const key = norm(t.title);
                  const isInPlaylist = currentTrackKeys.has(key);
                  const suggestedId = suggestionByTitle.get(key);
                  return (
                    <li key={i} className="text-xs border-b border-border/40 last:border-0 pb-2 last:pb-0">
                      <div className="font-medium truncate flex items-center gap-1.5">
                        {isInPlaylist && <Check className="h-3 w-3 text-primary shrink-0" />}
                        <span className="truncate">{t.title ?? "—"}</span>
                      </div>
                      <div className="text-muted-foreground truncate flex justify-between items-center gap-2 mt-0.5">
                        <span className="truncate">{t.artist ?? "—"}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isInPlaylist ? (
                            <span className="text-[9px] uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                              Na playlist
                            </span>
                          ) : suggestedId ? (
                            <button
                              onClick={() => jumpToPlanAdd(suggestedId)}
                              className="text-[9px] uppercase tracking-wider text-primary bg-primary/15 hover:bg-primary/25 px-1.5 py-0.5 rounded transition-colors"
                            >
                              Sugerida
                            </button>
                          ) : (
                            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 px-1.5 py-0.5">
                              Fora do plano
                            </span>
                          )}
                          <span className="tabular-nums">{t.niche_playlists_count}×</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Artistas dominantes */}
          <Card className="p-5 flex flex-col min-h-[420px]">
            <div className="flex items-center gap-2 mb-3">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Artistas dominantes</span>
            </div>
            {dominantArtists.length === 0 ? (
              <div className="flex-1 grid place-items-center text-xs text-muted-foreground">
                Sem amostra do nicho ainda.
              </div>
            ) : (
              <ul className="space-y-1.5 flex-1 overflow-y-auto nx-scroll pr-1">
                {dominantArtists.slice(0, 12).map((a, i: number) => {
                  const present = currentArtistKeys.has(norm(a.name));
                  return (
                    <li key={i} className="flex justify-between items-center text-xs gap-2 py-1 border-b border-border/40 last:border-0">
                      <span className="truncate flex-1 flex items-center gap-1.5">
                        {present ? (
                          <Check className="h-3 w-3 text-primary shrink-0" />
                        ) : (
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 bg-muted/40 px-1 py-0.5 rounded shrink-0">
                            fora
                          </span>
                        )}
                        <span className="truncate">{a.name}</span>
                      </span>
                      <span className="text-muted-foreground tabular-nums shrink-0">{a.plays_in_niche}×</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      }
      secondary={
        leaders.length > 0 ? (
          <SecondarySection title={`Playlists líderes do nicho (${leaders.length})`}>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              {leaders.slice(0, 12).map((p) => (
                <a
                  key={p.spotify_playlist_id}
                  href={`https://open.spotify.com/playlist/${p.spotify_playlist_id}`}
                  target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 p-2 rounded-lg border border-border hover:border-primary/40 transition-colors"
                >
                  {p.cover_url && <img src={p.cover_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{p.name}</div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">{fmtNum(p.followers)} seg.</div>
                  </div>
                </a>
              ))}
            </div>
          </SecondarySection>
        ) : undefined
      }
    />
  );
}
