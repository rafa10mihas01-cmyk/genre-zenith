import { Card } from "@/components/ui/card";
import { Crown, Target, Users, Flame, Check, Sigma } from "lucide-react";
import { fmtNum, norm } from "../helpers";

export function MarketBlock({
  market, idealRange, currentTrackKeys, currentArtistKeys, suggestionByTitle, onJumpToAdd,
}: {
  market: any;
  idealRange: any;
  currentTrackKeys: Set<string>;
  currentArtistKeys: Set<string>;
  suggestionByTitle: Map<string, string>;
  onJumpToAdd: (trackId?: string) => void;
}) {
  const sampleSize = market.niche_playlist_count ?? 0;
  const benchmarkReady = Array.isArray(idealRange) && idealRange[0] != null && idealRange[1] != null;
  const saturation = market.avg_saturation_pct ?? null;

  return (
    <div className="space-y-4">
      {/* ===== Chip compacto: Tamanho ideal + Saturação (Fase 7A.2) ===== */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5 text-primary" />
          <span>Tamanho ideal</span>
          {benchmarkReady ? (
            <span className="tabular-nums font-medium text-foreground">
              {idealRange[0]}–{idealRange[1]} faixas
            </span>
          ) : (
            <span className="text-muted-foreground">
              {sampleSize > 0 ? "sem faixa ideal ainda" : "sem dados do nicho"}
            </span>
          )}
        </div>
        {saturation != null && (
          <div className="flex items-center gap-1.5">
            <Sigma className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Saturação do nicho</span>
            <span className="tabular-nums font-medium text-foreground">{saturation}%</span>
          </div>
        )}
        {sampleSize > 0 && (
          <span className="text-muted-foreground/70">
            base: {sampleSize} playlists analisadas
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ===== 1. Faixas mais recorrentes (ação primária) ===== */}
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Faixas mais recorrentes</span>
          </div>
          <ul className="space-y-1.5">
            {(market.top_recurring_tracks ?? []).slice(0, 5).map((t: any, i: number) => {
              const key = norm(t.title);
              const isInPlaylist = currentTrackKeys.has(key);
              const suggestedId = suggestionByTitle.get(key);
              return (
                <li key={i} className="text-xs">
                  <div className="font-medium truncate flex items-center gap-1.5">
                    {isInPlaylist && <Check className="h-3 w-3 text-primary shrink-0" />}
                    <span className="truncate">{t.title ?? "—"}</span>
                  </div>
                  <div className="text-muted-foreground truncate flex justify-between items-center gap-2">
                    <span className="truncate">{t.artist ?? "—"}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isInPlaylist ? (
                        <span className="text-[9px] uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          Na playlist
                        </span>
                      ) : suggestedId ? (
                        <button
                          onClick={() => onJumpToAdd(suggestedId)}
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
        </Card>

        {/* ===== 2. Artistas dominando ===== */}
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Artistas dominando</span>
          </div>
          <ul className="space-y-1">
            {(market.top_artists ?? []).slice(0, 6).map((a: any, i: number) => {
              const present = currentArtistKeys.has(norm(a.name));
              return (
                <li key={i} className="flex justify-between items-center text-xs gap-2">
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
        </Card>
      </div>

      {/* ===== 3. Playlists líderes (inspiração — full width, último) ===== */}
      {(market.leader_playlists?.length ?? 0) > 0 && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Playlists líderes do nicho</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {market.leader_playlists.slice(0, 6).map((p: any) => (
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
        </Card>
      )}

      {/* Estado vazio do benchmark — só aparece quando não há nem range nem sample */}
      {!benchmarkReady && sampleSize === 0 && (
        <div className="text-[11px] text-muted-foreground px-1">
          Cron diário roda às 03:00 — inclua concorrentes monitorados neste nicho.
        </div>
      )}
    </div>
  );
}
