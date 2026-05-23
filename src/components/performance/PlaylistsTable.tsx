import { useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadMore, usePagination } from "@/components/LoadMore";
import type { DatasetRow, GenreRow } from "./types";

type SortKey = "crescimento" | "percentual" | "velocidade" | "seguidores" | "idade";

export function PlaylistsTable({
  dataset,
  genres,
  altaIds,
  baixaIds,
}: {
  dataset: DatasetRow[];
  genres: GenreRow[];
  altaIds: Set<string>;
  baixaIds: Set<string>;
}) {
  const [query, setQuery] = useState("");
  const [genreFilter, setGenreFilter] = useState<string>("all");
  const [sizeFilter, setSizeFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("crescimento");

  const genreMap = new Map(genres.map(g => [g.id, g.nome]));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dataset.filter(r => {
      if (q && !r.nome.toLowerCase().includes(q)) return false;
      if (genreFilter !== "all" && r.genre_id !== genreFilter) return false;
      if (sizeFilter !== "all") {
        const f = r.followers_now ?? 0;
        if (sizeFilter === "pequena" && !(f < 1000)) return false;
        if (sizeFilter === "media" && !(f >= 1000 && f < 10000)) return false;
        if (sizeFilter === "grande" && !(f >= 10000 && f < 100000)) return false;
        if (sizeFilter === "top" && !(f >= 100000)) return false;
      }
      if (classFilter !== "all") {
        const cls = altaIds.has(r.template_id) ? "alta" : baixaIds.has(r.template_id) ? "baixa" : "media";
        if (cls !== classFilter) return false;
      }
      return true;
    });
  }, [dataset, query, genreFilter, sizeFilter, classFilter, altaIds, baixaIds]);

  const sorted = useMemo(() => {
    const arr = filtered.slice();
    arr.sort((a, b) => {
      switch (sortBy) {
        case "percentual":
          return (b.crescimento_percentual ?? -1) - (a.crescimento_percentual ?? -1);
        case "velocidade": {
          const va = (a.tempo_horas ?? 0) > 0 ? (a.crescimento_absoluto || 0) / ((a.tempo_horas || 1) / 24) : 0;
          const vb = (b.tempo_horas ?? 0) > 0 ? (b.crescimento_absoluto || 0) / ((b.tempo_horas || 1) / 24) : 0;
          return vb - va;
        }
        case "seguidores":
          return b.followers_now - a.followers_now;
        case "idade":
          return (a.tempo_horas ?? 0) - (b.tempo_horas ?? 0);
        case "crescimento":
        default:
          return b.crescimento_absoluto - a.crescimento_absoluto;
      }
    });
    return arr;
  }, [filtered, sortBy]);

  const { visibleItems, hasMore, canCollapse, loadMore, collapse, total, visible } = usePagination(sorted, 20, sorted.length);

  return (
    <div className="space-y-3">
      <Card className="p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar playlist..."
            className="pl-9 h-9"
          />
        </div>
        <Select value={genreFilter} onValueChange={setGenreFilter}>
          <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Gênero" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os gêneros</SelectItem>
            {genres.map(g => (
              <SelectItem key={g.id} value={g.id} className="capitalize">{g.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Classe" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as classes</SelectItem>
            <SelectItem value="alta">Alta performance</SelectItem>
            <SelectItem value="media">Média</SelectItem>
            <SelectItem value="baixa">Baixa performance</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
          <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="crescimento">Maior crescimento</SelectItem>
            <SelectItem value="percentual">Maior % crescimento</SelectItem>
            <SelectItem value="velocidade">Maior velocidade/dia</SelectItem>
            <SelectItem value="seguidores">Mais seguidores</SelectItem>
            <SelectItem value="idade">Mais novas</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-elevated text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3">Playlist</th>
                <th className="text-left p-3">Gênero</th>
                <th className="text-right p-3">Seguidores</th>
                <th className="text-right p-3">Crescimento</th>
                <th className="text-right p-3">%</th>
                <th className="text-right p-3">Velocidade</th>
                <th className="text-right p-3">Idade</th>
                <th className="text-center p-3">Classe</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-xs text-muted-foreground">
                    Nenhuma playlist encontrada com os filtros atuais.
                  </td>
                </tr>
              )}
              {visibleItems.map((r) => {
                const cls = altaIds.has(r.template_id) ? "alta"
                  : baixaIds.has(r.template_id) ? "baixa" : "media";
                const velocidade = (r.tempo_horas ?? 0) > 0
                  ? (r.crescimento_absoluto || 0) / ((r.tempo_horas || 1) / 24)
                  : 0;
                return (
                  <tr key={r.template_id} className="border-t border-border hover:bg-elevated/40">
                    <td className="p-3 font-medium truncate max-w-[260px]">{r.nome}</td>
                    <td className="p-3 text-xs text-muted-foreground capitalize">{genreMap.get(r.genre_id ?? "") ?? "—"}</td>
                    <td className="p-3 text-right tabular-nums">{r.followers_now.toLocaleString("pt-BR")}</td>
                    <td className={`p-3 text-right tabular-nums font-bold ${r.crescimento_absoluto > 0 ? "text-success" : r.crescimento_absoluto < 0 ? "text-destructive" : ""}`}>
                      {r.crescimento_absoluto > 0 ? "+" : ""}{r.crescimento_absoluto.toLocaleString("pt-BR")}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {r.crescimento_percentual != null ? `${r.crescimento_percentual}%` : "—"}
                    </td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground">
                      {velocidade > 0 ? `${velocidade.toFixed(1)}/d` : "—"}
                    </td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground">
                      {r.tempo_horas != null ? formatAge(r.tempo_horas) : "—"}
                    </td>
                    <td className="p-3 text-center">
                      <Badge variant={cls === "alta" ? "default" : cls === "baixa" ? "destructive" : "secondary"} className="text-[10px]">
                        {cls.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      {r.spotify_url && (
                        <a href={r.spotify_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary inline-flex">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <LoadMore visible={visible} total={total} hasMore={hasMore} canCollapse={canCollapse} onLoadMore={loadMore} onCollapse={collapse} itemLabel="playlists" />
    </div>
  );
}

function formatAge(horas: number) {
  if (horas < 24) return `${horas.toFixed(0)}h`;
  const dias = horas / 24;
  if (dias < 30) return `${dias.toFixed(0)}d`;
  return `${(dias / 30).toFixed(1)}m`;
}
