// PlaylistsTab — quais playlists do catálogo geram resultado.
// Fontes oficiais (sem nova métrica, só reagrupamento):
//   - v_catalog_playlist_occupancy: capacidade/ocupação (já era usada)
//   - managed_playlists: ponte managed_playlist_id ↔ spotify_playlist_id
//   - v_catalog_track_playlist_attribution: plays_7d e tracks vistas por playlist (mesma fonte do Detalhe da Música)
// A tela ordena por DELIVERY (plays 7d somados) — operador responde "quais playlists geram resultado" em <10s.
// Ocupação fica como informação secundária (drill-down visual).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListMusic, TrendingUp, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Occupancy = {
  managed_playlist_id: string;
  playlist_name: string | null;
  catalog_capacity: number | null;
  active_placements: number | null;
  available_slots: number | null;
  cover_url: string | null;
};
type Bridge = { id: string; spotify_playlist_id: string | null };
type Attribution = {
  spotify_playlist_id: string | null;
  catalog_track_id: string | null;
  current_plays_7d: number | null;
  last_seen_at: string | null;
};

type Row = {
  managed_playlist_id: string;
  playlist_name: string;
  catalog_capacity: number;
  active_placements: number;
  available_slots: number;
  cover_url: string | null;
  delivery_7d: number;
  tracks_detected: number;
  last_seen_at: string | null;
};

async function fetchAll(): Promise<Row[]> {
  const [occRes, bridgeRes, attRes] = await Promise.all([
    supabase
      .from("v_catalog_playlist_occupancy")
      .select("managed_playlist_id, playlist_name, catalog_capacity, active_placements, available_slots, cover_url")
      .limit(1000),
    supabase
      .from("managed_playlists")
      .select("id, spotify_playlist_id")
      .is("archived_at", null)
      .limit(2000),
    supabase
      .from("v_catalog_track_playlist_attribution")
      .select("spotify_playlist_id, catalog_track_id, current_plays_7d, last_seen_at")
      .limit(20000),
  ]);
  if (occRes.error) throw occRes.error;
  if (bridgeRes.error) throw bridgeRes.error;
  if (attRes.error) throw attRes.error;

  const occ = (occRes.data ?? []) as Occupancy[];
  const bridge = (bridgeRes.data ?? []) as Bridge[];
  const att = (attRes.data ?? []) as Attribution[];

  // managed_playlist_id → spotify_playlist_id
  const spByManaged = new Map<string, string>();
  for (const b of bridge) {
    if (b.spotify_playlist_id) spByManaged.set(b.id, b.spotify_playlist_id);
  }

  // Agregação por spotify_playlist_id: soma plays_7d, conta tracks distintas, max(last_seen_at)
  type Agg = { delivery: number; tracks: Set<string>; lastSeen: string | null };
  const aggBySp = new Map<string, Agg>();
  for (const a of att) {
    if (!a.spotify_playlist_id) continue;
    let g = aggBySp.get(a.spotify_playlist_id);
    if (!g) {
      g = { delivery: 0, tracks: new Set(), lastSeen: null };
      aggBySp.set(a.spotify_playlist_id, g);
    }
    g.delivery += a.current_plays_7d ?? 0;
    if (a.catalog_track_id) g.tracks.add(a.catalog_track_id);
    if (a.last_seen_at && (!g.lastSeen || a.last_seen_at > g.lastSeen)) g.lastSeen = a.last_seen_at;
  }

  const rows: Row[] = occ.map((o) => {
    const sp = spByManaged.get(o.managed_playlist_id);
    const g = sp ? aggBySp.get(sp) : undefined;
    return {
      managed_playlist_id: o.managed_playlist_id,
      playlist_name: o.playlist_name ?? "—",
      catalog_capacity: o.catalog_capacity ?? 0,
      active_placements: o.active_placements ?? 0,
      available_slots: o.available_slots ?? 0,
      cover_url: o.cover_url,
      delivery_7d: g?.delivery ?? 0,
      tracks_detected: g?.tracks.size ?? 0,
      last_seen_at: g?.lastSeen ?? null,
    };
  });

  // Resposta da tela: ordenar por delivery desc, depois por active desc
  rows.sort((a, b) => b.delivery_7d - a.delivery_7d || b.active_placements - a.active_placements);
  return rows;
}

