import {
  Loader2, Image as ImageIcon, Palette, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonGrid } from "@/components/cerebro/_shared";
import { Section } from "@/components/cerebro/Insights";

export function Visual({ briefing, loading, onAnalyze, analyzing }: any) {
  if (loading) return <SkeletonGrid />;
  const items = briefing?.briefings ?? [];
  const withDna = items.filter((b: any) => b.dna_capa);

  if (withDna.length === 0) {
    return (
      <div className="nx-card p-8 text-center space-y-3">
        <Palette className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">DNA visual ainda não foi extraído.</p>
        <Button size="sm" onClick={onAnalyze} disabled={analyzing || items.length === 0}>
          {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
          Analisar capas
        </Button>
      </div>
    );
  }

  // ===== Consolidação: DNA dominante do gênero (agregado) =====
  const colorFreq = new Map<string, number>();
  const styleFreq = new Map<string, number>();
  const textFreq = new Map<string, number>();
  const structureFreq = new Map<string, number>();
  const moodFreq = new Map<string, number>();

  withDna.forEach((b: any) => {
    const dna = b.dna_capa;
    (dna.cores_dominantes ?? []).forEach((c: string) => {
      const norm = c.toLowerCase();
      colorFreq.set(norm, (colorFreq.get(norm) ?? 0) + 1);
    });
    if (dna.estilo_dominante) styleFreq.set(dna.estilo_dominante, (styleFreq.get(dna.estilo_dominante) ?? 0) + 1);
    if (dna.uso_texto) textFreq.set(dna.uso_texto, (textFreq.get(dna.uso_texto) ?? 0) + 1);
    if (dna.estrutura_visual) structureFreq.set(dna.estrutura_visual, (structureFreq.get(dna.estrutura_visual) ?? 0) + 1);
    if (dna.atmosfera) moodFreq.set(dna.atmosfera, (moodFreq.get(dna.atmosfera) ?? 0) + 1);
  });

  const topColors = [...colorFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
  const topOf = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  return (
    <div className="space-y-6">
      {/* ===== FASE 1 — DNA visual dominante ===== */}
      <Section step="1" icon={Palette} title="DNA visual dominante" subtitle={`Padrão consolidado a partir de ${withDna.length} capas analisadas`}>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Paleta dominante - ocupa 2 colunas */}
          <div className="lg:col-span-2 space-y-2">
            <div className="text-[10px] uppercase text-muted-foreground tracking-wider font-semibold">Paleta dominante</div>
            <div className="flex flex-wrap gap-2">
              {topColors.map(c => (
                <div key={c} className="flex flex-col items-center gap-1">
                  <div className="h-12 w-12 rounded-lg border border-border shadow-sm" style={{ backgroundColor: c }} title={c} />
                  <span className="text-[9px] font-mono text-muted-foreground uppercase">{c.replace("#", "")}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Atributos consolidados */}
          <div className="lg:col-span-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <DnaAttr label="Estilo" value={topOf(styleFreq)} />
            <DnaAttr label="Texto" value={topOf(textFreq)} />
            <DnaAttr label="Estrutura" value={topOf(structureFreq)} />
            <DnaAttr label="Atmosfera" value={topOf(moodFreq)} />
          </div>
        </div>
      </Section>

      {/* ===== FASE 2 — DNA por playlist ===== */}
      <Section step="2" icon={ImageIcon} title="DNA por playlist" subtitle={`${withDna.length} análises individuais`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {withDna.map((b: any, i: number) => {
            const dna = b.dna_capa;
            return (
              <div key={i} className="nx-card p-5 space-y-4">
                <h4 className="font-semibold text-sm leading-tight">{b.nome}</h4>

                {dna.cores_dominantes?.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] uppercase text-muted-foreground tracking-wider font-semibold">Cores</div>
                    <div className="flex gap-1.5">
                      {dna.cores_dominantes.map((c: string) => (
                        <div key={c} className="h-8 w-8 rounded-md border border-border" style={{ backgroundColor: c }} title={c} />
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs pt-1 border-t border-border/50">
                  <DnaRow label="Estilo" value={dna.estilo_dominante} />
                  <DnaRow label="Texto" value={dna.uso_texto} />
                  <DnaRow label="Estrutura" value={dna.estrutura_visual} />
                  <DnaRow label="Atmosfera" value={dna.atmosfera} />
                </div>

                {dna.recomendacao_criacao && (
                  <div className="text-xs p-3 rounded-lg bg-primary/5 border border-primary/20 text-foreground/90 leading-relaxed">
                    <div className="text-[10px] uppercase text-primary font-bold mb-1 flex items-center gap-1">
                      <FileText className="h-3 w-3" /> Recomendação para criação
                    </div>
                    {dna.recomendacao_criacao}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function DnaAttr({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider font-semibold">{label}</div>
      <div className="text-sm font-semibold text-foreground capitalize">{value}</div>
    </div>
  );
}

function DnaRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className="text-xs font-medium text-foreground/90 capitalize leading-tight">{value ?? "—"}</div>
    </div>
  );
}
