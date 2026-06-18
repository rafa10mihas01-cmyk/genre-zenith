import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { Gauge, Search, ExternalLink, TrendingUp, ShieldAlert, Users, Music2 } from "lucide-react";
import { getErrorMessage } from "@/lib/errors";

type Valuation = {
  found: boolean;
  message?: string;
  spotify_playlist_id?: string;
  name?: string;
  cover_url?: string | null;
  followers?: number;
  data_source?: string;
  valuation_score?: number;
  recommendation?: "buy" | "maybe" | "skip";
  estimated_monthly_plays?: number;
  risk_level?: "low" | "medium" | "high";
  growth_potential?: "low" | "medium" | "high";
  factors?: {
    capacity: number; delivery: number; health: number; risk: number;
    activity: number; followers_norm: number; campaigns_count: number;
    fulfillment_rate: number; avg_daily_delivery: number;
  };
  similar_playlists?: Array<{
    id: string; spotify_playlist_id: string; name: string;
    cover_url: string | null; followers: number; valuation_score: number;
  }>;
};

const REC_META: Record<string, { label: string; cls: string; desc: string }> = {
  buy:   { label: "Vale comprar", cls: "bg-primary/15 text-primary border-primary/40", desc: "Score alto, boa relação custo/benefício." },
  maybe: { label: "Avaliar com cuidado", cls: "bg-warning/15 text-warning border-warning/40", desc: "Potencial razoável, valide antes de investir." },
  skip:  { label: "Não recomendado", cls: "bg-destructive/15 text-destructive border-destructive/40", desc: "Score baixo ou risco alto." },
};

