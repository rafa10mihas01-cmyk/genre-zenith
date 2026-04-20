import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Brain as BrainIcon, Sparkles, Loader2, Music, Radio, Flame, Users, ListMusic, Hash, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Slug = "funk" | "sertanejo" | "piseiro";
type Intensity = "leve" | "normal" | "agressivo";
type Size = 20 | 50 | 100;

const NICHOS: { slug: Slug; nome: string; icon: typeof Flame; cor: string }[] = [
  { slug: "funk",      nome: "Funk",      icon: Flame, cor: "from-rose-500/20 to-orange-500/20 border-rose-500/40" },
  { slug: "sertanejo", nome: "Sertanejo", icon: Music, cor: "from-amber-500/20 to-yellow-500/20 border-amber-500/40" },
  { slug: "piseiro",   nome: "Piseiro",   icon: Radio, cor: "from-emerald-500/20 to-teal-500/20 border-emerald-500/40" },
];

const STAGES = [
  "Gerando termos...",
  "Buscando playlists...",
  "Filtrando resultados...",
  "Enriquecendo dados...",
  "Analisando padrões...",
  "Gerando insights...",
];

function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n/1_000).toFixed(1)}k`;
  return String(n);
}

export default function Brain() {
  const [nicho, setNicho] = useState<Slug>("funk");
  const [intensity, setIntensity] = useState<Intensity>("normal");
  const [size, setSize] = useState<Size>(50);
  const [running, setRunning] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [stageLabel, setStageLabel] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<any>(null);

  async function runAnalysis() {
    setRunning(true);
    setResult(null);
    setStageIdx(0);
    setProgress(0);
    setStageLabel("Iniciando...");

    try {
      // 1) Inicia job (retorno rápido, 202)
      const { data: startData, error: startErr } = await supabase.functions.invoke("brain-run", {
        body: { slug: nicho, intensity, max_playlists: size },
      });
      if (startErr) throw startErr;
      if (!startData?.job_id) throw new Error(startData?.error ?? "Falha ao iniciar job");
      const jobId = startData.job_id as string;

      // 2) Polling do status
      const SUPABASE_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
      const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const deadline = Date.now() + 20 * 60_000; // 20 min máx

      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 3000));
        const r = await fetch(`${SUPABASE_URL}/functions/v1/brain-run?job_id=${jobId}`, {
          headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
        });
        const j = await r.json();
        if (!j?.ok) continue;
        setStageLabel(j.stage ?? "");
        setProgress(j.progress ?? 0);
        // mapeia label para índice visual
        const labelLower = (j.stage ?? "").toLowerCase();
        const idx = STAGES.findIndex(s => labelLower.includes(s.toLowerCase().replace("...", "").split(" ")[0]));
        if (idx >= 0) setStageIdx(idx);
        if (j.status === "done") {
          setResult(j.result);
          toast.success("Análise concluída", {
            description: `${j.result?.stages?.search?.ok ?? 0} buscas em ${Math.round((j.result?.duration_ms ?? 0)/1000)}s`,
          });
          return;
        }
        if (j.status === "error") throw new Error(j.error ?? "Erro no pipeline");
      }
      throw new Error("Timeout aguardando conclusão (20 min)");
    } catch (e: any) {
      toast.error("Erro na análise", { description: e?.message ?? String(e) });
    } finally {
      setRunning(false);
    }
  }

  const model = result?.model;
  const palavras: { value: string; count: number }[] = model?.palavras_chave ?? [];
  const padroes:  { value: string; count: number }[] = model?.padroes_nome ?? [];
  const playlists: any[] = model?.playlists_dominantes ?? [];
  const musicas: any[] = model?.musicas_recorrentes ?? [];
  const ai = model?.insights?.ai;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/30 text-xs uppercase tracking-wider text-primary">
          <BrainIcon className="h-3.5 w-3.5" /> Cérebro
        </div>
        <h1 className="text-4xl font-bold tracking-tight">O que você quer analisar?</h1>
        <p className="text-muted-foreground">Escolha o nicho. Configure. Receba inteligência.</p>
      </div>

      {/* BLOCO 1 — Nicho */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {NICHOS.map(n => {
          const Icon = n.icon;
          const active = nicho === n.slug;
          return (
            <button
              key={n.slug}
              type="button"
              disabled={running}
              onClick={() => setNicho(n.slug)}
              className={cn(
                "group relative rounded-xl border-2 p-6 text-left transition-all bg-gradient-to-br",
                n.cor,
                active
                  ? "ring-2 ring-primary scale-[1.02] shadow-lg shadow-primary/20"
                  : "opacity-70 hover:opacity-100 hover:scale-[1.01]",
                running && "pointer-events-none"
              )}
            >
              <Icon className="h-7 w-7 mb-3" />
              <div className="text-xl font-bold">{n.nome}</div>
              {active && (
                <div className="absolute top-3 right-3 h-2 w-2 rounded-full bg-primary animate-pulse" />
              )}
            </button>
          );
        })}
      </div>

      {/* BLOCO 2 — Configuração */}
      <Card className="border-border/60 bg-card/40 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Configuração</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Intensidade</div>
            <div className="flex gap-2">
              {(["leve", "normal", "agressivo"] as Intensity[]).map(i => (
                <Button
                  key={i}
                  type="button"
                  variant={intensity === i ? "default" : "outline"}
                  size="sm"
                  disabled={running}
                  onClick={() => setIntensity(i)}
                  className="capitalize flex-1"
                >
                  {i}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Playlists por termo</div>
            <div className="flex gap-2">
              {([20, 50, 100] as Size[]).map(s => (
                <Button
                  key={s}
                  type="button"
                  variant={size === s ? "default" : "outline"}
                  size="sm"
                  disabled={running}
                  onClick={() => setSize(s)}
                  className="flex-1"
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* BLOCO 3 — Ação */}
      <div className="flex justify-center">
        <Button
          size="lg"
          onClick={runAnalysis}
          disabled={running}
          className="h-14 px-10 text-base font-semibold gap-2 shadow-lg shadow-primary/30"
        >
          {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
          {running ? "Analisando..." : "Analisar agora"}
        </Button>
      </div>

      {/* Loading com etapas */}
      {running && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-6 space-y-3">
            {STAGES.map((s, i) => {
              const done = i < stageIdx;
              const active = i === stageIdx;
              return (
                <div key={s} className={cn("flex items-center gap-3 text-sm transition-opacity", !done && !active && "opacity-40")}>
                  <div className={cn(
                    "h-5 w-5 rounded-full flex items-center justify-center border",
                    done && "bg-primary border-primary text-primary-foreground",
                    active && "border-primary",
                    !done && !active && "border-muted-foreground/30",
                  )}>
                    {done ? "✓" : active ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  </div>
                  <span className={cn(active && "text-foreground font-medium", done && "text-muted-foreground line-through")}>
                    {s}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* RESULTADOS */}
      {result && model && (
        <div className="space-y-6 animate-fade-in">
          <div className="flex items-center gap-2 pt-4">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h2 className="text-2xl font-bold">Resultados — {result.genre?.nome}</h2>
          </div>

          {/* IA */}
          {ai?.resumo && (
            <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-transparent">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" /> Resumo executivo
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <p className="leading-relaxed">{ai.resumo}</p>
                {Array.isArray(ai.sugestoes_nomes) && ai.sugestoes_nomes.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Sugestões de nomes</div>
                    <div className="flex flex-wrap gap-2">
                      {ai.sugestoes_nomes.map((s: string, i: number) => (
                        <Badge key={i} variant="outline" className="border-primary/40">{s}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            {/* Palavras-chave */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Hash className="h-4 w-4" /> Palavras-chave mais frequentes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {palavras.slice(0, 20).map(p => (
                    <Badge key={p.value} variant="secondary" className="text-xs">
                      {p.value} <span className="ml-1 opacity-60">{p.count}</span>
                    </Badge>
                  ))}
                  {palavras.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma palavra identificada.</span>}
                </div>
              </CardContent>
            </Card>

            {/* Padrões */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <ListMusic className="h-4 w-4" /> Padrões de nomes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {padroes.slice(0, 15).map(p => (
                    <Badge key={p.value} variant="outline" className="text-xs">
                      "{p.value}" <span className="ml-1 opacity-60">{p.count}</span>
                    </Badge>
                  ))}
                  {padroes.length === 0 && <span className="text-xs text-muted-foreground">Nenhum padrão.</span>}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top playlists */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4" /> Top playlists encontradas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {playlists.slice(0, 10).map((p, i) => (
                  <a
                    key={i}
                    href={p.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/40 transition-colors"
                  >
                    <div className="text-xs text-muted-foreground w-5">{i + 1}</div>
                    {p.imagem
                      ? <img src={p.imagem} alt="" className="h-10 w-10 rounded object-cover" />
                      : <div className="h-10 w-10 rounded bg-muted" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.nome}</div>
                      <div className="text-xs text-muted-foreground">{p.total_musicas ?? "—"} faixas</div>
                    </div>
                    <Badge
                      variant={p.seguidores > 10_000 ? "default" : p.seguidores > 1_000 ? "secondary" : "outline"}
                      className="shrink-0"
                    >
                      {fmtNum(p.seguidores)}
                    </Badge>
                  </a>
                ))}
                {playlists.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma playlist.</span>}
              </div>
            </CardContent>
          </Card>

          {/* Músicas recorrentes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Music className="h-4 w-4" /> Músicas mais recorrentes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {musicas.slice(0, 15).map((m, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <div className="text-xs text-muted-foreground w-5">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{m.nome}</div>
                      <div className="text-xs text-muted-foreground truncate">{m.artista}</div>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-xs">×{m.count}</Badge>
                  </div>
                ))}
                {musicas.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma música.</span>}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
