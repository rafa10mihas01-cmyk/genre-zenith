import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListMusic, Music2, ExternalLink, Search, X } from "lucide-react";
import { LoadMore, usePagination } from "@/components/LoadMore";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Empty, SkeletonGrid } from "@/components/cerebro/_shared";

/* ============================================================================
 * BASE — Biblioteca do gênero (Playlists / Faixas / Artistas)
 *  - Mini-KPIs: total playlists, alcance, faixas únicas, artistas únicos
 *  - 3 sub-abas com busca, filtro tier e ordenação
 *  - Capa, link Spotify, % cobertura, agregação por artista (frontend)
 * ========================================================================== */

type BasePlaylist = {
  nome: string;
  url?: string;
  imagem?: string | null;
  seguidores?: number | null;
  total_musicas?: number | null;
};
type BaseTrack = { nome: string; artista: string; count: number };
type ArtistAgg = { artista: string; faixas: number; aparicoes: number };

export function classifyTier(followers?: number | null): "mega" | "big" | "medio" | "small" {
  const f = followers ?? 0;
  if (f >= 100_000) return "mega";
  if (f >= 10_000) return "big";
  if (f >= 1_000) return "medio";
  return "small";
}

export const TIER_META: Record<string, { label: string; cls: string }> = {
  mega:  { label: "Mega",  cls: "bg-primary/15 text-primary border-primary/30" },
  big:   { label: "Big",   cls: "bg-success/15 text-success border-success/30" },
  medio: { label: "Médio", cls: "bg-warning/15 text-warning border-warning/30" },
  small: { label: "Small", cls: "bg-muted/40 text-muted-foreground border-border" },
};

