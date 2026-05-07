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
    <section
      style={genreStyleVars(slug)}
      className="nx-card p-4 md:p-5 relative overflow-hidden"
    >
      {/* glow lateral sutil */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 0% 50%, hsl(var(--g)) 0%, transparent 60%)",
        }}
      />

      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        {/* Esquerda: dot + dropdown de gênero + chip de status */}
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ background: `hsl(var(--g))`, boxShadow: `0 0 10px hsl(var(--g)/0.6)` }}
          />
          <Select value={activeSlug} onValueChange={onPick}>
            <SelectTrigger
              className="h-9 w-auto min-w-[200px] max-w-[300px] rounded-full bg-card/60 border-border text-sm font-bold capitalize"
              aria-label="Trocar gênero"
            >
              <SelectValue placeholder="Selecionar gênero" />
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

          {/* chip de saúde — só aparece se crítico */}
          {needsAttention && (
            <span
              className="hidden md:inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full bg-warning/15 text-warning shrink-0"
              title={reason ? humanizeAttentionReason(reason) : "Requer atenção"}
            >
              <AlertTriangle className="h-3 w-3" />
              Atenção
            </span>
          )}
        </div>

        {/* Direita: 4 KPIs compactos */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-2 md:gap-x-6">
          <Kpi icon={ListMusic} label="Playlists" value={formatNumber(genre?.total_playlists)} />
          <Kpi icon={Music2} label="Faixas" value={formatNumber(genre?.total_musicas)} />
          <Kpi
            icon={TrendingUp}
            label="Termos"
            value={formatNumber(genre?.total_termos)}
          />
          <Kpi
            icon={Clock}
            label="Análise"
            value={lastAnalysis ? timeAgo(lastAnalysis) : "—"}
            small
          />
        </div>
      </div>

      {/* mensagem de atenção em mobile (chip está oculto lá) */}
      {needsAttention && reason && (
        <p className="relative md:hidden text-[11px] text-warning/90 mt-3 leading-snug">
          <AlertTriangle className="inline h-3 w-3 mr-1" />
          {humanizeAttentionReason(reason)}
        </p>
      )}
    </section>
  );
}

function Kpi({
  icon: Icon, label, value, small = false,
}: { icon: any; label: string; value: string; small?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground/80 font-medium leading-none">
          {label}
        </div>
        <div className={cn("font-bold tabular-nums leading-tight mt-0.5", small ? "text-xs" : "text-base")}>
          {value}
        </div>
      </div>
    </div>
  );
}
