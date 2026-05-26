import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Radio, Sparkles, Music2, ListMusic } from "lucide-react";
import { formatInt } from "@/lib/campaignEngine";
import { cn } from "@/lib/utils";

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

/**
 * Lista as playlists capturadas pelo bot via `organic_plays_snapshots`
 * (rádio, autoplay, mixes, editoriais e playlists de usuário).
 * Mostra a leitura MAIS RECENTE de cada `spotify_playlist_id`.
 * Esconde-se quando não há nada coletado.
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

  const grouped = useMemo(() => {
    const g: Record<OrganicKind, OrganicRow[]> = { algorithmic: [], organic: [], editorial: [] };
    for (const r of latestByPlaylist) g[r.kind]?.push(r);
    for (const k of Object.keys(g) as OrganicKind[]) {
      g[k].sort((a, b) => Number(b.plays_7d ?? b.plays_28d ?? 0) - Number(a.plays_7d ?? a.plays_28d ?? 0));
    }
    return g;
  }, [latestByPlaylist]);

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
                {list.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-md border border-border/70 bg-elevated/30 p-2.5 flex items-start gap-2"
                  >
                    <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", meta.tone)} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium truncate" title={r.playlist_name ?? "—"}>
                        {r.playlist_name ?? "Playlist sem nome"}
                      </div>
                      <div className="text-[10px] text-muted-foreground tabular-nums">
                        {formatInt(Number(r.plays_7d ?? 0))} /7d
                        {r.plays_28d != null && (
                          <> · {formatInt(Number(r.plays_28d))} /28d</>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
