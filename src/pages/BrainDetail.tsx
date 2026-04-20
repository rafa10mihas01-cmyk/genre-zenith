import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Sparkles, RefreshCw, Loader2, ChevronDown, ChevronUp, Flame, Music2, Palette, FileText, Hash, BarChart3, Image as ImageIcon, Users, ExternalLink } from "lucide-react";
import { useBrainModel } from "@/hooks/useBrainModel";
import { useBriefings, PlaylistBriefing } from "@/hooks/useBriefings";
import { formatDate, timeAgo } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/cc/PageHeader";
import { HeroCard } from "@/components/cc/HeroCard";
import { PageContainer } from "@/components/cc/PageContainer";

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

const NICHO_LABELS: Record<string, string> = { funk: "Funk", sertanejo: "Sertanejo", piseiro: "Piseiro" };

function SignalBadge({ sinal }: { sinal: string }) {
  const config = sinal === "crescimento"
    ? { label: "Crescimento", cls: "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] border-[hsl(var(--success))]/30" }
    : sinal === "novo"
    ? { label: "Novo", cls: "bg-primary/15 text-primary border-primary/30" }
    : { label: "Estável", cls: "bg-muted text-muted-foreground border-border" };
  return <Badge variant="outline" className={cn("text-[10px] uppercase", config.cls)}>{config.label}</Badge>;
}

function ConfidenceBadge({ confidence }: { confidence: "alta" | "media" | "baixa" }) {
  const config = confidence === "alta"
    ? { label: "Alta confiança", cls: "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] border-[hsl(var(--success))]/30" }
    : confidence === "media"
    ? { label: "Média confiança", cls: "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30" }
    : { label: "⚠ Baixa confiança", cls: "bg-destructive/10 text-destructive border-destructive/30" };
  return <Badge variant="outline" className={cn("text-[10px] uppercase", config.cls)}>{config.label}</Badge>;
}

function ForceBar({ value }: { value: number }) {
  const color = value >= 70 ? "bg-[hsl(var(--success))]" : value >= 40 ? "bg-[hsl(var(--warning))]" : "bg-muted-foreground";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-mono tabular-nums">{value}%</span>
    </div>
  );
}

