import { useEffect, useMemo, useState } from "react";
import { Search, AlertCircle, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { computeSeoScore, scoreTone, SEO_MAX, type SeoInput, type SeoResult } from "@/lib/seoScore";

type Row = SeoInput & {
  template_id: string;
  spotify_url: string | null;
  result: SeoResult;
};

/**
 * Painel de SEO Score por playlist (publicadas).
 * Lê playlist_templates onde spotify_playlist_id is not null.
 */
export function SeoScorePanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Row | null>(null);
  const [filter, setFilter] = useState<"all" | "low" | "mid" | "high">("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("playlist_templates")
        .select("id, name, description, cover_image_url, cover_generated_at, tracks_added, spotify_url, spotify_playlist_id")
        .not("spotify_playlist_id", "is", null)
        .order("created_on_spotify_at", { ascending: false })
        .limit(500);
      const computed: Row[] = (data ?? []).map((r: any) => {
        const input: SeoInput = {
          name: r.name,
          description: r.description,
          cover_image_url: r.cover_image_url,
          cover_generated_at: r.cover_generated_at,
          tracks_added: r.tracks_added,
        };
        return {
          ...input,
          template_id: r.id,
          spotify_url: r.spotify_url,
          result: computeSeoScore(input),
        };
      });
      setRows(computed);
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    if (rows.length === 0) return { avg: 0, low: 0, mid: 0, high: 0 };
    const avg = Math.round(rows.reduce((s, r) => s + r.result.score, 0) / rows.length);
    return {
      avg,
      low: rows.filter(r => r.result.score < 50).length,
      mid: rows.filter(r => r.result.score >= 50 && r.result.score < 75).length,
      high: rows.filter(r => r.result.score >= 75).length,
    };
  }, [rows]);

  const visible = useMemo(() => {
    const arr = [...rows].sort((a, b) => a.result.score - b.result.score);
    if (filter === "low") return arr.filter(r => r.result.score < 50);
    if (filter === "mid") return arr.filter(r => r.result.score >= 50 && r.result.score < 75);
    if (filter === "high") return arr.filter(r => r.result.score >= 75);
    return arr;
  }, [rows, filter]);

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            SEO Score
          </span>
        </div>
        {!loading && rows.length > 0 && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-muted-foreground">Média</span>
            <span className={cn("font-bold tabular-nums text-sm", toneClass(stats.avg))}>
              {stats.avg}
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-40 rounded-md bg-muted/40 animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-8 text-center">
          Nenhuma playlist publicada ainda.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <FilterChip label="Crítico" value={stats.low} active={filter === "low"} tone="destructive" onClick={() => setFilter(filter === "low" ? "all" : "low")} />
            <FilterChip label="Médio" value={stats.mid} active={filter === "mid"} tone="warning" onClick={() => setFilter(filter === "mid" ? "all" : "mid")} />
            <FilterChip label="Bom" value={stats.high} active={filter === "high"} tone="success" onClick={() => setFilter(filter === "high" ? "all" : "high")} />
          </div>

          <ul className="divide-y divide-border max-h-[420px] overflow-auto">
            {visible.slice(0, 50).map(r => (
              <li key={r.template_id}>
                <button
                  onClick={() => setOpen(r)}
                  className="w-full flex items-center gap-3 py-2.5 px-1 text-left hover:bg-muted/30 rounded-md transition-colors group"
                >
                  <ScoreBadge score={r.result.score} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate leading-tight">{r.name || "Sem nome"}</div>
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {r.result.issues.length > 0
                        ? `${r.result.issues.length} ponto${r.result.issues.length > 1 ? "s" : ""} a melhorar`
                        : "Sem problemas detectados"}
                    </div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Sheet open={!!open} onOpenChange={v => !v && setOpen(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-auto">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base">{open.name || "Sem nome"}</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-5">
                <div className="flex items-center gap-4">
                  <ScoreBadge score={open.result.score} large />
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Score atual</div>
                    <div className={cn("text-xs font-semibold mt-0.5", toneClass(open.result.score))}>
                      {open.result.score >= 75 ? "Bom" : open.result.score >= 50 ? "Médio" : "Crítico"}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <BarRow label="Nome" value={open.result.breakdown.name} max={SEO_MAX.name} />
                  <BarRow label="Descrição" value={open.result.breakdown.description} max={SEO_MAX.description} />
                  <BarRow label="Capa" value={open.result.breakdown.cover} max={SEO_MAX.cover} />
                  <BarRow label="Faixas" value={open.result.breakdown.tracks} max={SEO_MAX.tracks} />
                </div>

                {open.result.issues.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                      Pontos a melhorar
                    </div>
                    <ul className="space-y-1.5">
                      {open.result.issues.map((i, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-xs">
                          <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                          <span>{i}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {open.spotify_url && (
                  <Button asChild variant="outline" size="sm" className="w-full">
                    <a href={open.spotify_url} target="_blank" rel="noreferrer">
                      Abrir no Spotify
                    </a>
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function toneClass(s: number) {
  const t = scoreTone(s);
  return t === "success" ? "text-success" : t === "warning" ? "text-warning" : "text-destructive";
}

function ScoreBadge({ score, large = false }: { score: number; large?: boolean }) {
  return (
    <div className={cn(
      "rounded-full flex items-center justify-center font-bold tabular-nums shrink-0 border",
      large ? "h-14 w-14 text-lg" : "h-9 w-9 text-xs",
      scoreTone(score) === "success" && "bg-success/15 text-success border-success/30",
      scoreTone(score) === "warning" && "bg-warning/15 text-warning border-warning/30",
      scoreTone(score) === "destructive" && "bg-destructive/15 text-destructive border-destructive/30",
    )}>
      {score}
    </div>
  );
}

function FilterChip({
  label, value, active, tone, onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  tone: "destructive" | "warning" | "success";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl px-3 py-2 text-left border transition-colors",
        active
          ? tone === "success" ? "border-success/40 bg-success/10"
            : tone === "warning" ? "border-warning/40 bg-warning/10"
            : "border-destructive/40 bg-destructive/10"
          : "border-border bg-card hover:bg-muted/40",
      )}
    >
      <div className={cn(
        "text-base font-bold tabular-nums leading-none",
        tone === "success" && "text-success",
        tone === "warning" && "text-warning",
        tone === "destructive" && "text-destructive",
      )}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{label}</div>
    </button>
  );
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-semibold">{value}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full transition-all",
            pct >= 75 ? "bg-success" : pct >= 50 ? "bg-warning" : "bg-destructive",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
