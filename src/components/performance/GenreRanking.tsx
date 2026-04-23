import { Card } from "@/components/ui/card";
import { Trophy } from "lucide-react";
import type { DatasetRow, GenreRow } from "./types";

export function GenreRanking({
  dataset,
  genres,
}: {
  dataset: DatasetRow[];
  genres: GenreRow[];
}) {
  const genreMap = new Map(genres.map(g => [g.id, g.nome]));

  // agrupa por gênero
  const agg = new Map<string, {
    nome: string;
    total: number;
    seguidoresGanhos: number;
    crescendo: number;
    velocidadeSoma: number;
    velocidadeCount: number;
  }>();

  for (const r of dataset) {
    const id = r.genre_id ?? "sem-genero";
    const nome = genreMap.get(r.genre_id ?? "") ?? "Sem gênero";
    const cur = agg.get(id) ?? { nome, total: 0, seguidoresGanhos: 0, crescendo: 0, velocidadeSoma: 0, velocidadeCount: 0 };
    cur.total += 1;
    cur.seguidoresGanhos += r.crescimento_absoluto || 0;
    if ((r.crescimento_absoluto || 0) > 0) cur.crescendo += 1;
    if ((r.tempo_horas ?? 0) > 0) {
      cur.velocidadeSoma += (r.crescimento_absoluto || 0) / ((r.tempo_horas || 1) / 24);
      cur.velocidadeCount += 1;
    }
    agg.set(id, cur);
  }

  const rows = Array.from(agg.values())
    .map(v => ({
      ...v,
      velocidade: v.velocidadeCount > 0 ? v.velocidadeSoma / v.velocidadeCount : 0,
      taxa: v.total > 0 ? (v.crescendo / v.total) * 100 : 0,
    }))
    .sort((a, b) => b.seguidoresGanhos - a.seguidoresGanhos);

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-border flex items-center gap-2">
        <Trophy className="h-4 w-4 text-primary" />
        <h3 className="font-bold text-sm uppercase tracking-wide">Ranking por gênero</h3>
        <span className="text-xs text-muted-foreground ml-auto">{rows.length} {rows.length === 1 ? "gênero" : "gêneros"}</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted-foreground">
          Nenhum gênero com playlists publicadas ainda.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-elevated text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3 w-8">#</th>
                <th className="text-left p-3">Gênero</th>
                <th className="text-right p-3">Publicadas</th>
                <th className="text-right p-3">Seguidores ganhos</th>
                <th className="text-right p-3">Velocidade</th>
                <th className="text-right p-3">Sucesso</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.nome} className="border-t border-border hover:bg-elevated/40">
                  <td className="p-3 text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="p-3 font-medium capitalize">{r.nome}</td>
                  <td className="p-3 text-right tabular-nums">{r.total}</td>
                  <td className={`p-3 text-right tabular-nums font-bold ${r.seguidoresGanhos > 0 ? "text-success" : ""}`}>
                    {r.seguidoresGanhos > 0 ? "+" : ""}{r.seguidoresGanhos.toLocaleString("pt-BR")}
                  </td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">
                    {r.velocidade.toFixed(1)}/dia
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    <span className={r.taxa >= 60 ? "text-success" : r.taxa >= 30 ? "text-warning" : "text-destructive"}>
                      {r.taxa.toFixed(0)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
