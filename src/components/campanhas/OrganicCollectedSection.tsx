import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Radio, Sparkles, Music2, ListMusic } from "lucide-react";
import { formatInt } from "@/lib/campaignEngine";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

export type OrganicKind = "algorithmic" | "organic" | "editorial";

export type OrganicRow = {
  id: string;
  spotify_playlist_id: string | null;
  playlist_name: string | null;
  kind: OrganicKind;
  plays_7d: number | null;
  plays_28d: number | null;
  captured_at: string;
};

type Props = {
  rows: OrganicRow[];
};

const KIND_META: Record<OrganicKind, { label: string; icon: typeof Radio; tone: string }> = {
  algorithmic: { label: "Algorítmicas", icon: Sparkles, tone: "text-primary" },
  organic: { label: "Orgânicas (usuários)", icon: Music2, tone: "text-foreground" },
  editorial: { label: "Editoriais", icon: ListMusic, tone: "text-warning" },
};

/** mult_real = (plays_7d × 30/7) / followers — plays/mês por seguidor. */
function computeMult(plays7d: number | null | undefined, followers: number | null | undefined): number | null {
  const p = Number(plays7d ?? 0);
  const f = Number(followers ?? 0);
  if (!p || !f) return null;
  return (p * 30 / 7) / f;
}

function multTone(m: number): "success" | "warning" | "destructive" {
  if (m >= 30) return "success";
  if (m >= 10) return "warning";
  return "destructive";
}

const TONE_CLS: Record<"success" | "warning" | "destructive", string> = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
};

/**
 * Lista as playlists capturadas pelo bot via `organic_plays_snapshots`.
 * Faz match com `curator_playlists` (por `spotify_playlist_id`) pra obter
 * followers e calcular mult_real = (plays_7d × 30/7) / followers.
 */
