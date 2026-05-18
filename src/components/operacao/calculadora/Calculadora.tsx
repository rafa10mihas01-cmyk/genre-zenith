import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { Top200Tab } from "./Top200Tab";
import { CalculadoraResultado } from "./CalculadoraResultado";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  calcCampaign, reverseFromBudget, formatBRL, formatInt,
  DEFAULT_SPLIT, COST_PER_STREAM,
  type Modo, type Perfil, type CampaignResult,
} from "@/lib/campaignEngine";
import { Calculator, Table2, ArrowRight, Target as TargetIcon, Users, Wallet, Music, Search, CheckCircle2, X, Loader2 } from "lucide-react";

type Fonte = "manual" | "top200" | "concorrente" | "orcamento";

type TrackMeta = { title: string | null; artist: string | null; thumbnail_url: string | null; id: string };

export interface CalculadoraHandoff {
  result: CampaignResult;
  trackUrl: string;
  track: TrackMeta | null;
  fonte: Fonte;
}

export function Calculadora({ onContinue }: { onContinue?: (h: CalculadoraHandoff) => void }) {
  const [subtab, setSubtab] = useState<"calc" | "top200">("calc");

  // Inputs
  const [fonte, setFonte] = useState<Fonte>("manual");
  const [trackUrl, setTrackUrl] = useState("");
  const [track, setTrack] = useState<TrackMeta | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);

  async function buscarMusica() {
    const url = trackUrl.trim();
    if (!url) { toast({ title: "Cole o link do Spotify primeiro" }); return; }
    setTrackLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-spotify-meta", { body: { url } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Não consegui ler esse link");
      if (data.type !== "track") throw new Error("O link precisa ser de uma faixa (track)");
      setTrack({ id: data.id, title: data.title, artist: data.artist, thumbnail_url: data.thumbnail_url });
    } catch (e: any) {
      toast({ title: "Erro ao buscar música", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setTrackLoading(false);
    }
  }
  const [meta, setMeta] = useState(1_000_000);
  const [days, setDays] = useState<number>(60);
  const [budget, setBudget] = useState(40_000);
  const [modo, setModo] = useState<Modo>("simultaneo");
  const [perfil, setPerfil] = useState<Perfil>("mercado");
  const [splitEco, setSplitEco] = useState<number>(DEFAULT_SPLIT.eco);

  // Quando fonte = orçamento, meta vira derivada
  const effectiveMeta = useMemo(() => {
    if (fonte === "orcamento") return reverseFromBudget(budget, splitEco);
    return meta;
  }, [fonte, budget, splitEco, meta]);

  const result = useMemo(() => calcCampaign({
    meta: effectiveMeta, days, modo, perfil, splitEcoPct: splitEco,
  }), [effectiveMeta, days, modo, perfil, splitEco]);

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: "calc", label: "Calculadora", icon: Calculator },
          { id: "top200", label: "Top 200 BR", icon: Table2 },
        ] as const).map(t => {
          const Icon = t.icon;
          const active = subtab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubtab(t.id)}
              className={cn(
                "px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                active ? "border-primary text-foreground"
                       : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {subtab === "top200" ? (
        <Top200Tab onPick={(streamsDay) => {
          // Heurística: meta = streams/dia × dias atuais
          setFonte("manual");
          setMeta(streamsDay * days);
          setSubtab("calc");
        }} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6">
          {/* Coluna esquerda: inputs */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Música</CardTitle>
                <CardDescription>Cole o link do Spotify e clique em Buscar pra confirmar a faixa</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Music className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="https://open.spotify.com/track/..."
                      value={trackUrl}
                      onChange={e => { setTrackUrl(e.target.value); setTrack(null); }}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); buscarMusica(); } }}
                      className="pl-9"
                    />
                  </div>
                  <Button onClick={buscarMusica} disabled={trackLoading || !trackUrl.trim()} variant="outline">
                    {trackLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    <span className="ml-1.5 hidden sm:inline">Buscar</span>
                  </Button>
                </div>

                {track && (
                  <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                    {track.thumbnail_url ? (
                      <img src={track.thumbnail_url} alt={track.title ?? ""} className="h-14 w-14 rounded-md object-cover shrink-0" />
                    ) : (
                      <div className="h-14 w-14 rounded-md bg-muted shrink-0 grid place-items-center">
                        <Music className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate text-sm flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                        {track.title ?? "Faixa"}
                      </div>
                      {track.artist && <div className="text-xs text-muted-foreground truncate">{track.artist}</div>}
                    </div>
                    <button
                      onClick={() => { setTrack(null); setTrackUrl(""); }}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      aria-label="Limpar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Fonte da meta</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <FonteBtn active={fonte === "manual"} onClick={() => setFonte("manual")} icon={TargetIcon} label="Manual" />
                  <FonteBtn active={fonte === "top200"} onClick={() => { setFonte("top200"); setSubtab("top200"); }} icon={Table2} label="Top 200" />
                  <FonteBtn active={fonte === "concorrente"} onClick={() => setFonte("concorrente")} icon={Users} label="Concorrente" />
                  <FonteBtn active={fonte === "orcamento"} onClick={() => setFonte("orcamento")} icon={Wallet} label="Orçamento" />
                </div>

                {fonte === "manual" && (
                  <div>
                    <Label className="text-xs">Meta de streams</Label>
                    <NumberInput value={meta} onChange={setMeta} placeholder="1.000.000" />
                  </div>
                )}
                {fonte === "top200" && (
                  <Top200Picker
                    days={days}
                    onPick={(streamsDay, pos) => {
                      setMeta(streamsDay * days);
                      toast({ title: `Posição #${pos}`, description: `${formatInt(streamsDay)} streams/dia × ${days}d = ${formatInt(streamsDay * days)}` });
                    }}
                    onOpenList={() => setSubtab("top200")}
                  />
                )}
                {fonte === "concorrente" && (
                  <div className="space-y-2">
                    <Label className="text-xs">Link do artista concorrente</Label>
                    <Input placeholder="https://open.spotify.com/artist/..." />
                    <p className="text-xs text-muted-foreground">
                      Em breve: leitura automática de streams médios. Por enquanto, defina manualmente abaixo.
                    </p>
                    <NumberInput value={meta} onChange={setMeta} />
                  </div>
                )}
                {fonte === "orcamento" && (
                  <div className="space-y-2">
                    <Label className="text-xs">Orçamento disponível (R$)</Label>
                    <NumberInput value={budget} onChange={setBudget} placeholder="40.000" />
                    <p className="text-xs text-muted-foreground">
                      Meta calculada: <span className="font-semibold text-foreground">{formatInt(effectiveMeta)} streams</span>
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Estratégia</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs">Duração: {days} dias</Label>
                  <Slider value={[days]} onValueChange={([v]) => setDays(v)} min={15} max={180} step={5} className="mt-2" />
                </div>

                <div>
                  <Label className="text-xs">Modo</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1.5">
                    <ModeBtn active={modo === "simultaneo"} onClick={() => setModo("simultaneo")} label="Simultâneo" hint="largura ampla" />
                    <ModeBtn active={modo === "sequencial"} onClick={() => setModo("sequencial")} label="Sequencial" hint="pico marcado" />
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Perfil de audiência</Label>
                  <div className="grid grid-cols-3 gap-2 mt-1.5">
                    {(["frio", "mercado", "engajado"] as Perfil[]).map(p => (
                      <ModeBtn key={p} active={perfil === p} onClick={() => setPerfil(p)} label={cap(p)} />
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Split ecossistema: {splitEco}% próprio · {100 - splitEco}% externo</Label>
                  <Slider value={[splitEco]} onValueChange={([v]) => setSplitEco(v)} min={0} max={100} step={5} className="mt-2" />
                  <div className="text-[11px] text-muted-foreground mt-1.5 flex justify-between">
                    <span>Próprio R$ {(COST_PER_STREAM.eco * 1000).toFixed(0)}/mil</span>
                    <span>Externo R$ {(COST_PER_STREAM.ext * 1000).toFixed(0)}/mil</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Coluna direita: resultado */}
          <div className="space-y-4">
            <CalculadoraResultado r={result} />

            {onContinue && (
              <Button
                size="lg"
                className="w-full"
                variant="solid"
                onClick={() => onContinue({ result, trackUrl, track, fonte })}
              >
                Continuar para execução
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}
            <p className="text-[11px] text-muted-foreground text-center">
              A execução vai herdar meta de <strong>{formatInt(result.meta)}</strong> streams em <strong>{result.days}d</strong>,
              orçamento <strong>{formatBRL(result.custoTotal)}</strong>, split {result.splitEcoPct}/{100 - result.splitEcoPct}.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function FonteBtn({ active, onClick, icon: Icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-16 rounded-xl border flex flex-col items-center justify-center gap-1 transition-colors",
        active ? "border-primary bg-primary/10 text-primary"
               : "border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

function ModeBtn({ active, onClick, label, hint }: { active: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-12 rounded-lg border text-xs font-medium transition-colors px-2",
        active ? "border-primary bg-primary/10 text-primary"
               : "border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground",
      )}
    >
      <div>{label}</div>
      {hint && <div className="text-[10px] opacity-70">{hint}</div>}
    </button>
  );
}

/** Input numérico com separador de milhar BR. Zero nunca trava: campo aceita vazio. */
function NumberInput({
  value, onChange, placeholder,
}: { value: number; onChange: (v: number) => void; placeholder?: string }) {
  const display = value > 0 ? value.toLocaleString("pt-BR") : "";
  return (
    <Input
      inputMode="numeric"
      value={display}
      placeholder={placeholder}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "");
        onChange(digits ? parseInt(digits, 10) : 0);
      }}
      onFocus={(e) => e.target.select()}
    />
  );
}

/** Seletor de posição do Top 200: dropdown 1-200 + atalho pra lista completa. */
function Top200Picker({
  days, onPick, onOpenList,
}: { days: number; onPick: (streamsDay: number, position: number) => void; onOpenList: () => void }) {
  const [pos, setPos] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [chartDate, setChartDate] = useState<string | null>(null);

  async function handlePick(p: number) {
    setPos(p);
    setLoading(true);
    try {
      const { data: latest } = await supabase
        .from("raw_chart_daily")
        .select("chart_date")
        .eq("chart_name", "top200_br")
        .order("chart_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latest?.chart_date) {
        toast({ title: "Sincronize o Top 200 primeiro", variant: "destructive" });
        return;
      }
      const { data } = await supabase
        .from("raw_chart_daily")
        .select("streams_day, chart_date")
        .eq("chart_name", "top200_br")
        .eq("chart_date", latest.chart_date)
        .eq("position", p)
        .maybeSingle();
      if (!data) {
        toast({ title: `Posição ${p} sem dados`, variant: "destructive" });
        return;
      }
      setChartDate(data.chart_date);
      onPick(data.streams_day, p);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs">Posição alvo no Top 200 BR</Label>
      <div className="flex gap-2">
        <select
          value={pos ?? ""}
          onChange={(e) => handlePick(Number(e.target.value))}
          className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
          disabled={loading}
        >
          <option value="" disabled>Escolha a posição...</option>
          {Array.from({ length: 200 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>#{n}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={onOpenList} type="button">
          <Table2 className="h-3.5 w-3.5 mr-1" />
          Lista completa
        </Button>
      </div>
      {pos && chartDate && (
        <p className="text-[11px] text-muted-foreground">
          Meta = streams/dia da posição #{pos} × {days} dias · snapshot {chartDate}
        </p>
      )}
    </div>
  );
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
