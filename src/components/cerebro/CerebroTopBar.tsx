import { Link } from "react-router-dom";
import { ListMusic, Music2, TrendingUp, Clock, AlertTriangle, ExternalLink } from "lucide-react";
import { formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { genreStyleVars } from "@/lib/genreColors";
import { humanizeAttentionReason } from "@/components/cerebro/_shared";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type GenreOpt = {
  id: string;
  slug: string;
  nome: string;
  total_playlists?: number | null;
};

/**
 * CerebroTopBar — substitui GenreStrip + GenreHero + HealthBanner + GenrePipeline.
 * Mostra: seletor de gênero compacto + 4 KPIs + chip de saúde (só quando crítico).
 * Foco: caber em uma dobra. Tudo o que for análise vai pra dentro das abas.
 */
export function CerebroTopBar({
  genres,
  activeSlug,
  onPick,
  genre,
  model,
}: {
  genres: GenreOpt[];
  activeSlug: string;
  onPick: (slug: string) => void;
  genre: any;
  model: any;
}) {
  const slug = genre?.slug ?? activeSlug;
  const needsAttention = !!genre?.needs_attention;
  const reason = genre?.attention_reason as string | null;
  const lastAnalysis = model?.ultima_analise;

  return (
    <div style={genreStyleVars(slug)} className="space-y-2">
      <div className="bg-card border border-border/60 rounded-xl p-1 flex flex-col md:flex-row md:items-center shadow-sm hover:border-border transition-colors">
        {/* Genre selector — pílula destacada */}
        <Select value={activeSlug} onValueChange={onPick}>
          <SelectTrigger
            aria-label="Trocar gênero"
            className="h-auto md:min-w-[200px] gap-3 px-4 py-2.5 m-1 bg-muted/40 hover:bg-muted/70 border border-border/40 rounded-lg [&>svg:last-child]:opacity-60"
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: `hsl(var(--g))`, boxShadow: `0 0 8px hsl(var(--g)/0.6)` }}
            />
            <div className="flex flex-col items-start min-w-0 flex-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold leading-tight">
                Gênero
              </span>
              <div className="flex items-center gap-2">
                <span className="text-foreground font-bold text-sm capitalize">
                  {genre?.nome ?? activeSlug}
                </span>
                {genre?.total_playlists != null && (
                  <span className="text-muted-foreground text-xs font-medium tabular-nums">
                    {formatNumber(genre.total_playlists)}
                  </span>
                )}
              </div>
            </div>
          </SelectTrigger>
          <SelectContent className="max-h-[400px]">
            {genres.map((g) => (
              <SelectItem key={g.id} value={g.slug} className="capitalize">
                {g.nome}
                {g.total_playlists != null && (
                  <span className="text-[10px] text-muted-foreground tabular-nums ml-2">
                    {formatNumber(g.total_playlists)}
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Divider */}
        <div className="hidden md:block h-10 w-px bg-border/60 mx-3" />

        {/* KPIs */}
        <div className="flex-1 grid grid-cols-4 items-center px-3 pb-2 md:pb-0 md:px-1">
          <Kpi icon={ListMusic} label="Playlists" value={formatNumber(genre?.total_playlists)} accent />
          <Kpi icon={Music2} label="Faixas" value={formatNumber(genre?.total_musicas)} />
          <Kpi icon={TrendingUp} label="Termos" value={formatNumber(genre?.total_termos)} />
          <Kpi icon={Clock} label="Análise" value={lastAnalysis ? timeAgo(lastAnalysis) : "—"} small />
        </div>

        {needsAttention && (
          <span
            className="hidden md:inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 mr-2 rounded-full bg-warning/15 text-warning shrink-0"
            title={reason ? humanizeAttentionReason(reason) : "Requer atenção"}
          >
            <AlertTriangle className="h-3 w-3" />
            Atenção
          </span>
        )}
      </div>

      {needsAttention && reason && (
        <p className="md:hidden text-[11px] text-warning/90 leading-snug px-1">
          <AlertTriangle className="inline h-3 w-3 mr-1" />
          {humanizeAttentionReason(reason)}
        </p>
      )}
    </div>
  );
}

function Kpi({
  icon: Icon, label, value, small = false, accent = false,
}: { icon: any; label: string; value: string; small?: boolean; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-1">
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", accent ? "text-primary" : "text-muted-foreground")} />
        <span className={cn("font-bold tabular-nums tracking-tight text-foreground", small ? "text-xs whitespace-nowrap" : "text-sm")}>
          {value}
        </span>
      </div>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </span>
    </div>
  );
}
