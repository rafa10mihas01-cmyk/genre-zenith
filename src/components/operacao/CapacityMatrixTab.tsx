import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCompact } from "@/lib/format";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

/**
 * Matriz de capacidade por gênero.
 * Lê de `genre_capacity_matrix` (recalculada via cron diário + edge function
 * `refresh-genre-capacity-matrix`).
 *
 * Multiplicador personalizado é aplicado em runtime — escala linearmente a partir
 * do valor base armazenado (×30), sem nova query.
 */

type Row = {
  genre_id: string;
  genre_name: string;
  position: number;
  total_followers: number;
  plays_per_day_x18: number;
  plays_per_day_x30: number;
  plays_per_day_x50: number;
  playlist_count: number;
};

type MultMode = "18" | "30" | "50" | "custom";

export function CapacityMatrixTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [genreId, setGenreId] = useState<string | null>(null);
  const [mult, setMult] = useState<MultMode>("30");
  const [customMult, setCustomMult] = useState<number>(30);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("genre_capacity_matrix")
        .select("genre_id, genre_name, position, total_followers, plays_per_day_x18, plays_per_day_x30, plays_per_day_x50, playlist_count")
        .order("genre_name", { ascending: true })
        .order("position", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("[CapacityMatrixTab] load error", error);
      }
      const list = (data ?? []) as Row[];
      setRows(list);
      if (!genreId && list.length) {
        setGenreId(list[0].genre_id);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const genres = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.genre_id, r.genre_name);
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [rows]);

  const effectiveMult = mult === "custom"
    ? Math.max(1, Math.min(200, Number.isFinite(customMult) ? customMult : 30))
    : Number(mult);

  const genreRows = useMemo(
    () => rows.filter(r => r.genre_id === genreId).sort((a, b) => a.position - b.position),
    [rows, genreId],
  );

  const selectedGenreName = genres.find(g => g.id === genreId)?.name ?? "Selecione um gênero";

  /** Plays/dia para a linha aplicando o multiplicador efetivo (escala linear vs ×30). */
  const playsForRow = (r: Row) => Math.round(r.plays_per_day_x30 * (effectiveMult / 30));

  const totals = useMemo(() => {
    let plays = 0;
    let followers = 0;
    let playlists = 0;
    for (const r of genreRows) {
      plays += playsForRow(r);
      // followers e contagem são iguais por linha do mesmo gênero — pego do primeiro
    }
    if (genreRows[0]) {
      followers = genreRows[0].total_followers;
      playlists = genreRows[0].playlist_count;
    }
    return { plays, followers, playlists };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genreRows, effectiveMult]);

  return (
    <div className="space-y-4">
      {/* Controles */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Gênero</label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-9 min-w-[200px] rounded-md border border-border bg-elevated px-3 text-sm text-left flex items-center justify-between gap-2 hover:border-foreground/25">
                <span className="truncate">{selectedGenreName}</span>
                <ChevronDown className="h-4 w-4 opacity-60 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-[60vh] overflow-y-auto w-[260px]">
              {genres.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">Sem dados</div>
              )}
              {genres.map(g => (
                <DropdownMenuItem
                  key={g.id}
                  onClick={() => setGenreId(g.id)}
                  className={cn("text-sm", g.id === genreId && "bg-primary/10 text-primary")}
                >
                  {g.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Multiplicador</label>
          <div className="flex items-center gap-1.5">
            {(["18", "30", "50"] as const).map(m => (
              <button
                key={m}
                onClick={() => setMult(m)}
                className={cn(
                  "h-9 px-3 rounded-md text-xs font-medium border tabular-nums transition-colors",
                  mult === m
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-elevated border-border text-muted-foreground hover:text-foreground",
                )}
              >×{m}</button>
            ))}
            <button
              onClick={() => setMult("custom")}
              className={cn(
                "h-9 px-3 rounded-md text-xs font-medium border transition-colors",
                mult === "custom"
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "bg-elevated border-border text-muted-foreground hover:text-foreground",
              )}
            >Personalizado</button>
            {mult === "custom" && (
              <Input
                type="number"
                min={1}
                max={200}
                value={customMult}
                onChange={(e) => setCustomMult(Number(e.target.value))}
                className="h-9 w-20 tabular-nums"
              />
            )}
          </div>
        </div>
      </div>

      {/* Header sumário */}
      {!loading && genreRows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="nx-card">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Playlists</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{totals.playlists}</div>
          </div>
          <div className="nx-card">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Seguidores totais</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{formatCompact(totals.followers)}</div>
          </div>
          <div className="nx-card">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Multiplicador atual</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">×{effectiveMult}</div>
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="nx-card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-elevated/50 border-b border-border">
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Posição</th>
                <th className="px-4 py-3 font-medium">Playlists</th>
                <th className="px-4 py-3 font-medium">Seguidores totais</th>
                <th className="px-4 py-3 font-medium text-right">Plays/dia</th>
                <th className="px-4 py-3 font-medium text-right">Plays/mês</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="px-4 py-3"><Skeleton className="h-4 w-8" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-10" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-16 ml-auto" /></td>
                  </tr>
                ))
              )}
              {!loading && genreRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {genres.length === 0 ? "Matriz ainda não foi calculada — aguarde o próximo ciclo de recálculo." : "Selecione um gênero."}
                  </td>
                </tr>
              )}
              {!loading && genreRows.map((r) => {
                const playsDay = playsForRow(r);
                const playsMonth = playsDay * 30;
                return (
                  <tr key={r.position} className="border-b border-border hover:bg-elevated/40">
                    <td className="px-4 py-3 font-medium">#{r.position}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.playlist_count}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatCompact(r.total_followers)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCompact(playsDay)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{formatCompact(playsMonth)}</td>
                  </tr>
                );
              })}
            </tbody>
            {!loading && genreRows.length > 0 && (
              <tfoot className="bg-elevated/50 border-t-2 border-border">
                <tr className="font-semibold">
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-muted-foreground">{totals.playlists}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatCompact(totals.followers)}</td>
                  <td className="px-4 py-3 text-right">{formatCompact(totals.plays)}</td>
                  <td className="px-4 py-3 text-right">{formatCompact(totals.plays * 30)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Plays/dia = seguidores × (multiplicador ÷ 30) × peso da posição. Pesos: #1 12%, #2 10%, #3 8%, #4 7%, #5 6%, #6 5%, #7 4,5%, #8 4%, #9 3,5%, #10 3%, #11–15 2,5%.
        Multiplicador personalizado escala linearmente sem nova consulta.
      </p>
    </div>
  );
}