export function OrganicCollectedSection({ rows }: Props) {
  const latestByPlaylist = useMemo(() => {
    const m = new Map<string, OrganicRow>();
    for (const r of rows) {
      const key = r.spotify_playlist_id ?? `name:${r.playlist_name ?? r.id}`;
      const prev = m.get(key);
      if (!prev || new Date(r.captured_at) > new Date(prev.captured_at)) m.set(key, r);
    }
    return Array.from(m.values());
  }, [rows]);

  // Busca followers das playlists matchadas em curator_playlists.
  const spotifyIds = useMemo(
    () => Array.from(new Set(latestByPlaylist.map((r) => r.spotify_playlist_id).filter(Boolean) as string[])),
    [latestByPlaylist],
  );
  const [followersMap, setFollowersMap] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    if (spotifyIds.length === 0) {
      setFollowersMap({});
      return;
    }
    (async () => {
      const { data } = await supabase
        // Separação operacional × observacional
        .from("v_curator_playlists_operational")
        .select("spotify_playlist_id, followers")
        .in("spotify_playlist_id", spotifyIds)
        .not("followers", "is", null);
      if (cancelled) return;
      const map: Record<string, number> = {};
      for (const row of (data ?? []) as Array<{ spotify_playlist_id: string | null; followers: number | null }>) {
        if (!row.spotify_playlist_id) continue;
        const f = Number(row.followers ?? 0);
        if (f > 0 && (!map[row.spotify_playlist_id] || f > map[row.spotify_playlist_id])) {
          map[row.spotify_playlist_id] = f;
        }
      }
      setFollowersMap(map);
    })();
    return () => {
      cancelled = true;
    };
    // spotifyIds.join(",") é uma string estável que muda só quando o conjunto muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotifyIds.join(",")]);

  const grouped = useMemo(() => {
    const g: Record<OrganicKind, OrganicRow[]> = { algorithmic: [], organic: [], editorial: [] };
    for (const r of latestByPlaylist) g[r.kind]?.push(r);
    for (const k of Object.keys(g) as OrganicKind[]) {
      g[k].sort((a, b) => Number(b.plays_7d ?? b.plays_28d ?? 0) - Number(a.plays_7d ?? a.plays_28d ?? 0));
    }
    return g;
  }, [latestByPlaylist]);

  // Média de mult_real entre playlists não-algorítmicas com followers conhecidos.
  const multSummary = useMemo(() => {
    const mults: number[] = [];
    let matched = 0;
    let totalEligible = 0;
    for (const r of latestByPlaylist) {
      if (r.kind === "algorithmic") continue;
      totalEligible += 1;
      const f = r.spotify_playlist_id ? followersMap[r.spotify_playlist_id] : null;
      const m = computeMult(r.plays_7d, f);
      if (m != null) {
        matched += 1;
        mults.push(m);
      }
    }
    const avg = mults.length > 0 ? mults.reduce((s, v) => s + v, 0) / mults.length : null;
    return { avg, matched, totalEligible };
  }, [latestByPlaylist, followersMap]);

  if (latestByPlaylist.length === 0) return null;

  const orderedKinds: OrganicKind[] = ["algorithmic", "editorial", "organic"];

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div>
          <div className="text-sm font-semibold">Orgânico coletado</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Playlists fora do ecossistema onde a música apareceu (rádio, autoplay, mixes, editoriais e listas de usuários).
            Capturado pelo bot a partir dos dados desta campanha.
          </p>
        </div>

        {orderedKinds.map((k) => {
          const list = grouped[k];
          if (list.length === 0) return null;
          const meta = KIND_META[k];
          const Icon = meta.icon;
          const subtotal = list.reduce((s, r) => s + Number(r.plays_7d ?? r.plays_28d ?? 0), 0);

          return (
            <section key={k} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className={cn("h-3.5 w-3.5", meta.tone)} />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{list.length}</span>
                </div>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {formatInt(subtotal)} plays/7d
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {list.map((r) => {
                  const plays7d = Number(r.plays_7d ?? 0);
                  const followers = r.spotify_playlist_id ? followersMap[r.spotify_playlist_id] : null;
                  const isAlgo = r.kind === "algorithmic";
                  const mult = !isAlgo ? computeMult(plays7d, followers) : null;
                  const playsDia = plays7d / 7;

                  return (
                    <div
                      key={r.id}
                      className="rounded-md border border-border/70 bg-elevated/30 p-2.5 flex items-start gap-2"
                    >
                      <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", meta.tone)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-[12px] font-medium truncate" title={r.playlist_name ?? "—"}>
                            {r.playlist_name ?? "Playlist sem nome"}
                          </div>
                          {isAlgo ? (
                            <span className="shrink-0 inline-flex items-center rounded-full border border-primary/30 bg-primary/15 text-primary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider">
                              Algoritmo
                            </span>
                          ) : mult != null ? (
                            <span
                              className={cn(
                                "shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tabular-nums",
                                TONE_CLS[multTone(mult)],
                              )}
                              title={`mult_real = (plays_7d × 30/7) / followers · ${followers?.toLocaleString("pt-BR")} followers`}
                            >
                              ×{mult.toFixed(1)}
                            </span>
                          ) : plays7d > 0 ? (
                            <span className="shrink-0 inline-flex items-center rounded-full border border-border bg-muted/30 text-muted-foreground px-1.5 py-0.5 text-[9px] font-semibold tabular-nums">
                              {playsDia < 1 ? playsDia.toFixed(1) : Math.round(playsDia)} plays/dia
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                          {formatInt(plays7d)} /7d
                          {r.plays_28d != null && (
                            <> · {formatInt(Number(r.plays_28d))} /28d</>
                          )}
                          {followers != null && (
                            <> · {formatInt(followers)} seguidores</>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* Rodapé: média mult_real */}
        {multSummary.totalEligible > 0 && (
          <div className="pt-3 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {multSummary.matched} de {multSummary.totalEligible} playlists com followers conhecidos
            </span>
            {multSummary.avg != null ? (
              <span className="flex items-center gap-1.5">
                <span>Multiplicador médio</span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums",
                    TONE_CLS[multTone(multSummary.avg)],
                  )}
                >
                  ×{multSummary.avg.toFixed(1)}
                </span>
              </span>
            ) : (
              <span className="italic">Sem followers ainda — coletando</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