function PlaylistCard({ briefing, index, onExpand, expanded }: {
  briefing: PlaylistBriefing; index: number; onExpand: () => void; expanded: boolean;
}) {
  return (
    <div
      className={cn(
        "cc-glass cc-glass-hover cc-glass-md p-4 space-y-3 transition-all cursor-pointer",
        expanded && "cc-glow-indigo"
      )}
      onClick={onExpand}
    >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-mono text-muted-foreground w-5 shrink-0">#{index + 1}</span>
            <h3 className="font-bold text-sm truncate">{briefing.nome}</h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ConfidenceBadge confidence={briefing.confidence ?? "baixa"} />
            {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
        </div>

        {/* Summary row */}
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="secondary" className="text-[10px]">{briefing.formato}</Badge>
          <ForceBar value={briefing.forca_nome} />
          <SignalBadge sinal={briefing.justificativa.sinal} />
          {briefing.metricas && briefing.metricas.media_seguidores > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Users className="h-3 w-3" />
              <span className="font-mono">{formatFollowers(briefing.metricas.media_seguidores)}</span>
              <span>média</span>
            </div>
          )}
        </div>

        {/* Preview sempre visível das referências */}
        {briefing.playlists_referencia && briefing.playlists_referencia.length > 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="flex -space-x-2 shrink-0">
                {briefing.playlists_referencia.slice(0, 3).map((p, i) => (
                  <div key={`${p.nome}-thumb-${i}`} className="h-8 w-8 rounded-md overflow-hidden border border-border bg-muted shrink-0">
                    {p.imagem_url ? (
                      <img
                        src={p.imagem_url}
                        alt={p.nome}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <Music2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="min-w-0 text-[10px] text-muted-foreground truncate">
                {briefing.playlists_referencia.length} refs • {briefing.playlists_referencia[0]?.nome}
              </div>
            </div>

            {briefing.playlists_referencia[0]?.spotify_url && (
              <a
                href={briefing.playlists_referencia[0].spotify_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] text-foreground hover:border-primary/40 hover:bg-muted/70"
              >
                <ExternalLink className="h-3 w-3" />
                Abrir playlist
              </a>
            )}
          </div>
        )}

        {/* Expanded detail */}
        {expanded && (
          <div className="space-y-4 pt-3 border-t border-border animate-in fade-in slide-in-from-top-2 duration-200">
            {/* Playlists de referência (com capa, seguidores, link) */}
            {briefing.playlists_referencia && briefing.playlists_referencia.length > 0 && (
              <Section icon={ImageIcon} title="Playlists de referência">
                <div className="space-y-2">
                  {briefing.playlists_referencia.map((p, i) => (
                    <a
                      key={`${p.nome}-${i}`}
                      href={p.spotify_url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => { if (!p.spotify_url) e.preventDefault(); e.stopPropagation(); }}
                      className={cn(
                        "flex items-center gap-3 p-2 rounded-md border border-border bg-muted/30 transition-colors",
                        p.spotify_url ? "hover:bg-muted/60 hover:border-primary/40" : "opacity-70 cursor-default"
                      )}
                    >
                      {p.imagem_url ? (
                        <img
                          src={p.imagem_url}
                          alt={p.nome}
                          className="h-12 w-12 rounded shrink-0 object-cover border border-border"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded shrink-0 bg-muted flex items-center justify-center">
                          <Music2 className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{p.nome}</div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Users className="h-2.5 w-2.5" />
                          <span className="font-mono tabular-nums">{formatFollowers(p.seguidores)}</span>
                          <span>seguidores</span>
                        </div>
                      </div>
                      {p.spotify_url && (
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                    </a>
                  ))}
                </div>
              </Section>
            )}

            {/* Força do nome */}
            <Section icon={BarChart3} title="Força do nome">
              <div className="space-y-1.5">
                {briefing.keywords_utilizadas.map(k => (
                  <div key={k.value} className="flex items-center justify-between text-xs">
                    <span>"{k.value}"</span>
                    <span className="font-mono text-muted-foreground">{k.peso}%</span>
                  </div>
                ))}
              </div>
            </Section>

            {/* Keywords */}
            <Section icon={Hash} title="Keywords utilizadas">
              <div className="flex flex-wrap gap-1.5">
                {briefing.keywords_utilizadas.map(k => (
                  <Badge key={k.value} variant="secondary" className="text-[10px]">
                    {k.value} <span className="ml-1 opacity-60">{k.peso}%</span>
                  </Badge>
                ))}
              </div>
            </Section>

            {/* Base musical */}
            <Section icon={Music2} title="Base musical">
              <div className="space-y-2">
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground mb-1">Top músicas</p>
                  <div className="space-y-0.5">
                    {briefing.base_musical.top_musicas.map((t, i) => (
                      <div key={i} className="flex gap-2 text-xs">
                        <span className="text-muted-foreground">{i + 1}.</span>
                        <span className="font-medium">{t.nome}</span>
                        <span className="text-muted-foreground">— {t.artista}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground mb-1">Artistas principais</p>
                  <div className="flex flex-wrap gap-1">
                    {briefing.base_musical.artistas_principais.map(a => (
                      <Badge key={a} variant="outline" className="text-[10px]">{a}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            {/* DNA da capa — só mostra se foi extraído via análise visual */}
            {briefing.dna_capa && (
              <Section icon={Palette} title="DNA visual da capa">
                <div className="space-y-3">
                  {/* Cores dominantes */}
                  {briefing.dna_capa.cores_dominantes?.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground mb-1.5">Cores dominantes</p>
                      <div className="flex gap-1.5">
                        {briefing.dna_capa.cores_dominantes.map(c => (
                          <div key={c} className="flex flex-col items-center gap-1">
                            <div
                              className="h-8 w-8 rounded-md border border-border shadow-sm"
                              style={{ backgroundColor: c }}
                              title={c}
                            />
                            <span className="text-[9px] font-mono text-muted-foreground">{c}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Atributos */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div><span className="text-muted-foreground">Estilo:</span> <span className="font-medium">{briefing.dna_capa.estilo_dominante}</span></div>
                    <div><span className="text-muted-foreground">Texto:</span> <span className="font-medium">{briefing.dna_capa.uso_texto}</span></div>
                    <div><span className="text-muted-foreground">Estrutura:</span> <span className="font-medium">{briefing.dna_capa.estrutura_visual}</span></div>
                    <div><span className="text-muted-foreground">Atmosfera:</span> <span className="font-medium">{briefing.dna_capa.atmosfera}</span></div>
                  </div>

                  {/* Recomendação */}
                  {briefing.dna_capa.recomendacao_criacao && (
                    <div className="text-xs p-2.5 rounded-md bg-primary/5 border border-primary/15">
                      <span className="text-[10px] uppercase text-primary font-semibold">Recomendação</span>
                      <p className="mt-0.5 text-foreground/85">{briefing.dna_capa.recomendacao_criacao}</p>
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* Justificativa */}
            <Section icon={FileText} title="Justificativa">
              <div className="text-xs leading-relaxed text-muted-foreground space-y-1">
                <p>
                  Esse formato aparece em <span className="text-foreground font-medium">{briefing.justificativa.frequencia_padrao_pct}%</span> dos padrões analisados,
                  com <span className="text-foreground font-medium">{briefing.justificativa.repeticao_em_playlists}</span> repetições em playlists de referência.
                </p>
                <p>
                  Score: <span className="text-foreground font-mono font-medium">{briefing.justificativa.score}</span> •
                  Sinal: <span className="text-foreground font-medium capitalize">{briefing.justificativa.sinal}</span>
                </p>
              </div>
            </Section>
          </div>
        )}
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  );
}

export default function BrainDetail() {
  const { slug = "" } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { loading: loadingModel, genre, model, reload: reloadModel } = useBrainModel(slug);
  const {
    loading: loadingBriefing, briefing, generating, regenerate,
    reload: reloadBriefing, analyzeVisualDna, analyzingDna,
    clusters, loadingClusters, selectedClusterId, selectCluster,
  } = useBriefings(genre?.id);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const loading = loadingModel || loadingBriefing;
  const hasBriefing = briefing && Array.isArray(briefing.briefings) && briefing.briefings.length > 0;
  const hasDnaVisual = hasBriefing && briefing.briefings.some(b => b.dna_capa);
  const activeCluster = selectedClusterId ? clusters.find(c => c.id === selectedClusterId) ?? null : null;

  const handleRegenerate = async () => {
    try {
      await regenerate();
      toast.success("Briefing regenerado");
    } catch (e: any) {
      toast.error("Erro ao gerar briefing", { description: e?.message });
    }
  };

  const handleAnalyzeDna = async () => {
    try {
      toast.info("Analisando capas...", { description: "Isso pode levar 10-20s" });
      await analyzeVisualDna();
      toast.success("DNA visual extraído e briefing atualizado");
    } catch (e: any) {
      toast.error("Erro ao analisar DNA visual", { description: e?.message });
    }
  };

  if (!loadingModel && !genre) {
    return (
      <PageContainer size="2xl" className="py-20 text-center space-y-4">
        <h1 className="text-2xl font-bold">Nicho não encontrado</h1>
        <Button asChild variant="outline"><Link to="/"><ChevronLeft className="h-4 w-4" /> Voltar</Link></Button>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="5xl" className="space-y-6">
      <PageHeader
        eyebrow={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" className="h-6 w-6 -ml-1">
              <Link to="/"><ChevronLeft className="h-3.5 w-3.5" /></Link>
            </Button>
            <span>Decisões</span>
            {briefing?.created_at && (
              <Badge variant="outline" className="text-[10px] uppercase">
                v{briefing.version} • {timeAgo(briefing.created_at)}
              </Badge>
            )}
          </div>
        }
        title={genre?.nome ?? NICHO_LABELS[slug] ?? slug}
        subtitle={hasBriefing ? `${briefing.briefings.length} ${briefing.briefings.length === 1 ? "decisão qualificada" : "decisões qualificadas"} de ${briefing.metadata?.total_padroes_analisados ?? 0} padrões analisados.` : undefined}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAnalyzeDna}
              disabled={analyzingDna || generating || !hasBriefing}
              title={hasDnaVisual ? "Re-analisar capas" : "Analisar capas para extrair DNA visual"}
            >
              {analyzingDna ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
              {hasDnaVisual ? "Re-analisar capas" : "Analisar capas"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={generating || analyzingDna}>
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Gerar briefings
            </Button>
            <Button size="sm" onClick={() => navigate(`/?run=${slug}`)}>
              <Sparkles className="h-3.5 w-3.5" /> Nova análise
            </Button>
          </>
        }
      />

      {loading ? (
        <div className="py-20 text-center text-muted-foreground text-sm">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Carregando decisões...
        </div>
      ) : !model ? (
        <HeroCard className="text-center" noOrbs>
          <div className="py-10 space-y-3">
            <div className="text-sm text-muted-foreground">Nenhuma análise salva para este nicho.</div>
            <Button onClick={() => navigate(`/?run=${slug}`)}>
              <Sparkles className="h-4 w-4" /> Rodar primeira análise
            </Button>
          </div>
        </HeroCard>
      ) : !hasBriefing ? (
        <HeroCard className="text-center">
          <div className="py-10 space-y-3">
            <Flame className="h-8 w-8 text-primary mx-auto" />
            <div className="text-sm text-muted-foreground">Análise pronta mas sem briefing gerado ainda.</div>
            <Button onClick={handleRegenerate} disabled={generating}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Gerar playlists agora
            </Button>
          </div>
        </HeroCard>
      ) : (
        <div className="space-y-4">
          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <Flame className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Playlists para criar agora</h2>
              <p className="text-xs text-muted-foreground">
                {briefing.briefings.length} {briefing.briefings.length === 1 ? "decisão qualificada" : "decisões qualificadas"} de {briefing.metadata?.total_padroes_analisados ?? 0} padrões analisados
                {briefing.metadata?.cards_descartados > 0 && ` • ${briefing.metadata.cards_descartados} descartados por baixa qualidade`}
              </p>
            </div>
          </div>

          {/* 10 Cards */}
          <div className="space-y-2">
            {briefing.briefings.map((b: PlaylistBriefing, i: number) => (
              <PlaylistCard
                key={`${b.formato_id}-${i}`}
                briefing={b}
                index={i}
                expanded={expandedIdx === i}
                onExpand={() => setExpandedIdx(expandedIdx === i ? null : i)}
              />
            ))}
          </div>

          {/* Footer meta */}
          <div className="text-center pt-4 pb-8">
            <p className="text-[10px] text-muted-foreground">
              Briefing v{briefing.version} gerado em {formatDate(briefing.created_at)} • 
              Baseado em dados reais — nenhum conceito inventado
            </p>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
