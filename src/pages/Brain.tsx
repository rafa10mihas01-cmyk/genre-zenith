import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Brain as BrainIcon, Sparkles, Loader2, Music, Radio, Flame, ChevronRight, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber, timeAgo } from "@/lib/format";

type Slug = "funk" | "sertanejo" | "piseiro";
type Intensity = "leve" | "normal" | "agressivo";
type Size = 20 | 50 | 100;

const NICHOS: { slug: Slug; nome: string; icon: typeof Flame; cor: string }[] = [
  { slug: "funk", nome: "Funk", icon: Flame, cor: "from-rose-500/15 to-orange-500/10 border-rose-500/30" },
  { slug: "sertanejo", nome: "Sertanejo", icon: Music, cor: "from-amber-500/15 to-yellow-500/10 border-amber-500/30" },
  { slug: "piseiro", nome: "Piseiro", icon: Radio, cor: "from-emerald-500/15 to-teal-500/10 border-emerald-500/30" },
];

const STAGES = [
  "Gerando termos...",
  "Buscando playlists...",
  "Filtrando resultados...",
  "Enriquecendo dados...",
  "Analisando padrões...",
  "Gerando insights...",
];

type GenreSummary = { id: string; slug: string; nome: string; total_playlists: number | null; total_musicas: number | null; ultima_coleta: string | null; hasModel: boolean; lastAnalysis: string | null };