const fmt = (n: number) => n.toLocaleString("pt-BR");
const relDays = (iso: string | null) => {
  if (!iso) return "—";
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d < 1) return "hoje";
  if (d === 1) return "ontem";
  return `${d}d`;
};

function Cover({ url, alt }: { url: string | null; alt: string }) {
  const [err, setErr] = useState(false);
  if (url && !err) {
    return (
      <img
        src={url}
        alt={alt}
        className="h-10 w-10 rounded object-cover flex-shrink-0"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <div className="h-10 w-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
      <ListMusic className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

export function PlaylistsTab() {
  const q = useQuery({ queryKey: ["catalog", "playlists-ranking"], queryFn: fetchAll, staleTime: 30_000 });

  const totals = useMemo(() => {
    const rows = q.data ?? [];
    return {
      withDelivery: rows.filter((r) => r.delivery_7d > 0).length,
      totalDelivery: rows.reduce((s, r) => s + r.delivery_7d, 0),
    };
  }, [q.data]);

  if (q.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  const rows = q.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      {/* Resumo operacional — responde a pergunta da tela em 1 olhada */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" /> Plays 7d (catálogo nas playlists)
          </div>
          <div className="text-2xl font-bold tabular-nums text-foreground mt-1">{fmt(totals.totalDelivery)}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1.5">
            <Layers className="h-3 w-3" /> Playlists entregando
          </div>
          <div className="text-2xl font-bold tabular-nums text-foreground mt-1">
            {totals.withDelivery}<span className="text-sm text-muted-foreground font-medium"> / {rows.length}</span>
          </div>
        </div>
      </div>

      {/* Mobile: cards ordenados por delivery */}
      <div className="md:hidden border border-border rounded-2xl overflow-y-auto bg-card divide-y divide-border max-h-[60vh]">
        {rows.map((r) => {
          const pct = r.catalog_capacity > 0 ? Math.min(100, Math.round((r.active_placements / r.catalog_capacity) * 100)) : 0;
          const full = r.available_slots === 0;
          const hasDelivery = r.delivery_7d > 0;
          return (
            <div key={r.managed_playlist_id} className="p-3 flex items-center gap-3 min-w-0">
              <Cover url={r.cover_url} alt={r.playlist_name} />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{r.playlist_name}</div>
                <div className="mt-1 flex items-center gap-2 text-[11px] tabular-nums">
                  <span className={cn("font-semibold", hasDelivery ? "text-[#1DB954]" : "text-muted-foreground/50")}>
                    {fmt(r.delivery_7d)} plays/7d
                  </span>
                  <span className="text-muted-foreground/60">·</span>
                  <span className="text-muted-foreground">{r.tracks_detected} faixas</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn("h-full transition-all", full ? "bg-destructive" : "bg-primary/60")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                    {r.active_placements}/{r.catalog_capacity}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: tabela — delivery em primeiro, ocupação em segundo */}
      <div className="hidden md:block border border-border rounded-2xl overflow-y-auto bg-card max-h-[65vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Playlist</TableHead>
              <TableHead className="text-right">Plays 7d</TableHead>
              <TableHead className="text-right">Faixas detectadas</TableHead>
              <TableHead className="text-right">Visto por último</TableHead>
              <TableHead className="text-right">Ocupação</TableHead>
              <TableHead className="w-40">Capacidade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const pct = r.catalog_capacity > 0 ? Math.min(100, Math.round((r.active_placements / r.catalog_capacity) * 100)) : 0;
              const full = r.available_slots === 0;
              const hasDelivery = r.delivery_7d > 0;
              return (
                <TableRow key={r.managed_playlist_id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3 min-w-0">
                      <Cover url={r.cover_url} alt={r.playlist_name} />
                      <span className="truncate">{r.playlist_name}</span>
                    </div>
                  </TableCell>
                  <TableCell className={cn("text-right font-semibold tabular-nums", hasDelivery ? "text-[#1DB954]" : "text-muted-foreground/50")}>
                    {fmt(r.delivery_7d)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{r.tracks_detected}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{relDays(r.last_seen_at)}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {r.active_placements}<span className="text-muted-foreground/50">/{r.catalog_capacity}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn("h-full transition-all", full ? "bg-destructive" : "bg-primary/60")}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