export function Base({ model, loading }: any) {
  const playlists: BasePlaylist[] = model?.playlists_dominantes ?? [];
  const tracks: BaseTrack[] = model?.musicas_recorrentes ?? [];

  // Agregados ────────────────────────────────────────────────────────────────
  const totalReach = playlists.reduce((s, p) => s + (p.seguidores ?? 0), 0);
  const artists: ArtistAgg[] = (() => {
    const map = new Map<string, ArtistAgg>();
    for (const t of tracks) {
      const key = (t.artista || "—").trim();
      if (!key) continue;
      const cur = map.get(key) ?? { artista: key, faixas: 0, aparicoes: 0 };
      cur.faixas += 1;
      cur.aparicoes += t.count ?? 0;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.aparicoes - a.aparicoes);
  })();

  if (loading) return <SkeletonGrid />;
  if (!model) return <Empty msg="Sem dados de base." />;

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <BaseKpi label="Playlists" value={formatNumber(playlists.length)} hint="na base do modelo" />
        <BaseKpi label="Alcance total" value={formatNumber(totalReach)} hint="seguidores somados" tone="primary" />
        <BaseKpi label="Faixas únicas" value={formatNumber(tracks.length)} hint="recorrentes" />
        <BaseKpi label="Artistas únicos" value={formatNumber(artists.length)} hint="entre as faixas" />
      </div>

      <Tabs defaultValue="playlists" className="space-y-4">
        <TabsList className="bg-elevated border border-border h-9 p-1 nx-tabs-scroll max-w-full">
          <TabsTrigger value="playlists" className="text-xs h-7 data-[state=active]:bg-card shrink-0 whitespace-nowrap">
            Playlists ({playlists.length})
          </TabsTrigger>
          <TabsTrigger value="faixas" className="text-xs h-7 data-[state=active]:bg-card shrink-0 whitespace-nowrap">
            Faixas ({tracks.length})
          </TabsTrigger>
          <TabsTrigger value="artistas" className="text-xs h-7 data-[state=active]:bg-card shrink-0 whitespace-nowrap">
            Artistas ({artists.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="playlists" className="mt-0">
          <BasePlaylistsTab playlists={playlists} />
        </TabsContent>
        <TabsContent value="faixas" className="mt-0">
          <BaseTracksTab tracks={tracks} totalPlaylists={playlists.length} />
        </TabsContent>
        <TabsContent value="artistas" className="mt-0">
          <BaseArtistsTab artists={artists} totalTracks={tracks.length} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BaseKpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "primary" }) {
  return (
    <div className="nx-card p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">{label}</div>
      <div className={cn("text-xl font-bold tabular-nums mt-1", tone === "primary" && "text-primary")}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

/* ───── Sub-aba: Playlists ───── */
function BasePlaylistsTab({ playlists }: { playlists: BasePlaylist[] }) {
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<"all" | "mega" | "big" | "medio" | "small">("all");
  const [sort, setSort] = useState<"followers" | "alpha" | "tracks">("followers");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let arr = playlists.slice();
    if (term) arr = arr.filter(p => (p.nome ?? "").toLowerCase().includes(term));
    if (tier !== "all") arr = arr.filter(p => classifyTier(p.seguidores) === tier);
    arr.sort((a, b) => {
      if (sort === "alpha") return (a.nome ?? "").localeCompare(b.nome ?? "");
      if (sort === "tracks") return (b.total_musicas ?? 0) - (a.total_musicas ?? 0);
      return (b.seguidores ?? 0) - (a.seguidores ?? 0);
    });
    return arr;
  }, [playlists, q, tier, sort]);

  const pg = usePagination<BasePlaylist>(filtered, 20, `${q}-${tier}-${sort}`);

  return (
    <div className="space-y-3">
      <BaseToolbar
        q={q} setQ={setQ}
        placeholder="Buscar playlist…"
        leftExtra={
          <SegmentedFilter
            value={tier}
            onChange={(v) => setTier(v as any)}
            options={[
              { v: "all",   label: `Todas` },
              { v: "mega",  label: `Mega` },
              { v: "big",   label: `Big` },
              { v: "medio", label: `Médio` },
              { v: "small", label: `Small` },
            ]}
          />
        }
        rightExtra={
          <SortDropdown
            value={sort}
            onChange={(v) => setSort(v as any)}
            options={[
              { v: "followers", label: "Mais seguidores" },
              { v: "tracks",    label: "Mais faixas" },
              { v: "alpha",     label: "Alfabético" },
            ]}
          />
        }
      />

      {filtered.length === 0 ? (
        <Empty msg="Nenhuma playlist com esses critérios." />
      ) : (
        <div className="nx-card !p-0 overflow-hidden divide-y divide-border">
          {pg.visibleItems.map((p, i) => {
            const t = classifyTier(p.seguidores);
            const meta = TIER_META[t];
            return (
              <div key={`${p.url}-${i}`} className="flex items-center gap-3 p-3 hover:bg-elevated/50 transition-colors">
                <span className="text-xs text-muted-foreground w-7 text-right tabular-nums shrink-0">{i + 1}</span>
                {p.imagem ? (
                  <img src={p.imagem} alt="" loading="lazy" className="h-11 w-11 rounded-md object-cover border border-border shrink-0" />
                ) : (
                  <div className="h-11 w-11 rounded-md bg-elevated border border-border flex items-center justify-center shrink-0">
                    <ListMusic className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.nome}</div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                    <span className={cn("inline-flex items-center px-1.5 h-4 rounded border text-[9px] font-bold uppercase", meta.cls)}>
                      {meta.label}
                    </span>
                    <span className="tabular-nums">{formatNumber(p.seguidores ?? 0)} seguidores</span>
                    {p.total_musicas != null && (
                      <span className="tabular-nums">· {p.total_musicas} faixas</span>
                    )}
                  </div>
                </div>
                {p.url && (
                  <a href={p.url} target="_blank" rel="noreferrer"
                     className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-elevated"
                     title="Abrir no Spotify">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      <LoadMore visible={pg.visible} total={pg.total} hasMore={pg.hasMore} canCollapse={pg.canCollapse} onLoadMore={pg.loadMore} onCollapse={pg.collapse} itemLabel="playlists" />
    </div>
  );
}

/* ───── Sub-aba: Faixas ───── */
function BaseTracksTab({ tracks, totalPlaylists }: { tracks: BaseTrack[]; totalPlaylists: number }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"count" | "alpha" | "artist">("count");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let arr = tracks.slice();
    if (term) arr = arr.filter(t => (t.nome + " " + t.artista).toLowerCase().includes(term));
    arr.sort((a, b) => {
      if (sort === "alpha") return (a.nome ?? "").localeCompare(b.nome ?? "");
      if (sort === "artist") return (a.artista ?? "").localeCompare(b.artista ?? "");
      return (b.count ?? 0) - (a.count ?? 0);
    });
    return arr;
  }, [tracks, q, sort]);

  const pg = usePagination<BaseTrack>(filtered, 25, `${q}-${sort}`);

  return (
    <div className="space-y-3">
      <BaseToolbar
        q={q} setQ={setQ}
        placeholder="Buscar faixa ou artista…"
        rightExtra={
          <SortDropdown
            value={sort}
            onChange={(v) => setSort(v as any)}
            options={[
              { v: "count",  label: "Mais recorrente" },
              { v: "alpha",  label: "Faixa A–Z" },
              { v: "artist", label: "Artista A–Z" },
            ]}
          />
        }
      />

      {filtered.length === 0 ? (
        <Empty msg="Nenhuma faixa com esses critérios." />
      ) : (
        <div className="nx-card !p-0 overflow-hidden divide-y divide-border">
          {pg.visibleItems.map((t, i) => {
            const pct = totalPlaylists > 0 ? Math.round(((t.count ?? 0) / totalPlaylists) * 100) : 0;
            return (
              <div key={`${t.nome}-${t.artista}-${i}`} className="flex items-center gap-3 p-3 hover:bg-elevated/50 transition-colors">
                <span className="text-xs text-muted-foreground w-7 text-right tabular-nums shrink-0">{i + 1}</span>
                <div className="h-9 w-9 rounded bg-elevated border border-border flex items-center justify-center shrink-0">
                  <Music2 className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{t.nome}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{t.artista}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-mono text-primary tabular-nums">×{t.count}</div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">{pct}% das playlists</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <LoadMore visible={pg.visible} total={pg.total} hasMore={pg.hasMore} canCollapse={pg.canCollapse} onLoadMore={pg.loadMore} onCollapse={pg.collapse} itemLabel="faixas" />
    </div>
  );
}

/* ───── Sub-aba: Artistas ───── */
function BaseArtistsTab({ artists, totalTracks }: { artists: ArtistAgg[]; totalTracks: number }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"aparicoes" | "faixas" | "alpha">("aparicoes");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let arr = artists.slice();
    if (term) arr = arr.filter(a => a.artista.toLowerCase().includes(term));
    arr.sort((a, b) => {
      if (sort === "alpha") return a.artista.localeCompare(b.artista);
      if (sort === "faixas") return b.faixas - a.faixas;
      return b.aparicoes - a.aparicoes;
    });
    return arr;
  }, [artists, q, sort]);

  const pg = usePagination<ArtistAgg>(filtered, 20, `${q}-${sort}`);
  const maxAp = filtered[0]?.aparicoes ?? 1;

  return (
    <div className="space-y-3">
      <BaseToolbar
        q={q} setQ={setQ}
        placeholder="Buscar artista…"
        rightExtra={
          <SortDropdown
            value={sort}
            onChange={(v) => setSort(v as any)}
            options={[
              { v: "aparicoes", label: "Mais aparições" },
              { v: "faixas",    label: "Mais faixas" },
              { v: "alpha",     label: "Alfabético" },
            ]}
          />
        }
      />

      {filtered.length === 0 ? (
        <Empty msg="Nenhum artista com esse termo." />
      ) : (
        <div className="nx-card !p-0 overflow-hidden divide-y divide-border">
          {pg.visibleItems.map((a, i) => {
            const pctFaixas = totalTracks > 0 ? Math.round((a.faixas / totalTracks) * 100) : 0;
            const barPct = Math.max(4, Math.round((a.aparicoes / maxAp) * 100));
            return (
              <div key={a.artista} className="flex items-center gap-3 p-3 hover:bg-elevated/50 transition-colors">
                <span className="text-xs text-muted-foreground w-7 text-right tabular-nums shrink-0">{i + 1}</span>
                <div className="h-9 w-9 rounded-full bg-elevated border border-border flex items-center justify-center shrink-0 text-[11px] font-bold uppercase text-muted-foreground">
                  {a.artista.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{a.artista}</div>
                  <div className="mt-1 h-1 bg-elevated rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${barPct}%` }} />
                  </div>
                </div>
                <div className="text-right shrink-0 min-w-[110px]">
                  <div className="text-xs font-mono tabular-nums">
                    <span className="text-primary">{a.faixas}</span>
                    <span className="text-muted-foreground"> faixa{a.faixas !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    {a.aparicoes} aparições · {pctFaixas}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <LoadMore visible={pg.visible} total={pg.total} hasMore={pg.hasMore} canCollapse={pg.canCollapse} onLoadMore={pg.loadMore} onCollapse={pg.collapse} itemLabel="artistas" />
    </div>
  );
}

/* ───── Helpers compartilhados ───── */
function BaseToolbar({
  q, setQ, placeholder, leftExtra, rightExtra,
}: {
  q: string; setQ: (v: string) => void; placeholder: string;
  leftExtra?: React.ReactNode; rightExtra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="w-full h-9 pl-8 pr-8 rounded-md bg-elevated border border-border text-xs placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40"
        />
        {q && (
          <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {leftExtra}
      {rightExtra}
    </div>
  );
}

function SegmentedFilter({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: { v: string; label: string }[] }) {
  return (
    <div className="flex items-center bg-elevated border border-border rounded-md p-0.5 h-9">
      {options.map(o => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cn(
            "px-2.5 h-8 rounded text-[11px] font-medium transition-colors",
            value === o.v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SortDropdown({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: { v: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 px-2.5 rounded-md bg-elevated border border-border text-xs text-foreground focus:outline-none focus:border-foreground/40 cursor-pointer"
    >
      {options.map(o => (
        <option key={o.v} value={o.v}>{o.label}</option>
      ))}
    </select>
  );
}
