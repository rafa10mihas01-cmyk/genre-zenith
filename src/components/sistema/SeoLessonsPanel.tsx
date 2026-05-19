import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, FlaskConical, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSeoLessons } from "@/hooks/useSeoExperiments";

export function SeoLessonsPanel() {
  const [genreId, setGenreId] = useState<string | null>(null);
  const { data: genres } = useQuery({
    queryKey: ["genres_lite"],
    queryFn: async () => {
      const { data } = await supabase.from("genres").select("id, nome").order("nome");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
  const { data: lessons, isLoading } = useSeoLessons(genreId);

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Cérebro SEO por nicho</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Padrões editoriais testados em playlists. Quanto mais amostras, maior a confiança.
          </p>
        </div>
        <Select value={genreId ?? "all"} onValueChange={(v) => setGenreId(v === "all" ? null : v)}>
          <SelectTrigger className="w-[200px] h-8 text-xs">
            <SelectValue placeholder="Todos os nichos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os nichos</SelectItem>
            {(genres ?? []).map((g) => (
              <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 grid place-items-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !lessons || lessons.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma lição ainda. Rode experimentos nas playlists pra começar a alimentar o cérebro.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-elevated text-muted-foreground">
              <tr>
                <th className="text-left p-2.5 font-semibold">Padrão</th>
                <th className="text-left p-2.5 font-semibold">Campo</th>
                <th className="text-right p-2.5 font-semibold">Amostras</th>
                <th className="text-right p-2.5 font-semibold">% positivo</th>
                <th className="text-right p-2.5 font-semibold">Δ médio</th>
                <th className="text-right p-2.5 font-semibold">Confiança</th>
              </tr>
            </thead>
            <tbody>
              {lessons.map((l) => {
                const total = l.samples_count || 1;
                const posPct = (l.positive_count / total) * 100;
                const delta = Number(l.avg_delta_pct ?? 0);
                const positive = delta >= 0;
                const Icon = positive ? TrendingUp : TrendingDown;
                const tone = positive ? "text-primary" : "text-destructive";
                return (
                  <tr key={l.id} className="border-t border-border/60 hover:bg-elevated/30">
                    <td className="p-2.5">
                      <div className="font-medium text-foreground">{l.pattern_label}</div>
                      <div className="text-[10px] text-muted-foreground">{l.pattern_key}</div>
                    </td>
                    <td className="p-2.5">
                      <Badge variant="outline" className="text-[10px] capitalize">{l.field}</Badge>
                    </td>
                    <td className="p-2.5 text-right tabular-nums">{l.samples_count}</td>
                    <td className="p-2.5 text-right tabular-nums">{posPct.toFixed(0)}%</td>
                    <td className={`p-2.5 text-right tabular-nums font-semibold ${tone}`}>
                      <span className="inline-flex items-center gap-1">
                        <Icon className="h-3 w-3" />
                        {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
                      </span>
                    </td>
                    <td className="p-2.5 text-right tabular-nums">
                      {((l.confidence ?? 0) * 100).toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
