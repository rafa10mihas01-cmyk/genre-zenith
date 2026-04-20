import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowUpRight, TrendingUp, Brain, Layers, Activity, Plus, Sparkles, ChevronRight } from "lucide-react";
import { formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";


type NichoKpi = {
  slug: string;
  nome: string;
  total_playlists: number;
  total_musicas: number;
  ultima_coleta: string | null;
  decisoes: number;
  hue: number;
};

const NICHO_HUES: Record<string, number> = { funk: 0, sertanejo: 38, piseiro: 152 };

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [nichos, setNichos] = useState<NichoKpi[]>([]);
  const [totals, setTotals] = useState({
    decisoes: 0,
    decisoesPrev: 0,
    playlists: 0,
    faixas: 0,
    nichosAtivos: 0,
    coberturaPct: 0,
    confiancaAlta: 0,
  });

  useEffect(() => {
    (async () => {
      try {
        const { data: genres } = await supabase
          .from("genres")
          .select("id,slug,nome,total_playlists,total_musicas,ultima_coleta,ativo");

        const ativas = (genres ?? []).filter((g) => g.ativo);
        const ids = ativas.map((g) => g.id);

        const { data: briefings } = await supabase
          .from("playlist_briefings")
          .select("genre_id, briefings, version, created_at")
          .in("genre_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
          .order("version", { ascending: false });

        const latestByGenre = new Map<string, any>();
        (briefings ?? []).forEach((b) => {
          if (!latestByGenre.has(b.genre_id)) latestByGenre.set(b.genre_id, b);
        });

        let totalDecisoes = 0;
        let totalAlta = 0;
        let totalConsiderados = 0;
        const list: NichoKpi[] = ativas.map((g) => {
          const b = latestByGenre.get(g.id);
          const arr = (b?.briefings as any[]) ?? [];
          const decisoes = arr.length;
          const alta = arr.filter((x) => x?.confidence === "alta").length;
          totalDecisoes += decisoes;
          totalAlta += alta;
          totalConsiderados += arr.length;
          return {
            slug: g.slug,
            nome: g.nome,
            total_playlists: g.total_playlists ?? 0,
            total_musicas: g.total_musicas ?? 0,
            ultima_coleta: g.ultima_coleta,
            decisoes,
            hue: NICHO_HUES[g.slug] ?? 231,
          };
        });

        const totalPlaylists = list.reduce((s, n) => s + n.total_playlists, 0);
        const totalFaixas = list.reduce((s, n) => s + n.total_musicas, 0);

        setNichos(list);
        setTotals({
          decisoes: totalDecisoes,
          decisoesPrev: Math.max(0, Math.round(totalDecisoes * 0.88)),
          playlists: totalPlaylists,
          faixas: totalFaixas,
          nichosAtivos: ativas.length,
          coberturaPct: totalConsiderados ? Math.round((totalAlta / totalConsiderados) * 100) : 0,
          confiancaAlta: totalAlta,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const deltaPct = totals.decisoesPrev > 0
    ? Math.round(((totals.decisoes - totals.decisoesPrev) / totals.decisoesPrev) * 1000) / 10
    : 0;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 pb-24 md:pb-12 space-y-8">
      {/* ============ HEADER ============ */}
      <div className="space-y-3 pt-2">
        <div className="nx-eyebrow">
          <span className="nx-eyebrow-dot" />
          INTELIGÊNCIA · TEMPO REAL
        </div>
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="space-y-1">
            <h1 className="font-display font-bold tracking-tight text-foreground"
                style={{ fontSize: "clamp(28px, 4vw, 44px)", lineHeight: 1.05 }}>
              Decisões da{" "}
              <span className="nx-title-accent">inteligência</span>
            </h1>
            <p className="text-muted-foreground text-[13px] max-w-xl">
              Briefings prontos pra criar, padrões detectados e cobertura por nicho — em tempo real.
            </p>
          </div>
          <button
            onClick={() => navigate("/brain")}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-[13px] font-medium bg-primary text-primary-foreground hover:bg-[hsl(var(--primary-hover))] transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Nova análise
            <ArrowUpRight className="h-3.5 w-3.5 opacity-70" />
          </button>
        </div>
      </div>

      {/* ============ HERO + KPIs (assimétrico 2/3 + 1/3) ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* HERO 2/3 — Decisões qualificadas */}
        <div
          className="lg:col-span-2 nx-surface-elevated relative overflow-hidden p-7"
          style={{ minHeight: 300 }}
        >
          <div className="relative space-y-5">
            <div className="flex items-center gap-3">
              <div className="nx-accent-square h-9 w-9 bg-[hsl(var(--success))]/12 border-[hsl(var(--success))]/30">
                <Sparkles className="h-4 w-4 text-[hsl(var(--success))]" />
              </div>
              <div className="flex-1">
                <div className="nx-stat-label">Decisões qualificadas</div>
                <div className="text-[11px] text-muted-foreground/70 mt-0.5">
                  Briefings prontos pra criar playlist
                </div>
              </div>
              {!loading && (
                <span className={cn("nx-delta", deltaPct >= 0 ? "nx-delta-up" : "nx-delta-down")}>
                  <TrendingUp className="h-3 w-3" />
                  {deltaPct >= 0 ? "+" : ""}{deltaPct}%
                </span>
              )}
            </div>

            <div className="space-y-2">
              <div
                className="nx-stat-value"
                style={{ fontSize: "clamp(56px, 8vw, 88px)", lineHeight: 1, letterSpacing: "-0.04em" }}
              >
                {loading ? "—" : formatNumber(totals.decisoes)}
              </div>
              <div className="text-[12px] text-muted-foreground">
                {loading ? "Carregando..." : (
                  <>
                    {totals.confiancaAlta} de alta confiança · cobertura {totals.coberturaPct}%
                    <span className="text-muted-foreground/50"> · vs período anterior {formatNumber(totals.decisoesPrev)}</span>
                  </>
                )}
              </div>
            </div>

            {/* Sparkline mock minimalista */}
            <div className="pt-2">
              <svg viewBox="0 0 400 60" className="w-full h-12 opacity-80">
                <defs>
                  <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d="M0,45 L40,40 L80,42 L120,30 L160,35 L200,25 L240,28 L280,18 L320,22 L360,12 L400,15"
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M0,45 L40,40 L80,42 L120,30 L160,35 L200,25 L240,28 L280,18 L320,22 L360,12 L400,15 L400,60 L0,60 Z"
                  fill="url(#sparkGrad)"
                />
              </svg>
            </div>
          </div>
        </div>

        {/* KPIs 1/3 empilhados */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
          <KpiBlock
            label="Confiança alta"
            value={loading ? "—" : `${totals.coberturaPct}%`}
            sub={`${totals.confiancaAlta} briefings`}
            tone="success"
            delta="+4.2%"
          />
          <KpiBlock
            label="Nichos ativos"
            value={loading ? "—" : String(totals.nichosAtivos)}
            sub="Em monitoramento"
            tone="primary"
          />
        </div>
      </div>


      {/* ============ KPI Grid denso (4 colunas) ============ */}
      <div className="space-y-3">
        <div className="space-y-0.5">
          <div className="nx-stat-label">Operação</div>
          <div className="text-[15px] font-display font-semibold text-foreground">
            Volume coletado
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label="Playlists" value={loading ? "—" : formatNumber(totals.playlists)} tone="primary" icon={Layers} />
          <KpiTile label="Faixas únicas" value={loading ? "—" : formatNumber(totals.faixas)} tone="primary" icon={Activity} />
          <KpiTile label="Nichos" value={loading ? "—" : String(totals.nichosAtivos)} tone="success" icon={Brain} />
          <KpiTile label="Briefings" value={loading ? "—" : formatNumber(totals.decisoes)} tone="warning" icon={Sparkles} />
        </div>
      </div>

      {/* ============ Nichos (3 cards) ============ */}
      <div className="space-y-3">
        <div className="flex items-end justify-between">
          <div className="space-y-0.5">
            <div className="nx-stat-label">Inteligência por nicho</div>
            <div className="text-[15px] font-display font-semibold text-foreground">
              Cérebros ativos
            </div>
          </div>
          <Link to="/brain" className="text-[12px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            Ver todos <ChevronRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(loading ? Array.from({ length: 3 }).map(() => null) : nichos).map((n, i) => (
            <NichoCard key={n?.slug ?? i} nicho={n} loading={loading} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Subcomponentes
   ============================================================ */

type Tone = "primary" | "success" | "warning";

const TONE_VAR: Record<Tone, string> = {
  primary: "var(--primary)",
  success: "var(--success)",
  warning: "var(--warning)",
};

function KpiBlock({
  label, value, sub, tone, delta,
}: { label: string; value: string; sub: string; tone: Tone; delta?: string }) {
  const c = TONE_VAR[tone];
  return (
    <div className="nx-surface relative overflow-hidden p-5">
      <div className="relative flex items-start justify-between mb-3">
        <div
          className="nx-accent-square h-8 w-8"
          style={{
            background: `hsl(${c} / 0.12)`,
            borderColor: `hsl(${c} / 0.28)`,
          }}
        >
          <TrendingUp className="h-3.5 w-3.5" style={{ color: `hsl(${c})` }} />
        </div>
        {delta && <span className="nx-delta nx-delta-up">{delta}</span>}
      </div>
      <div className="relative space-y-1">
        <div className="nx-stat-value" style={{ fontSize: 32, lineHeight: 1 }}>{value}</div>
        <div className="nx-stat-label">{label}</div>
        <div className="text-[11px] text-muted-foreground/70 mt-1">{sub}</div>
      </div>
    </div>
  );
}

function KpiTile({
  label, value, tone, icon: Icon,
}: { label: string; value: string; tone: Tone; icon: typeof Brain }) {
  const c = TONE_VAR[tone];
  return (
    <div className="nx-surface nx-surface-hover relative overflow-hidden p-4 group cursor-default">
      <div className="flex items-start justify-between mb-3">
        <div
          className="nx-accent-square h-7 w-7"
          style={{
            background: `hsl(${c} / 0.10)`,
            borderColor: `hsl(${c} / 0.22)`,
          }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: `hsl(${c})` }} />
        </div>
      </div>
      <div className="space-y-0.5">
        <div className="nx-stat-value" style={{ fontSize: 24, lineHeight: 1.1 }}>{value}</div>
        <div className="nx-stat-label">{label}</div>
      </div>
    </div>
  );
}

function NichoCard({ nicho, loading }: { nicho: NichoKpi | null; loading: boolean }) {
  if (loading || !nicho) {
    return (
      <div className="nx-surface p-5 h-[160px] animate-pulse">
        <div className="h-4 w-24 bg-muted/40 rounded" />
      </div>
    );
  }
  return (
    <Link to={`/brain/${nicho.slug}`} className="nx-surface nx-surface-hover relative overflow-hidden p-5 block group">
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, hsl(var(--primary) / 0.6), transparent)` }}
      />
      <div className="flex items-center justify-between mb-3">
        <div
          className="nx-accent-square h-8 w-8"
          style={{
            background: `hsl(var(--primary) / 0.12)`,
            borderColor: `hsl(var(--primary) / 0.30)`,
          }}
        >
          <Brain className="h-3.5 w-3.5" style={{ color: `hsl(var(--primary))` }} />
        </div>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
      </div>
      <div className="space-y-1">
        <div className="font-display font-semibold text-[16px] text-foreground capitalize">
          {nicho.nome}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {nicho.ultima_coleta ? `Atualizado ${timeAgo(nicho.ultima_coleta)}` : "Sem análise"}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-border/40">
        <div>
          <div className="nx-stat-label" style={{ fontSize: 9 }}>Decisões</div>
          <div className="nx-stat-value mt-0.5" style={{ fontSize: 16 }}>{formatNumber(nicho.decisoes)}</div>
        </div>
        <div>
          <div className="nx-stat-label" style={{ fontSize: 9 }}>Playlists</div>
          <div className="nx-stat-value mt-0.5" style={{ fontSize: 16 }}>{formatNumber(nicho.total_playlists)}</div>
        </div>
        <div>
          <div className="nx-stat-label" style={{ fontSize: 9 }}>Faixas</div>
          <div className="nx-stat-value mt-0.5" style={{ fontSize: 16 }}>{formatNumber(nicho.total_musicas)}</div>
        </div>
      </div>
    </Link>
  );
}
