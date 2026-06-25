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
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";


import { cn } from "@/lib/utils";

type Occupancy = {
  managed_playlist_id: string;
  playlist_name: string | null;
  catalog_capacity: number | null;
  active_placements: number | null;
  available_slots: number | null;
  cover_url: string | null;
  planned_ceiling: number | null;
  effective_ceiling: number | null;
  total_current: number | null;
  free_slots: number | null;
  catalog_count: number | null;
  catalog_target: number | null;
  catalog_missing: number | null;
  third_party_count: number | null;
  third_party_target: number | null;
  third_party_excess: number | null;
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
  planned_ceiling: number;
  effective_ceiling: number;
  total_current: number;
  free_slots: number;
  catalog_count: number;
  catalog_target: number;
  catalog_missing: number;
  third_party_count: number;
  third_party_target: number;
  third_party_excess: number;
};

async function fetchAll(): Promise<Row[]> {
  const [occRes, bridgeRes, attRes] = await Promise.all([
    supabase
      .from("v_catalog_playlist_occupancy")
      .select(
        "managed_playlist_id, playlist_name, catalog_capacity, active_placements, available_slots, cover_url, planned_ceiling, effective_ceiling, total_current, free_slots, catalog_count, catalog_target, catalog_missing, third_party_count, third_party_target, third_party_excess",
      )
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
      planned_ceiling: o.planned_ceiling ?? 0,
      effective_ceiling: o.effective_ceiling ?? 0,
      total_current: o.total_current ?? 0,
      free_slots: o.free_slots ?? 0,
      catalog_count: o.catalog_count ?? 0,
      catalog_target: o.catalog_target ?? 0,
      catalog_missing: o.catalog_missing ?? 0,
      third_party_count: o.third_party_count ?? 0,
      third_party_target: o.third_party_target ?? 0,
      third_party_excess: o.third_party_excess ?? 0,
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

const PAGE_SIZE = 24;

export function PlaylistsTab() {
  const q = useQuery({ queryKey: ["catalog", "playlists-ranking"], queryFn: fetchAll, staleTime: 30_000 });
  const [page, setPage] = useState(1);

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
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);



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
        {pageRows.map((r) => {

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

      {/* Desktop: grid de cards — capa pequena no topo, info dominante embaixo */}
      <div className="hidden md:grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {pageRows.map((r) => {
          const pct = r.catalog_capacity > 0 ? Math.min(100, Math.round((r.active_placements / r.catalog_capacity) * 100)) : 0;
          const full = r.available_slots === 0;
          const hasDelivery = r.delivery_7d > 0;
          return (
            <div
              key={r.managed_playlist_id}
              className="group rounded-xl border border-border bg-card p-3 flex flex-col gap-2.5 hover:border-border/80 hover:bg-card/80 transition-colors min-w-0"
            >
              {/* Header: capa pequena + nome ao lado */}
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="relative h-12 w-12 rounded-md overflow-hidden bg-muted shrink-0">
                  {r.cover_url ? (
                    <img
                      src={r.cover_url}
                      alt={r.playlist_name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ListMusic className="h-5 w-5 text-muted-foreground/60" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold leading-tight line-clamp-2 text-foreground" title={r.playlist_name}>
                    {r.playlist_name}
                  </div>
                </div>
              </div>

              {/* Métricas principais — grid de 3 blocos legíveis */}
              <div className="grid grid-cols-3 gap-[1px] bg-border/60 border border-border/60 rounded-md overflow-hidden">
                <div className="bg-card px-2 py-1.5">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Plays 7d</div>
                  <div className={cn("text-sm font-bold tabular-nums mt-0.5", hasDelivery ? "text-[#1DB954]" : "text-muted-foreground/50")}>
                    {fmt(r.delivery_7d)}
                  </div>
                </div>
                <div className="bg-card px-2 py-1.5">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Faixas</div>
                  <div className="text-sm font-bold tabular-nums mt-0.5 text-foreground">
                    {r.tracks_detected}
                  </div>
                </div>
                <div className="bg-card px-2 py-1.5">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Visto</div>
                  <div className="text-sm font-bold tabular-nums mt-0.5 text-foreground">
                    {relDays(r.last_seen_at)}
                  </div>
                </div>
              </div>

              {/* Ocupação — linha clara com números legíveis */}
              <div>
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-bold mb-1">
                  <span className="text-muted-foreground">Ocupação</span>
                  <span className="tabular-nums text-foreground">{r.active_placements}/{r.catalog_capacity} · {pct}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn("h-full transition-all", full ? "bg-destructive" : "bg-primary/70")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>



      {/* Paginação — mesmo padrão das outras telas (Curadores etc.) */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 pt-2">
          <Button variant="outline" size="sm" className="rounded-full h-8" disabled={safePage === 1} onClick={() => setPage(1)}>«</Button>
          <Button variant="outline" size="sm" className="rounded-full h-8" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>‹</Button>
          <span className="text-xs text-muted-foreground px-3 tabular-nums">
            {safePage} / {totalPages}
          </span>
          <Button variant="outline" size="sm" className="rounded-full h-8" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>›</Button>
          <Button variant="outline" size="sm" className="rounded-full h-8" disabled={safePage === totalPages} onClick={() => setPage(totalPages)}>»</Button>
        </div>
      )}
    </div>

  );
}
