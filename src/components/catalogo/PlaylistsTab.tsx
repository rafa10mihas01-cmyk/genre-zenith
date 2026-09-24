import { toast } from "sonner";
// PlaylistsTab — quais playlists do catálogo geram resultado.
// Fontes oficiais (sem nova métrica, só reagrupamento):
//   - v_catalog_playlist_occupancy: capacidade/ocupação (já era usada)
//   - managed_playlists: ponte managed_playlist_id ↔ spotify_playlist_id
//   - v_catalog_track_playlist_attribution: plays_7d e tracks vistas por playlist (mesma fonte do Detalhe da Música)
// A tela ordena por DELIVERY (plays 7d somados) — operador responde "quais playlists geram resultado" em <10s.
// Ocupação fica como informação secundária (drill-down visual).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListMusic, TrendingUp, Layers, Copy, CheckSquare, Check, X, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copyLink, copyLinks, playlistUrl } from "@/lib/copyLinks";
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
type Bridge = {
  id: string;
  spotify_playlist_id: string | null;
  playlist_type: string | null;
  genre_id: string | null;
};
type Attribution = {
  spotify_playlist_id: string | null;
  catalog_track_id: string | null;
  current_plays_7d: number | null;
  last_seen_at: string | null;
};

type Row = {
  managed_playlist_id: string;
  spotify_playlist_id: string | null;
  playlist_name: string;
  playlist_type: "CAMPAIGN" | "CATALOG";
  genre_id: string | null;
  genre_name: string | null;

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
  const [occRes, bridgeRes, attRes, genreRes] = await Promise.all([
    supabase
      .from("v_catalog_playlist_occupancy")
      .select(
        "managed_playlist_id, playlist_name, catalog_capacity, active_placements, available_slots, cover_url, planned_ceiling, effective_ceiling, total_current, free_slots, catalog_count, catalog_target, catalog_missing, third_party_count, third_party_target, third_party_excess",
      )
      .limit(1000),
    supabase
      .from("managed_playlists")
      .select("id, spotify_playlist_id, playlist_type, genre_id")
      .neq("playlist_type", "ARCHIVED")
      .limit(2000),
    supabase
      .from("v_catalog_track_playlist_attribution")
      .select("spotify_playlist_id, catalog_track_id, current_plays_7d, last_seen_at")
      .limit(20000),
    supabase.from("genres").select("id, nome"),
  ]);
  if (occRes.error) throw occRes.error;
  if (bridgeRes.error) throw bridgeRes.error;
  if (attRes.error) throw attRes.error;

  const occ = (occRes.data ?? []) as Occupancy[];
  const bridge = (bridgeRes.data ?? []) as Bridge[];
  const att = (attRes.data ?? []) as Attribution[];

  // gêneros: só rótulo. Se a leitura falhar, a tela continua funcionando.
  const genreById = new Map<string, string>();
  for (const g of (genreRes.data ?? []) as { id: string; nome: string }[]) {
    genreById.set(g.id, g.nome);
  }

  // managed_playlist_id → spotify_playlist_id / tipo / gênero
  const spByManaged = new Map<string, string>();
  const typeByManaged = new Map<string, string>();
  const genreByManaged = new Map<string, string>();
  for (const b of bridge) {
    if (b.playlist_type) typeByManaged.set(b.id, b.playlist_type);
    if (b.spotify_playlist_id) spByManaged.set(b.id, b.spotify_playlist_id);
    if (b.genre_id) genreByManaged.set(b.id, b.genre_id);
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

  const rows: Row[] = occ.filter((o) => typeByManaged.has(o.managed_playlist_id)).map((o) => {
    const sp = spByManaged.get(o.managed_playlist_id);
    const gid = genreByManaged.get(o.managed_playlist_id) ?? null;
    const g = sp ? aggBySp.get(sp) : undefined;
    return {
      managed_playlist_id: o.managed_playlist_id,
      spotify_playlist_id: sp ?? null,
      playlist_name: o.playlist_name ?? "—",
      playlist_type: typeByManaged.get(o.managed_playlist_id) === "CAMPAIGN" ? "CAMPAIGN" : "CATALOG",
      genre_id: gid,
      genre_name: gid ? genreById.get(gid) ?? null : null,

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
const GENRE_NONE = "__none";

function TypeToggle({ row, onChanged }: { row: Row; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const isCampaign = row.playlist_type === "CAMPAIGN";
  const flip = async () => {
    setBusy(true);
    const next = isCampaign ? "CATALOG" : "CAMPAIGN";
    const { error } = await supabase.from("managed_playlists").update({ playlist_type: next }).eq("id", row.managed_playlist_id);
    setBusy(false);
    if (error) { toast.error("Não foi possível mudar o tipo", { description: error.message }); return; }
    toast.success(next === "CAMPAIGN" ? "Agora é playlist de Campanha" : "Agora é playlist de Catálogo");
    onChanged();
  };
  return (
    <button
      type="button"
      onClick={flip}
      disabled={busy}
      title={isCampaign ? "Campanha: só recebe música quando você escolher. Clique para virar Catálogo." : "Catálogo: recebe a distribuição normal. Clique para virar Campanha."}
      className={cn(
        "h-5 px-1.5 rounded border text-[9px] font-bold uppercase tracking-wider shrink-0 transition-colors disabled:opacity-50",
        isCampaign ? "border-amber-500/50 text-amber-500" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {isCampaign ? "Campanha" : "Catálogo"}
    </button>
  );
}

function GenreChip({
  active,
  label,
  count,
  capitalize,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  capitalize?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 inline-flex items-center gap-1.5 h-8 rounded-full border px-3 text-xs font-medium transition-colors",
        capitalize && "capitalize",
        active
          ? "border-primary/60 bg-primary/15 text-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary",
      )}
    >
      {label}
      <span className="tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

export function PlaylistsTab() {
  const q = useQuery({ queryKey: ["catalog", "playlists-ranking"], queryFn: fetchAll, staleTime: 30_000 });
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<"all" | "CATALOG" | "CAMPAIGN">("all");
  const [genreFilter, setGenreFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkSetType = async (type: "CATALOG" | "CAMPAIGN") => {
    const ids = [...selected];
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    const { error } = await supabase.from("managed_playlists").update({ playlist_type: type }).in("id", ids);
    setBulkBusy(false);
    if (error) { toast.error("Não foi possível atualizar as playlists", { description: error.message }); return; }
    toast.success(`${ids.length} playlist${ids.length > 1 ? "s" : ""} marcada${ids.length > 1 ? "s" : ""} como ${type === "CAMPAIGN" ? "Campanha" : "Catálogo"}`);
    setSelected(new Set());
    setSelectMode(false);
    void q.refetch();
  };

  // Lista filtrada — tipo + gênero + nome. É a única lista que a tela usa (cards, cópias, contadores).
  const rows = useMemo(() => {
    const all = q.data ?? [];
    const term = search.trim().toLowerCase();
    return all.filter((r) => {
      if (typeFilter !== "all" && r.playlist_type !== typeFilter) return false;
      if (genreFilter === GENRE_NONE) {
        if (r.genre_id) return false;
      } else if (genreFilter !== "all" && r.genre_id !== genreFilter) return false;
      if (term && !r.playlist_name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [q.data, typeFilter, genreFilter, search]);

  // Opções do filtro de gênero — derivadas da própria lista, sem nova fonte de dado
  const genreOptions = useMemo(() => {
    const byId = new Map<string, { name: string; count: number }>();
    let none = 0;
    for (const r of q.data ?? []) {
      if (!r.genre_id) {
        none += 1;
        continue;
      }
      const cur = byId.get(r.genre_id);
      if (cur) cur.count += 1;
      else byId.set(r.genre_id, { name: r.genre_name ?? "—", count: 1 });
    }
    return {
      items: [...byId.entries()]
        .map(([id, v]) => ({ id, name: v.name, count: v.count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      none,
    };
  }, [q.data]);

  const totals = useMemo(
    () => ({
      withDelivery: rows.filter((r) => r.delivery_7d > 0).length,
      totalDelivery: rows.reduce((s, r) => s + r.delivery_7d, 0),
    }),
    [rows],
  );

  if (q.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  const allRows = q.data ?? [];
  const refetch = () => void q.refetch();
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

      {/* Filtros de tipo + busca por nome — a lista carregada sempre respeita o filtro */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "CATALOG", "CAMPAIGN"] as const).map((t) => (
          <Button key={t} size="sm" variant={typeFilter === t ? "default" : "outline"} className="h-8 rounded-full text-xs"
            onClick={() => { setTypeFilter(t); setPage(1); }}>
            {t === "all" ? `Todas (${allRows.length})` : t === "CATALOG"
              ? `Catálogo (${allRows.filter((r) => r.playlist_type === "CATALOG").length})`
              : `Campanha (${allRows.filter((r) => r.playlist_type === "CAMPAIGN").length})`}
          </Button>
        ))}
        <div className="relative ml-auto w-[170px] md:w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar playlist"
            className="h-8 rounded-full bg-card pl-9 text-xs"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 rounded-full text-xs"
          onClick={() =>
            copyLinks(
              rows.filter((r) => r.delivery_7d > 0 && r.spotify_playlist_id).map((r) => playlistUrl(r.spotify_playlist_id!)),
              "Links das playlists entregando",
            )
          }
        >
          <Copy className="h-3 w-3 mr-1.5" /> Copiar entregando ({totals.withDelivery})
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 rounded-full text-xs"
          onClick={() =>
            copyLinks(
              rows.filter((r) => r.spotify_playlist_id).map((r) => playlistUrl(r.spotify_playlist_id!)),
              "Links de todas as playlists",
            )
          }
        >
          <Copy className="h-3 w-3 mr-1.5" /> Copiar todas ({rows.length})
        </Button>
        <Button
          size="sm"
          variant={selectMode ? "default" : "outline"}
          className="h-8 rounded-full text-xs ml-auto"
          onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}
        >
          <CheckSquare className="h-3 w-3 mr-1.5" /> {selectMode ? "Sair da seleção" : "Selecionar"}
        </Button>
      </div>

      {/* Gênero — filtro em um toque, sempre visível */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible md:pb-0">
        <GenreChip
          active={genreFilter === "all"}
          label="Todos"
          count={allRows.length}
          onClick={() => { setGenreFilter("all"); setPage(1); }}
        />
        {genreOptions.items.map((g) => (
          <GenreChip
            key={g.id}
            active={genreFilter === g.id}
            label={g.name}
            count={g.count}
            capitalize
            onClick={() => { setGenreFilter(g.id); setPage(1); }}
          />
        ))}
        {genreOptions.none > 0 && (
          <GenreChip
            active={genreFilter === GENRE_NONE}
            label="Sem gênero"
            count={genreOptions.none}
            onClick={() => { setGenreFilter(GENRE_NONE); setPage(1); }}
          />
        )}
      </div>

      {/* Modo seleção — barra de ação em massa (Campanha/Catálogo) */}
      {selectMode && (
        <div className="sticky top-0 z-10 flex items-center gap-2 flex-wrap rounded-xl border border-border bg-card p-3">
          <span className="text-sm font-semibold text-foreground tabular-nums mr-1">
            {selected.size} selecionada{selected.size === 1 ? "" : "s"}
          </span>
          <Button
            size="sm"
            className="h-8 rounded-full text-xs font-semibold"
            disabled={selected.size === 0 || bulkBusy}
            onClick={() => bulkSetType("CAMPAIGN")}
          >
            Marcar como Campanha
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-full text-xs"
            disabled={selected.size === 0 || bulkBusy}
            onClick={() => bulkSetType("CATALOG")}
          >
            Marcar como Catálogo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-full text-xs"
            disabled={selected.size === 0 || bulkBusy}
            onClick={() => setSelected(new Set())}
          >
            Limpar seleção
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-full text-xs ml-auto"
            disabled={bulkBusy}
            onClick={() => { setSelectMode(false); setSelected(new Set()); }}
          >
            <X className="h-3.5 w-3.5 mr-1" /> Concluir
          </Button>
        </div>
      )}


      {/* Mobile: cards ordenados por delivery */}
      <div className="md:hidden border border-border rounded-2xl overflow-y-auto bg-card divide-y divide-border max-h-[60vh]">
        {pageRows.map((r) => {

          const pct = r.catalog_capacity > 0 ? Math.min(100, Math.round((r.active_placements / r.catalog_capacity) * 100)) : 0;
          const full = r.available_slots === 0;
          const hasDelivery = r.delivery_7d > 0;
          const isSel = selected.has(r.managed_playlist_id);
          return (
            <div
              key={r.managed_playlist_id}
              onClick={selectMode ? () => toggleSelect(r.managed_playlist_id) : undefined}
              className={cn(
                "p-3 flex items-center gap-3 min-w-0 transition-colors",
                selectMode && "cursor-pointer",
                selectMode && isSel && "bg-primary/5",
              )}
            >
              {selectMode && (
                <div
                  className={cn(
                    "h-5 w-5 rounded-md border flex items-center justify-center shrink-0",
                    isSel ? "bg-primary border-primary" : "border-border",
                  )}
                >
                  {isSel && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                </div>
              )}
              <Cover url={r.cover_url} alt={r.playlist_name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  {selectMode ? (
                    <span className="font-medium text-sm truncate">{r.playlist_name}</span>
                  ) : r.spotify_playlist_id ? (
                    <a
                      href={playlistUrl(r.spotify_playlist_id)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-sm truncate hover:text-primary transition-colors"
                    >
                      {r.playlist_name}
                    </a>
                  ) : (
                    <span className="font-medium text-sm truncate">{r.playlist_name}</span>
                  )}
                  {!selectMode && <TypeToggle row={r} onChanged={refetch} />}
                  {!selectMode && r.spotify_playlist_id && (
                    <button
                      type="button"
                      aria-label="Copiar link da playlist"
                      title="Copiar link"
                      onClick={() => copyLink(playlistUrl(r.spotify_playlist_id!))}
                      className="h-6 w-6 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center shrink-0 transition-colors"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  )}
                </div>

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
          const isSel = selected.has(r.managed_playlist_id);
          return (
            <div
              key={r.managed_playlist_id}
              onClick={selectMode ? () => toggleSelect(r.managed_playlist_id) : undefined}
              className={cn(
                "group rounded-xl border border-border bg-card p-3 flex flex-col gap-2.5 hover:border-border/80 hover:bg-card/80 transition-colors min-w-0 relative",
                selectMode && "cursor-pointer",
                selectMode && isSel && "border-primary/60 ring-1 ring-primary/40 bg-primary/5",
              )}
            >
              {selectMode && (
                <div
                  className={cn(
                    "absolute top-2.5 right-2.5 h-5 w-5 rounded-md border flex items-center justify-center",
                    isSel ? "bg-primary border-primary" : "border-border bg-background",
                  )}
                >
                  {isSel && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                </div>
              )}
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
                  {selectMode ? (
                    <div className="text-sm font-semibold leading-tight line-clamp-2 text-foreground" title={r.playlist_name}>
                      {r.playlist_name}
                    </div>
                  ) : r.spotify_playlist_id ? (
                    <a
                      href={playlistUrl(r.spotify_playlist_id)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-semibold leading-tight line-clamp-2 text-foreground hover:text-primary transition-colors"
                      title={r.playlist_name}
                    >
                      {r.playlist_name}
                    </a>
                  ) : (
                    <div className="text-sm font-semibold leading-tight line-clamp-2 text-foreground" title={r.playlist_name}>
                      {r.playlist_name}
                    </div>
                  )}
                </div>
                {!selectMode && <TypeToggle row={r} onChanged={refetch} />}
                {!selectMode && r.spotify_playlist_id && (
                  <button
                    type="button"
                    aria-label="Copiar link da playlist"
                    title="Copiar link"
                    onClick={() => copyLink(playlistUrl(r.spotify_playlist_id!))}
                    className="h-6 w-6 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center shrink-0 transition-colors"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                )}
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

              {/* Evolução editorial — Catálogo vs Third Party */}
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="flex flex-col gap-0.5">
                  <span className="uppercase tracking-wider text-muted-foreground font-bold">Catálogo</span>
                  <span className="tabular-nums text-foreground font-semibold">
                    {r.catalog_count}<span className="text-muted-foreground"> / {r.catalog_target}</span>
                    {r.catalog_missing > 0 && (
                      <span className="ml-1 text-muted-foreground">(falta {r.catalog_missing})</span>
                    )}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="uppercase tracking-wider text-muted-foreground font-bold">Third Party</span>
                  <span className="tabular-nums text-foreground font-semibold">
                    {r.third_party_count}<span className="text-muted-foreground"> / {r.third_party_target}</span>
                    {r.third_party_excess > 0 && (
                      <span className="ml-1 text-muted-foreground">(+{r.third_party_excess})</span>
                    )}
                  </span>
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