export default function Brain() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [nicho, setNicho] = useState<Slug>((params.get("run") as Slug) || "funk");
  const [intensity, setIntensity] = useState<Intensity>("normal");
  const [size, setSize] = useState<Size>(50);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [running, setRunning] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [stageLabel, setStageLabel] = useState("");
  const [progress, setProgress] = useState(0);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, GenreSummary>>({});

  const runLockRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; cancelRequestedRef.current = true; };
  }, []);

  // Carrega resumo dos 3 nichos
  async function loadSummaries() {
    const { data: genres } = await supabase
      .from("genres").select("id,slug,nome,total_playlists,total_musicas,ultima_coleta")
      .in("slug", NICHOS.map(n => n.slug));
    if (!genres) return;
    const ids = genres.map(g => g.id);
    const { data: models } = await supabase
      .from("genre_models").select("genre_id,ultima_analise").in("genre_id", ids);
    const modelMap = new Map((models ?? []).map(m => [m.genre_id, m.ultima_analise]));
    const out: Record<string, GenreSummary> = {};
    genres.forEach(g => {
      out[g.slug] = {
        id: g.id, slug: g.slug, nome: g.nome,
        total_playlists: g.total_playlists, total_musicas: g.total_musicas,
        ultima_coleta: g.ultima_coleta,
        hasModel: modelMap.has(g.id),
        lastAnalysis: modelMap.get(g.id) ?? null,
      };
    });
    if (mountedRef.current) setSummaries(out);
  }
  useEffect(() => { loadSummaries(); }, []);

  // Auto-start se vier ?run=slug
  useEffect(() => {
    const run = params.get("run") as Slug | null;
    if (run && NICHOS.some(n => n.slug === run) && !running && !activeJobId) {
      setNicho(run);
      // pequeno delay pra UI montar
      const t = setTimeout(() => startNewAnalysis(run), 300);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Confere no banco se a análise concluiu (fallback quando o status do job some)
  async function checkFinishedInDb(targetSlug: Slug, startedAt: number): Promise<boolean> {
    const { data: g } = await supabase
      .from("genres")
      .select("id,ultima_coleta,status")
      .eq("slug", targetSlug)
      .maybeSingle();
    if (!g) return false;
    const ts = g.ultima_coleta ? new Date(g.ultima_coleta).getTime() : 0;
    // Considera concluído se ultima_coleta foi atualizada APÓS o início do run
    return ts >= startedAt - 5_000 && (g.status === "analisado" || g.status === "coletando");
  }

  async function pollJob(jobId: string, targetSlug: Slug, startedAt: number) {
    const SUPABASE_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
    const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
    const deadline = Date.now() + 20 * 60_000;
    let consecutiveErrors = 0;
    let highestProgress = 0;
    let pendingAfterProgressCount = 0;

    const finish = async (label: string) => {
      setActiveJobId(null);
      setProgress(100);
      setStageLabel("Concluído");
      toast.success("Análise concluída", { description: label });
      await loadSummaries();
      navigate(`/brain/${targetSlug}`);
    };

    while (Date.now() < deadline && !cancelRequestedRef.current) {
      await new Promise(r => setTimeout(r, 3000));
      if (cancelRequestedRef.current) return;
      let j: any = null;
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/brain-run?job_id=${jobId}`, {
          headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
        });
        j = await r.json();
      } catch {
        consecutiveErrors++;
        // Antes de desistir, confere no banco
        if (highestProgress >= 85 && await checkFinishedInDb(targetSlug, startedAt)) {
          return finish("Abrindo a inteligência...");
        }
        if (consecutiveErrors > 15) throw new Error("Conexão instável");
        continue;
      }
      if (cancelRequestedRef.current) return;
      if (!j?.ok) {
        consecutiveErrors++;
        if (consecutiveErrors > 15) throw new Error("Job não encontrado");
        continue;
      }
      consecutiveErrors = 0;
      if (!mountedRef.current) return;

      const prog = Number(j.progress ?? 0);
      const status = j.status as string;

      // Detecta o "fantasma": job estava avançado e voltou pra pending → terminou
      if (status === "pending" && highestProgress >= 85) {
        pendingAfterProgressCount++;
        if (pendingAfterProgressCount >= 2 || await checkFinishedInDb(targetSlug, startedAt)) {
          return finish("Abrindo a inteligência...");
        }
      } else {
        pendingAfterProgressCount = 0;
      }

      // Só atualiza UI se não for "regressão fantasma"
      if (!(status === "pending" && highestProgress >= 50)) {
        setStageLabel(j.stage ?? "");
        setProgress(prog);
        const labelLower = (j.stage ?? "").toLowerCase();
        const idx = STAGES.findIndex(s => labelLower.includes(s.toLowerCase().replace("...", "").split(" ")[0]));
        if (idx >= 0) setStageIdx(idx);
      }
      if (prog > highestProgress) highestProgress = prog;

      if (status === "done") return finish("Abrindo a inteligência...");
      if (status === "error") { setActiveJobId(null); throw new Error(j.error ?? "Erro no pipeline"); }

      // Safety net: se passou de 90% e o banco já marcou concluído, abre
      if (highestProgress >= 90 && await checkFinishedInDb(targetSlug, startedAt)) {
        return finish("Abrindo a inteligência...");
      }
    }
    if (cancelRequestedRef.current) return;
    throw new Error("Timeout aguardando conclusão (20 min)");
  }

  async function startNewAnalysis(slugOverride?: Slug) {
    if (runLockRef.current || running) return;
    const target = slugOverride ?? nicho;
    runLockRef.current = true;
    cancelRequestedRef.current = false;
    setRunning(true);
    setActiveJobId(null);
    setStageIdx(0);
    setProgress(0);
    setStageLabel("Iniciando...");
    const startedAt = Date.now();
    try {
      const { data, error } = await supabase.functions.invoke("brain-run", {
        body: { slug: target, intensity, max_playlists: size },
      });
      if (error) throw error;
      if (!data?.job_id) throw new Error(data?.error ?? "Falha ao iniciar");
      setActiveJobId(data.job_id);
      await pollJob(data.job_id, target, startedAt);
    } catch (e: any) {
      if (!cancelRequestedRef.current) toast.error("Erro na análise", { description: e?.message ?? String(e) });
    } finally {
      runLockRef.current = false;
      if (mountedRef.current && !cancelRequestedRef.current) setRunning(false);
    }
  }

  function stopWatching() {
    cancelRequestedRef.current = true;
    setRunning(false);
    setStageLabel("Pausado");
    toast("Acompanhamento pausado", { description: "O job continua no backend." });
  }

  return (
    <div className="max-w-5xl mx-auto space-y-10">
      {/* Header */}
      <div className="text-center space-y-3 pt-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/30 text-xs uppercase tracking-wider text-primary">
          <BrainIcon className="h-3.5 w-3.5" /> Cérebro
        </div>
        <h1 className="text-4xl font-bold tracking-tight">Comando</h1>
        <p className="text-muted-foreground text-sm">Escolha o nicho. Dispare a análise. Veja a inteligência.</p>
      </div>

      {/* Cards de nicho — cada um é um portal pra inteligência */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {NICHOS.map((n) => {
          const Icon = n.icon;
          const summary = summaries[n.slug];
          const active = nicho === n.slug;
          return (
            <Card
              key={n.slug}
              className={cn(
                "relative overflow-hidden border-2 cursor-pointer transition-all bg-gradient-to-br",
                n.cor,
                active ? "ring-2 ring-primary shadow-lg shadow-primary/10" : "hover:border-foreground/20",
                running && "pointer-events-none opacity-60",
              )}
              onClick={() => setNicho(n.slug)}
            >
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <Icon className="h-7 w-7" />
                  {active && <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />}
                </div>
                <div>
                  <div className="text-xl font-bold">{n.nome}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {summary?.lastAnalysis ? `Analisado ${timeAgo(summary.lastAnalysis)}` : "Sem análise"}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-background/40 rounded px-2 py-1.5">
                    <div className="text-[10px] uppercase text-muted-foreground">Playlists</div>
                    <div className="font-bold tabular-nums">{formatNumber(summary?.total_playlists)}</div>
                  </div>
                  <div className="bg-background/40 rounded px-2 py-1.5">
                    <div className="text-[10px] uppercase text-muted-foreground">Faixas</div>
                    <div className="font-bold tabular-nums">{formatNumber(summary?.total_musicas)}</div>
                  </div>
                </div>
                {summary?.hasModel && (
                  <Link
                    to={`/brain/${n.slug}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center justify-between text-xs font-medium text-primary hover:underline pt-1"
                  >
                    Ver inteligência <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Configuração avançada (collapsed) */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
        >
          <Settings2 className="h-3.5 w-3.5" />
          {showAdvanced ? "Ocultar opções" : "Opções avançadas"}
        </button>

        {showAdvanced && (
          <Card className="border-border/60 bg-card/40">
            <CardContent className="grid sm:grid-cols-2 gap-6 pt-6">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Intensidade</div>
                <div className="flex gap-2">
                  {(["leve", "normal", "agressivo"] as Intensity[]).map((i) => (
                    <Button key={i} type="button" variant={intensity === i ? "default" : "outline"} size="sm" disabled={running} onClick={() => setIntensity(i)} className="capitalize flex-1">
                      {i}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Playlists por termo</div>
                <div className="flex gap-2">
                  {([20, 50, 100] as Size[]).map((s) => (
                    <Button key={s} type="button" variant={size === s ? "default" : "outline"} size="sm" disabled={running} onClick={() => setSize(s)} className="flex-1">
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Botão principal */}
      <div className="flex flex-col items-center gap-3">
        <Button
          size="lg"
          onClick={() => startNewAnalysis()}
          disabled={running}
          className="h-14 px-10 text-base font-semibold gap-2 shadow-lg shadow-primary/30"
        >
          {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
          {running ? "Analisando..." : `Analisar ${NICHOS.find(n => n.slug === nicho)?.nome ?? nicho}`}
        </Button>
        {!running && summaries[nicho]?.hasModel && (
          <Link to={`/brain/${nicho}`} className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">
            ou abra a inteligência salva
          </Link>
        )}
      </div>

      {/* Painel de progresso */}
      {running && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-6 space-y-4">
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">{stageLabel || "Iniciando..."}</span>
                <span className="font-mono text-primary">{progress}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <div className="space-y-2">
              {STAGES.map((s, i) => {
                const done = i < stageIdx;
                const act = i === stageIdx;
                return (
                  <div key={s} className={cn("flex items-center gap-3 text-sm transition-opacity", !done && !act && "opacity-40")}>
                    <div className={cn("h-5 w-5 rounded-full flex items-center justify-center border", done && "bg-primary border-primary text-primary-foreground", act && "border-primary", !done && !act && "border-muted-foreground/30")}>
                      {done ? "✓" : act ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    </div>
                    <span className={cn(act && "text-foreground font-medium", done && "text-muted-foreground line-through")}>{s}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between items-center pt-2">
              {activeJobId && <Badge variant="outline" className="text-[10px] font-mono">job {activeJobId.slice(0, 8)}</Badge>}
              <Button type="button" variant="outline" size="sm" onClick={stopWatching} className="ml-auto">Parar acompanhamento</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