function FactorBar({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums font-medium text-foreground">{Math.round(value)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function Valuation() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Valuation | null>(null);

  async function evaluate() {
    if (!url.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.rpc("evaluate_playlist_by_url", { p_url: url.trim() });
      if (error) throw error;
      setResult(data as Valuation);
    } catch (e: unknown) {
      toast({ title: "Erro ao avaliar", description: getErrorMessage(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const rec = result?.recommendation ? REC_META[result.recommendation] : null;

  return (
    <>
      <PageHeader
        domain="system"
        kicker="Inteligência"
        icon={Gauge}
        title="Valuation"
        subtitle="Valor estimado"
      />
      <PageContainer>
        <AnalyticsTabs />
        {/* Input */}
        <div className="nx-card space-y-3">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Link da playlist no Spotify
          </label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://open.spotify.com/playlist/..."
            onKeyDown={(e) => e.key === "Enter" && evaluate()}
            className="h-11 text-center"
          />
          <Button
            onClick={evaluate}
            disabled={loading || !url.trim()}
            className="w-full gap-1.5"
          >
            <Search className="h-4 w-4" /> {loading ? "Avaliando..." : "Avaliar"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Funciona com playlists já presentes no sistema (Minhas Playlists ou biblioteca de curadores).
          </p>
        </div>


        {loading && (
          <div className="nx-card space-y-3">
            <Skeleton className="h-8 w-2/3 bg-muted/40" />
            <Skeleton className="h-4 w-1/2 bg-muted/30" />
            <Skeleton className="h-32 w-full bg-muted/30" />
          </div>
        )}

        {result && !result.found && (
          <div className="nx-card text-center py-10">
            <div className="h-12 w-12 rounded-full bg-elevated border border-border mx-auto flex items-center justify-center">
              <Music2 className="h-5 w-5 text-muted-foreground" />
            </div>
            <h4 className="mt-3 font-semibold">Playlist não encontrada</h4>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              {result.message}
            </p>
          </div>
        )}

        {result?.found && rec && (
          <>
            {/* Header card */}
            <div className="nx-card">
              <div className="flex flex-col md:flex-row gap-5">
                {result.cover_url && (
                  <img src={result.cover_url} alt={result.name} className="h-32 w-32 rounded-lg object-cover shrink-0" />
                )}
                <div className="flex-1 min-w-0 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-2xl font-semibold tracking-tight truncate">{result.name}</h2>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {formatNumber(result.followers ?? 0)} seguidores · {result.data_source === "managed" ? "Sua playlist" : "Biblioteca externa"}
                      </p>
                    </div>
                    <a
                      href={`https://open.spotify.com/playlist/${result.spotify_playlist_id}`}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Abrir no Spotify
                    </a>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <span className={cn("inline-flex items-center px-3 h-8 rounded-full border text-xs font-semibold", rec.cls)}>
                      {rec.label}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-4xl font-bold tabular-nums">{result.valuation_score}</span>
                      <span className="text-xs text-muted-foreground">/ 100</span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{rec.desc}</p>
                </div>
              </div>
            </div>

            {/* KPI tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="nx-card !p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <TrendingUp className="h-3 w-3" /> Plays/mês est.
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatNumber(result.estimated_monthly_plays ?? 0)}
                </div>
              </div>
              <div className="nx-card !p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <ShieldAlert className="h-3 w-3" /> Risco
                </div>
                <div className={cn(
                  "text-2xl font-semibold capitalize",
                  result.risk_level === "low" && "text-primary",
                  result.risk_level === "medium" && "text-warning",
                  result.risk_level === "high" && "text-destructive",
                )}>
                  {result.risk_level === "low" ? "Baixo" : result.risk_level === "medium" ? "Médio" : "Alto"}
                </div>
              </div>
              <div className="nx-card !p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <TrendingUp className="h-3 w-3" /> Potencial
                </div>
                <div className="text-2xl font-semibold capitalize">
                  {result.growth_potential === "high" ? "Alto" : result.growth_potential === "medium" ? "Médio" : "Baixo"}
                </div>
              </div>
              <div className="nx-card !p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Users className="h-3 w-3" /> Seguidores
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatNumber(result.followers ?? 0)}
                </div>
              </div>
            </div>

            {/* Factors breakdown */}
            {result.factors && (
              <div className="nx-card space-y-4">
                <h3 className="font-semibold text-sm">Fatores</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                  <FactorBar label="Capacidade" value={result.factors.capacity} />
                  <FactorBar label="Entrega real" value={result.factors.delivery} />
                  <FactorBar label="Saúde" value={result.factors.health} />
                  <FactorBar label="Seguidores (norm.)" value={result.factors.followers_norm} />
                  <FactorBar label="Confiabilidade (100 - risco)" value={100 - result.factors.risk} />
                  <FactorBar label="Atividade" value={result.factors.activity} />
                </div>
                {result.factors.campaigns_count > 0 && (
                  <div className="pt-3 border-t border-border text-xs text-muted-foreground">
                    Já participou de <strong className="text-foreground">{result.factors.campaigns_count}</strong> campanha(s),
                    cumprindo em média <strong className="text-foreground">{result.factors.fulfillment_rate}%</strong> da meta
                    (~{Math.round(result.factors.avg_daily_delivery)} plays/dia).
                  </div>
                )}
              </div>
            )}

            {/* Similar playlists */}
            {result.similar_playlists && result.similar_playlists.length > 0 && (
              <div className="nx-card space-y-3">
                <h3 className="font-semibold text-sm">Playlists similares</h3>
                <div className="divide-y divide-border">
                  {result.similar_playlists.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 py-2.5">
                      {p.cover_url ? (
                        <img src={p.cover_url} alt="" className="h-10 w-10 rounded object-cover shrink-0" />
                      ) : (
                        <div className="h-10 w-10 rounded bg-elevated shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{formatNumber(p.followers)} seguidores</div>
                      </div>
                      <div className="text-sm font-semibold tabular-nums">{p.valuation_score}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {!loading && !result && (
          <div className="nx-card text-center py-12">
            <div className="h-12 w-12 rounded-full bg-elevated border border-border mx-auto flex items-center justify-center">
              <Gauge className="h-5 w-5 text-muted-foreground" />
            </div>
            <h4 className="mt-3 font-semibold">Cole um link para avaliar</h4>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              O sistema combina capacidade, entrega real, saúde e histórico de campanhas para estimar o valor da playlist.
            </p>
          </div>
        )}
      </PageContainer>
    </>
  );
}
