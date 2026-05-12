import { useState } from "react";
import {
  Sparkles, Loader2, ListMusic, Music2, TrendingUp, Hash,
  ExternalLink, Image as ImageIcon, Palette, Wand2, FileText,
  CheckCircle2, AlertTriangle, Quote, Users, Layers, ArrowRight, BarChart3,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Empty, SkeletonGrid } from "@/components/cerebro/_shared";

export function Decisoes({ briefing, loading, onRegenerate, onAnalyzeDna, generating, analyzingDna }: any) {
  const [filter, setFilter] = useState<"todos" | "alta" | "media" | "baixa">("todos");
  const [selected, setSelected] = useState<any | null>(null);

  if (loading) return <SkeletonGrid />;
  const items: any[] = briefing?.briefings ?? [];
  const hasBriefing = items.length > 0;

  const counts = {
    todos: items.length,
    alta: items.filter(b => b.confidence === "alta").length,
    media: items.filter(b => b.confidence === "media").length,
    baixa: items.filter(b => b.confidence === "baixa").length,
  };
  const filtered = filter === "todos" ? items : items.filter(b => b.confidence === filter);

  return (
    <div className="space-y-4">
      {/* Header explicativo + ações em massa */}
      <div className="nx-card p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-base">Briefings de playlist</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Cada briefing é uma <span className="text-foreground">receita pronta de playlist</span> que a IA decidiu
            replicar com base nos padrões do gênero. Clique em um para ver descrição, capa, músicas-base e replicar.
          </p>
          {hasBriefing && (
            <p className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
              v{briefing.version} • {items.length} formatos • atualizado {timeAgo(briefing.created_at)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
          <Button size="sm" variant="outline" onClick={onAnalyzeDna} disabled={analyzingDna || !hasBriefing}>
            {analyzingDna ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
            DNA visual
          </Button>
          <Button size="sm" onClick={onRegenerate} disabled={generating}>
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {hasBriefing ? "Regenerar tudo" : "Gerar briefing"}
          </Button>
        </div>
      </div>

      {!hasBriefing ? (
        <Empty msg="Sem briefings ainda. Clique em 'Gerar briefing' para a IA criar receitas de playlist." />
      ) : (
        <>
          {/* Filtros */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(["todos", "alta", "media", "baixa"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "text-[11px] uppercase font-bold tracking-wider px-3 py-1.5 rounded-full border transition-colors",
                  filter === f
                    ? "bg-primary/15 text-primary border-primary/40"
                    : "bg-elevated/40 text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
                )}
              >
                {f === "todos" ? "Todos" : f} <span className="opacity-60 ml-1">{counts[f]}</span>
              </button>
            ))}
          </div>

          {/* Lista */}
          {filtered.length === 0 ? (
            <Empty msg={`Nenhum briefing com confiança ${filter}.`} />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {filtered.map((b: any, i: number) => (
                <BriefingCard key={i} briefing={b} index={items.indexOf(b)} onOpen={() => setSelected(b)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Painel lateral de detalhe */}
      <BriefingDetail briefing={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function BriefingCard({ briefing: b, index, onOpen }: any) {
  const desc = b.briefing_ai?.descricao;
  const refs = b.metricas?.total_referencias ?? b.playlists_referencia?.length ?? 0;
  const followers = b.metricas?.media_seguidores ?? 0;
  const validation = b.ai_validation?.status;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="nx-card p-4 text-left space-y-3 hover:border-primary/40 hover:bg-elevated/30 transition-colors group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <span className="text-xs font-mono text-muted-foreground mt-0.5">#{index + 1}</span>
          <div className="min-w-0 flex-1">
            <h4 className="font-bold text-sm leading-tight truncate">{b.nome}</h4>
            <p className="text-[11px] text-muted-foreground mt-0.5">{b.formato}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {validation === "incoerente" && (
            <span title="IA marcou como incoerente">
              <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            </span>
          )}
          <span className={cn(
            "text-[10px] uppercase font-bold px-2 py-0.5 rounded-full",
            b.confidence === "alta" ? "bg-primary/15 text-primary"
            : b.confidence === "media" ? "bg-warning/15 text-warning"
            : "bg-muted text-muted-foreground",
          )}>{b.confidence}</span>
        </div>
      </div>

      {desc && (
        <p className="text-xs text-foreground/80 leading-relaxed line-clamp-2">{desc}</p>
      )}

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
        <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" /> {b.forca_nome}%</span>
        <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> {refs} refs</span>
        {followers > 0 && (
          <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {formatNumber(followers)}</span>
        )}
        <span className="ml-auto text-primary opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
          Ver detalhes <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </button>
  );
}

function BriefingDetail({ briefing: b, onClose }: { briefing: any; onClose: () => void }) {
  const open = !!b;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto nx-scroll">
        {b && (
          <>
            <SheetHeader className="text-left space-y-2 pr-6">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-[10px] uppercase font-bold px-2 py-0.5 rounded-full",
                  b.confidence === "alta" ? "bg-primary/15 text-primary"
                  : b.confidence === "media" ? "bg-warning/15 text-warning"
                  : "bg-muted text-muted-foreground",
                )}>{b.confidence}</span>
                <span className="text-[11px] text-muted-foreground">{b.formato}</span>
              </div>
              <SheetTitle className="text-xl leading-tight">{b.nome}</SheetTitle>
              {b.briefing_ai?.descricao && (
                <SheetDescription className="text-sm leading-relaxed text-foreground/80">
                  {b.briefing_ai.descricao}
                </SheetDescription>
              )}
            </SheetHeader>

            <div className="mt-6 space-y-6">
              {/* Validação IA */}
              {b.ai_validation && (
                <div className={cn(
                  "rounded-lg border p-3 flex items-start gap-2.5 text-xs",
                  b.ai_validation.status === "coerente"
                    ? "border-primary/30 bg-primary/5"
                    : "border-warning/30 bg-warning/5",
                )}>
                  {b.ai_validation.status === "coerente"
                    ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    : <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />}
                  <div>
                    <div className="font-bold uppercase tracking-wider text-[10px]">
                      Validação IA: {b.ai_validation.status}
                    </div>
                    <p className="mt-1 text-foreground/85 leading-relaxed">{b.ai_validation.motivo}</p>
                  </div>
                </div>
              )}

              {/* Justificativa */}
              {b.justificativa && (
                <DetailSection icon={BarChart3} title="Por que esse formato?">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Stat label="Frequência padrão" value={`${b.justificativa.frequencia_padrao_pct}%`} />
                    <Stat label="Repetições" value={`${b.justificativa.repeticao_em_playlists}×`} />
                    <Stat label="Score" value={String(b.justificativa.score)} />
                    <Stat label="Sinal" value={b.justificativa.sinal} />
                  </div>
                </DetailSection>
              )}

              {/* DNA visual da capa */}
              {b.dna_capa && (
                <DetailSection icon={Palette} title="DNA visual da capa">
                  <div className="space-y-3">
                    {b.dna_capa.cores_dominantes?.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        {b.dna_capa.cores_dominantes.slice(0, 6).map((c: string, i: number) => (
                          <div
                            key={i}
                            className="h-7 w-7 rounded border border-border"
                            style={{ backgroundColor: c }}
                            title={c}
                          />
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {b.dna_capa.estilo_dominante && <Stat label="Estilo" value={b.dna_capa.estilo_dominante} />}
                      {b.dna_capa.atmosfera && <Stat label="Atmosfera" value={b.dna_capa.atmosfera} />}
                      {b.dna_capa.uso_texto && <Stat label="Uso de texto" value={b.dna_capa.uso_texto} />}
                      {b.dna_capa.estrutura_visual && <Stat label="Estrutura" value={b.dna_capa.estrutura_visual} />}
                    </div>
                    {b.dna_capa.recomendacao_criacao && (
                      <p className="text-xs text-foreground/80 leading-relaxed bg-elevated/50 p-3 rounded border border-border">
                        <Quote className="h-3 w-3 inline mr-1 text-muted-foreground" />
                        {b.dna_capa.recomendacao_criacao}
                      </p>
                    )}
                  </div>
                </DetailSection>
              )}

              {/* Briefing AI completo */}
              {b.briefing_ai && (
                <DetailSection icon={Wand2} title="Diretrizes de criação">
                  <div className="space-y-3 text-xs">
                    {b.briefing_ai.capa_instrucao && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">
                          Instrução da capa
                        </div>
                        <p className="text-foreground/85 leading-relaxed">{b.briefing_ai.capa_instrucao}</p>
                      </div>
                    )}
                    {b.briefing_ai.regras_nome?.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">
                          Regras do nome
                        </div>
                        <ul className="space-y-1">
                          {b.briefing_ai.regras_nome.map((r: string, i: number) => (
                            <li key={i} className="text-foreground/85 pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-primary">{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {b.briefing_ai.regras_obrigatorias?.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">
                          Regras obrigatórias
                        </div>
                        <ul className="space-y-1">
                          {b.briefing_ai.regras_obrigatorias.map((r: string, i: number) => (
                            <li key={i} className="text-foreground/85 pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-warning">{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </DetailSection>
              )}

              {/* Base musical */}
              {b.base_musical && (
                <DetailSection icon={Music2} title="Base musical">
                  {b.base_musical.artistas_principais?.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1.5">
                        Artistas principais
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {b.base_musical.artistas_principais.map((a: string, i: number) => (
                          <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-elevated border border-border">{a}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {b.base_musical.top_musicas?.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1.5">
                        Top {b.base_musical.top_musicas.length} faixas
                      </div>
                      <ul className="divide-y divide-border">
                        {b.base_musical.top_musicas.slice(0, 10).map((t: any, i: number) => (
                          <li key={i} className="py-1.5 flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground tabular-nums w-5">{i + 1}</span>
                            <div className="min-w-0 flex-1">
                              <div className="font-medium truncate">{t.nome}</div>
                              <div className="text-muted-foreground truncate">{t.artista}</div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </DetailSection>
              )}

              {/* Keywords */}
              {b.keywords_utilizadas?.length > 0 && (
                <DetailSection icon={Hash} title={`Keywords utilizadas (${b.keywords_utilizadas.length})`}>
                  <div className="flex flex-wrap gap-1">
                    {b.keywords_utilizadas.map((k: any) => (
                      <span key={k.value} className="text-[11px] px-2 py-0.5 rounded bg-elevated border border-border">
                        {k.value}
                        <span className="ml-1 text-muted-foreground">·{k.peso}</span>
                      </span>
                    ))}
                  </div>
                </DetailSection>
              )}

              {/* Playlists referência */}
              {b.playlists_referencia?.length > 0 && (
                <DetailSection icon={ListMusic} title={`Playlists de referência (${b.playlists_referencia.length})`}>
                  <ul className="space-y-1">
                    {b.playlists_referencia.slice(0, 8).map((p: any, i: number) => (
                      <li key={i} className="flex items-center gap-2 text-xs py-1">
                        <span className="text-muted-foreground tabular-nums w-5">{i + 1}</span>
                        <span className="flex-1 truncate">{p.nome}</span>
                        <span className="text-muted-foreground tabular-nums">{formatNumber(p.seguidores)}</span>
                        {p.spotify_url && (
                          <a href={p.spotify_url} target="_blank" rel="noreferrer" className="text-primary hover:opacity-80">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </DetailSection>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailSection({ icon: Icon, title, children }: any) {
  return (
    <section>
      <header className="flex items-center gap-2 mb-2.5">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <h4 className="text-[11px] uppercase tracking-[0.18em] font-bold text-foreground">{title}</h4>
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-elevated/50 border border-border rounded p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-bold text-foreground mt-0.5">{value}</div>
    </div>
  );
}
