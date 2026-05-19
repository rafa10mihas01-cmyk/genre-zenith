import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, ExternalLink, Sparkles, Loader2, Music2, TrendingUp,
  TrendingDown, ArrowUp, ArrowDown, Trash2, Plus, ChevronDown,
  Flame, Snowflake, Activity, Users, Crown, Target, Check,
  Heart, Eye, RotateCcw, Timer, Zap, ShieldCheck, AlertTriangle,
} from "lucide-react";
import { PlaylistTracksTab } from "@/components/playlists/PlaylistTracksTab";
import { ProjecaoFaixa } from "@/components/operacao/SimuladorEntrega";
import { CuratorialStateBadge, CooldownChip } from "@/components/playlist/CuratorialStateBadge";
import { AdjustmentTimeline } from "@/components/playlists/cockpit/AdjustmentTimeline";

// -------------------- types --------------------
type AnalysisTrack = {
  spotify_track_id: string;
  track_name: string | null;
  artist_name: string | null;
  position: number;
  status: "keep" | "remove" | "promote" | "demote";
  reasons: string[];
  popularity: number | null;
  saturation_pct?: number;
  recurrence_in_genre?: number;
  age_days_in_playlist?: number | null;
  target_position?: number | null;
};

type Suggestion = {
  spotify_track_id: string;
  nome: string;
  artista: string;
  count: number;
  suggested_position: number;
  from_missing_artist?: boolean;
};

type Diagnosis = {
  id: string;
  created_at: string;
  name_current: string | null;
  name_suggestion: string | null;
  name_score: number | null;
  tracks_analysis: AnalysisTrack[];
  tracks_suggestions: Suggestion[];
  tracks_summary: any;
  raw: {
    suggested_description?: string | null;
    description_current?: string | null;
    missing_keywords?: string[];
    missing_in_description?: string[];
    health_status?: "aquecido" | "saudavel" | "frio";
    niche_rank?: number | null;
    niche_total?: number | null;
    market_insights?: {
      ideal_track_count_range?: [number, number] | null;
      avg_saturation_pct?: number | null;
      top_artists?: { name: string; plays_in_niche: number }[];
      top_recurring_tracks?: { title: string | null; artist: string | null; niche_playlists_count: number }[];
      leader_playlists?: { spotify_playlist_id: string; name: string; followers: number; cover_url: string | null }[];
      niche_playlist_count?: number;
    };
    // Sprint 2 — camada editorial
    recommendation_mode?: "hold" | "light" | "moderate" | "structural";
    editorial_justification?: string;
    curatorial_state?: "saudavel" | "observacao" | "leve" | "moderada" | "estrutural" | "cooldown";
    applied_caps?: {
      max_change_pct: number;
      max_change_pct_config: number;
      max_changes: number;
      recommended_remove: number;
      recommended_promote: number;
      recommended_demote: number;
      capped_suggestions: number;
      original_suggestions: number;
    };
    active_cooldowns?: Array<{ action_type: string; cooldown_until: string; days_remaining: number; reason: string | null }>;
  };
};

type Props = {
  managedId: string;
  spotifyPlaylistId: string;
  spotifyUrl: string;
  playlistName: string;
  coverUrl: string | null;
  followers: number | null;
  tracksCount: number;
  genreName?: string | null;
  brainScore?: number | null;
  onBack?: () => void;
};

// -------------------- helpers --------------------
function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("pt-BR").format(n);
}

const HEALTH_META: Record<string, { label: string; tone: string; Icon: any }> = {
  aquecido: { label: "Aquecido", tone: "text-primary border-primary/40 bg-primary/10", Icon: Flame },
  saudavel: { label: "Saudável", tone: "text-foreground border-border bg-elevated", Icon: Activity },
  frio: { label: "Frio", tone: "text-destructive border-destructive/40 bg-destructive/10", Icon: Snowflake },
};

// -------------------- main --------------------
export function PlaylistCockpit({
  managedId, spotifyPlaylistId, spotifyUrl, playlistName, coverUrl,
  followers, tracksCount, genreName, brainScore, onBack,
}: Props) {
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [liveTracksCount, setLiveTracksCount] = useState(tracksCount);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState<null | "remove" | "demote" | "promote" | "add" | "all">(null);

  useEffect(() => { setLiveTracksCount(tracksCount); }, [tracksCount]);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("playlist_diagnoses")
      .select("id, created_at, name_current, name_suggestion, name_score, tracks_analysis, tracks_suggestions, tracks_summary, raw")
      .eq("playlist_id", managedId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setDiag((data as any) ?? null);
    setLoading(false);
  }, [managedId]);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  async function runDiagnose() {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("diagnose-managed-playlist", {
        body: { playlist_id: managedId },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falha");
      setDiag(data.diagnosis);
      toast({ title: "Diagnóstico pronto" });
    } catch (e: any) {
      toast({ title: "Erro no diagnóstico", description: e.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  async function applyPlan(action: "remove" | "demote" | "promote" | "add" | "all") {
    setApplying(action);
    try {
      const { data, error } = await supabase.functions.invoke("apply-playlist-plan", {
        body: { playlist_id: managedId, action },
      });
      let serverError: string | null = null;
      let status: number | null = null;
      if (error && (error as any).context) {
        try {
          const ctx = (error as any).context as Response;
          status = ctx.status ?? null;
          const b = await ctx.clone().json().catch(() => null);
          serverError = b?.error ?? null;
        } catch { /* */ }
      }
      if (error || data?.ok === false) {
        toast({
          title: status ? `Erro ${status}` : "Falha ao aplicar",
          description: serverError ?? data?.error ?? error?.message ?? "erro desconhecido",
          variant: "destructive",
        });
        return;
      }
      if (typeof data?.current_tracks_count === "number") {
        setLiveTracksCount(data.current_tracks_count);
      }
      const summary = (data?.steps ?? [])
        .map((s: any) => {
          if (s.skipped) return null;
          if (s.action === "remove") return `removidas ${s.removed}`;
          if (s.action === "add") return `adicionadas ${s.added}`;
          if (s.action === "promote" || s.action === "demote")
            return `${s.action === "promote" ? "promovidas" : "rebaixadas"} ${s.moved}`;
          return null;
        })
        .filter(Boolean)
        .join(" · ");
      toast({
        title: action === "all" ? "Plano executado" : "Bucket aplicado",
        description: summary || "sem alterações necessárias",
      });
      if (action === "all") {
        // Plano completo: re-roda diagnóstico pra refletir o novo estado.
        runDiagnose();
      } else {
        // Bucket isolado: limpa SÓ esse bucket localmente, preservando os outros
        // ainda pendentes. O usuário decide quando reavaliar.
        setDiag((prev) => {
          if (!prev) return prev;
          const next: any = { ...prev };
          if (action === "remove" || action === "demote" || action === "promote") {
            next.tracks_analysis = (prev.tracks_analysis ?? []).filter(
              (t: any) => t.status !== action,
            );
          }
          if (action === "add") {
            next.tracks_suggestions = [];
          }
          return next;
        });
      }
    } finally {
      setApplying(null);
    }
  }

  // ---- buckets ----
  const analysis = diag?.tracks_analysis ?? [];
  const suggestions = diag?.tracks_suggestions ?? [];
  const buckets = useMemo(() => {
    const remove = analysis.filter((t) => t.status === "remove")
      .sort((a, b) => a.position - b.position);
    const demote = analysis.filter((t) => t.status === "demote")
      .sort((a, b) => a.position - b.position);
    const promote = analysis.filter((t) => t.status === "promote")
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    return { remove, demote, promote, add: suggestions };
  }, [analysis, suggestions]);

  const health = HEALTH_META[diag?.raw?.health_status ?? "saudavel"];
  const market = diag?.raw?.market_insights;
  const idealRange = market?.ideal_track_count_range;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 md:px-8 py-4 md:py-5 space-y-4">
      {/* ============ 1. HERO (compacto) ============ */}
      <Card className="overflow-hidden border-0 bg-gradient-to-br from-primary/[0.08] via-card to-card relative">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.12),transparent_55%)]" />
        <div className="relative p-4 md:p-5 flex flex-col md:flex-row gap-4 md:gap-5 items-start">
          <div className="relative shrink-0">
            {coverUrl ? (
              <img src={coverUrl} alt={playlistName}
                className="w-20 h-20 md:w-24 md:h-24 rounded-xl object-cover shadow-lg ring-1 ring-white/5" />
            ) : (
              <div className="w-20 h-20 md:w-24 md:h-24 rounded-xl bg-elevated grid place-items-center">
                <Music2 className="h-7 w-7 text-muted-foreground/40" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              {onBack && (
                <Button variant="ghost" size="sm" onClick={onBack} className="h-6 -ml-2 text-muted-foreground hover:text-foreground gap-1 text-xs">
                  <ArrowLeft className="h-3 w-3" /> Voltar
                </Button>
              )}
              {genreName && (
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{genreName}</Badge>
              )}
              {diag?.raw?.niche_rank && diag.raw.niche_total && (
                <Badge variant="outline" className="text-[10px] gap-1 border-primary/30 text-primary">
                  <Crown className="h-3 w-3" /> #{diag.raw.niche_rank} de {diag.raw.niche_total}
                </Badge>
              )}
              <span className={cn("inline-flex items-center gap-1 px-2 h-5 rounded-full border text-[10px] font-medium", health.tone)}>
                <health.Icon className="h-3 w-3" /> {health.label}
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight leading-tight truncate">
              {playlistName}
            </h1>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
              <Stat label="Seguidores" value={fmtNum(followers)} accent />
              <Stat label="Faixas" value={fmtNum(liveTracksCount)} />
              {brainScore != null && <Stat label="Score" value={`${brainScore}`} />}
              {diag && (
                <Stat label="Diagnóstico" value={new Date(diag.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} muted />
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 md:flex-col md:items-end shrink-0">
            <Button onClick={runDiagnose} disabled={running} size="sm" className="gap-1.5 h-8">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {diag ? "Rodar nova análise" : "Rodar análise"}
            </Button>
            <Button variant="outline" size="sm" asChild className="h-8">
              <a href={spotifyUrl} target="_blank" rel="noreferrer" className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" /> Abrir no Spotify
              </a>
            </Button>
          </div>
        </div>
      </Card>

      {loading ? (
        <Card className="p-10 grid place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </Card>
      ) : !diag ? (
        <Card className="p-10 text-center space-y-3">
          <Sparkles className="h-8 w-8 text-primary/60 mx-auto" />
          <h3 className="font-semibold">Sem diagnóstico ainda</h3>
          <p className="text-sm text-muted-foreground">Clique em <strong>Rodar análise</strong> para gerar o cockpit.</p>
        </Card>
      ) : (
        <>
          {/* ============ CICLO CURATORIAL — banner editorial ============ */}
          <EditorialBanner diag={diag} onRediagnose={runDiagnose} running={running} />

          {/* ============ MEMÓRIA DE IMPACTO ============ */}
          <AdjustmentTimeline playlistId={managedId} />

          <Tabs defaultValue={market ? "mercado" : "identidade"} className="space-y-4">
            <TabsList className="bg-elevated/60 flex-wrap h-auto">
              {market && (
                <TabsTrigger value="mercado" className="gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" /> Mercado
                </TabsTrigger>
              )}
              <TabsTrigger value="identidade" className="gap-1.5">
                <Eye className="h-3.5 w-3.5" /> Identidade
              </TabsTrigger>
              <TabsTrigger value="plano" className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> Plano de ação
                {(buckets.remove.length + buckets.demote.length + buckets.promote.length + buckets.add.length) > 0 && (
                  <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px] tabular-nums">
                    {buckets.remove.length + buckets.demote.length + buckets.promote.length + buckets.add.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="projecao" className="gap-1.5">
                <Activity className="h-3.5 w-3.5" /> Projeção
              </TabsTrigger>
              {/* Aba "Faixas" ocultada — endpoint instável. Manter código pra reativar depois. */}
            </TabsList>

            {/* ============ PLANO DE AÇÃO ============ */}
            <TabsContent value="plano" className="space-y-4 mt-0">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <ActionCard kind="remove" count={buckets.remove.length} hrefId="bucket-remove" />
                <ActionCard kind="demote" count={buckets.demote.length} hrefId="bucket-demote" />
                <ActionCard kind="promote" count={buckets.promote.length} hrefId="bucket-promote" />
                <ActionCard kind="add" count={buckets.add.length} hrefId="bucket-add" />
              </div>
              {(buckets.remove.length + buckets.demote.length + buckets.promote.length + buckets.add.length) > 0 && (
                <Card className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-primary/5 border-primary/30">
                  <div className="space-y-0.5">
                    <div className="text-sm font-semibold">Executar plano completo</div>
                    <div className="text-xs text-muted-foreground">
                      Ordem: remover → rebaixar → promover → adicionar. Tudo via API, sem abrir o Spotify.
                    </div>
                  </div>
                  <Button onClick={() => applyPlan("all")} disabled={applying !== null} className="gap-1.5 shrink-0">
                    {applying === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Aprovar e executar tudo
                  </Button>
                </Card>
              )}

              <BucketRemove
                items={buckets.remove}
                applying={applying === "remove" || applying === "all"}
                onApplyAll={() => applyPlan("remove")}
              />
              <BucketReorder
                kind="demote"
                items={buckets.demote}
                totalTracks={liveTracksCount}
                applying={applying === "demote" || applying === "all"}
                onApplyAll={() => applyPlan("demote")}
              />
              <BucketReorder
                kind="promote"
                items={buckets.promote}
                totalTracks={liveTracksCount}
                applying={applying === "promote" || applying === "all"}
                onApplyAll={() => applyPlan("promote")}
              />
              <BucketAdd
                items={buckets.add}
                applying={applying === "add" || applying === "all"}
                onApplyAll={() => applyPlan("add")}
              />
            </TabsContent>

            {/* ============ IDENTIDADE ============ */}
            <TabsContent value="identidade" className="space-y-4 mt-0">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <IdentityField
                  label="Nome"
                  field="name"
                  managedId={managedId}
                  current={diag.name_current ?? playlistName}
                  suggestion={diag.name_suggestion}
                  score={diag.name_score}
                  onApplied={runDiagnose}
                />
                <IdentityField
                  label="Descrição"
                  field="description"
                  managedId={managedId}
                  current={diag.raw?.description_current || ""}
                  suggestion={diag.raw?.suggested_description ?? null}
                  onApplied={runDiagnose}
                />
              </div>
              <CoverCard
                managedId={managedId}
                currentCover={coverUrl}
                references={(diag.raw?.market_insights?.top_recurring_tracks ?? [])
                  .filter((t: any) => t?.cover_url)
                  .map((t: any) => ({
                    id: t.spotify_track_id,
                    name: t.title ?? "—",
                    subtitle: t.artist ?? "",
                    cover_url: t.cover_url,
                    external_url: t.spotify_track_id ? `https://open.spotify.com/track/${t.spotify_track_id}` : null,
                  }))}
                spotifyPlaylistId={spotifyPlaylistId}
              />
              {(diag.raw?.missing_keywords?.length ?? 0) > 0 && (
                <Card className="p-4">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                    Palavras fortes do nicho que faltam
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {diag.raw!.missing_keywords!.map((k) => (
                      <Badge key={k} variant="outline" className="text-[11px] border-warning/40 text-warning bg-warning/5">
                        {k}
                      </Badge>
                    ))}
                  </div>
                </Card>
              )}
            </TabsContent>

            {/* ============ MERCADO ============ */}
            {market && (
              <TabsContent value="mercado" className="space-y-4 mt-0">
                <MarketBlock market={market} idealRange={idealRange} />
              </TabsContent>
            )}

            {/* ============ PROJEÇÃO ============ */}
            <TabsContent value="projecao" className="space-y-3 mt-0">
              <div className="text-[11px] text-muted-foreground">
                Estimativa teórica de plays por posição, baseada nos saves dessa playlist. Use pra decidir em qual posição colocar uma faixa.
              </div>
              <ProjecaoFaixa
                playlist={{
                  id: managedId,
                  name: playlistName,
                  cover_url: coverUrl,
                  followers: followers ?? 0,
                  tracks_count: liveTracksCount,
                }}
              />
            </TabsContent>

            {/* ============ TODAS AS FAIXAS ============ */}
            <TabsContent value="faixas" className="mt-0">
              <Card className="p-4">
                <PlaylistTracksTab playlistId={managedId} />
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

// -------------------- subcomponents --------------------
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 pt-2">
      <h2 className="text-[11px] uppercase tracking-[0.2em] font-semibold text-muted-foreground">
        {children}
      </h2>
      <div className="flex-1 h-px bg-border/60" />
    </div>
  );
}

function Stat({ label, value, accent, muted }: { label: string; value: string; accent?: boolean; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn(
        "font-semibold tabular-nums",
        accent && "text-primary text-lg",
        muted && "text-xs text-muted-foreground font-normal",
        !accent && !muted && "text-base",
      )}>{value}</span>
    </div>
  );
}

function IdentityField({ label, field, managedId, current, suggestion, score, onApplied }: {
  label: string;
  field: "name" | "description";
  managedId: string;
  current: string;
  suggestion: string | null;
  score?: number | null;
  onApplied?: () => void;
}) {
  const [applying, setApplying] = useState(false);
  const hasSugg = !!suggestion && suggestion.trim() !== current.trim();

  async function apply() {
    if (!suggestion) return;
    setApplying(true);
    try {
      const { data, error } = await supabase.functions.invoke("apply-playlist-identity", {
        body: { playlist_id: managedId, [field]: suggestion },
      });
      let serverError: string | null = null;
      let status: number | null = null;
      if (error && (error as any).context) {
        try {
          const ctx = (error as any).context as Response;
          status = ctx.status ?? null;
          const b = await ctx.clone().json().catch(() => null);
          serverError = b?.error ?? null;
        } catch { /* */ }
      }
      if (error || data?.ok === false) {
        toast({
          title: status ? `Erro ${status}` : "Falha ao aplicar",
          description: serverError ?? data?.error ?? error?.message ?? "erro desconhecido",
          variant: "destructive",
        });
        return;
      }
      toast({ title: `${label} atualizado no Spotify` });
      onApplied?.();
    } finally {
      setApplying(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
        {score != null && (
          <span className={cn(
            "text-xs font-semibold tabular-nums",
            score >= 60 ? "text-primary" : score >= 30 ? "text-warning" : "text-destructive",
          )}>{score}/100</span>
        )}
      </div>
      <div className="space-y-2">
        <div>
          <div className="text-[10px] text-muted-foreground mb-1">Atual</div>
          <div className="text-sm bg-elevated/60 rounded-md px-3 py-2 text-foreground/80">{current || "— vazio —"}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-primary" /> Sugestão da IA
          </div>
          <div className={cn(
            "text-sm rounded-md px-3 py-2",
            hasSugg ? "bg-primary/10 border border-primary/30 text-foreground" : "bg-elevated/40 text-muted-foreground italic",
          )}>
            {suggestion || "sem ajuste sugerido"}
          </div>
        </div>
      </div>
      {hasSugg && (
        <div className="flex justify-between items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              navigator.clipboard.writeText(suggestion!);
              toast({ title: "Copiado", description: "Cole onde quiser." });
            }}
            className="h-7 text-xs text-muted-foreground gap-1"
          >
            Copiar
          </Button>
          <Button
            size="sm"
            onClick={apply}
            disabled={applying}
            className="gap-1.5 h-7"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Aplicar no Spotify
          </Button>
        </div>
      )}
    </Card>
  );
}

type CoverReference = {
  id: string;
  name: string;
  subtitle?: string;
  cover_url: string | null;
  external_url?: string | null;
};

function CoverCard({ managedId, currentCover, references, spotifyPlaylistId }: {
  managedId: string;
  currentCover: string | null;
  references: CoverReference[];
  spotifyPlaylistId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [applyingLeader, setApplyingLeader] = useState<string | null>(null);
  const [localCover, setLocalCover] = useState<string | null>(currentCover);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [selectedLeader, setSelectedLeader] = useState<CoverReference | null>(null);

  useEffect(() => { setLocalCover(currentCover); }, [currentCover]);

  const applyLeaderCover = async (ref: CoverReference) => {
    if (!ref.cover_url) return;
    setApplyingLeader(ref.id);
    try {
      const { data, error } = await supabase.functions.invoke("apply-managed-cover", {
        body: { playlist_id: managedId, image_url: ref.cover_url },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "falha ao aplicar capa");
      setLocalCover(data.cover_url ?? ref.cover_url);
      setSelectedLeader(null);
      toast({
        title: data.confirmed ? "Capa aplicada no Spotify" : "Capa enviada ao Spotify",
        description: data.confirmed ? `Usando a capa de "${ref.name}".` : "O Spotify aceitou a capa, mas a CDN ainda pode levar alguns segundos para exibir.",
      });
    } catch (e: any) {
      toast({ title: "Erro ao aplicar capa", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setApplyingLeader(null);
    }
  };

  const selectFile = (file: File) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      toast({ title: "Formato inválido", description: "Use PNG, JPG ou WEBP.", variant: "destructive" });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast({ title: "Arquivo grande", description: "Máximo 8MB (será comprimido).", variant: "destructive" });
      return;
    }
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setSelectedLeader(null);
    setPendingFile(file);
    setPendingPreview(URL.createObjectURL(file));
  };

  const clearPending = () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null);
    setPendingPreview(null);
    setSelectedLeader(null);
  };

  const selectLeaderCover = (ref: CoverReference) => {
    if (!ref.cover_url) return;
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null);
    setPendingPreview(null);
    setSelectedLeader(ref);
  };

  const applyPending = async () => {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const ext = pendingFile.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${managedId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("playlist-covers")
        .upload(path, pendingFile, { contentType: pendingFile.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("playlist-covers").getPublicUrl(path);
      const imageUrl = pub.publicUrl;

      const { data, error } = await supabase.functions.invoke("apply-managed-cover", {
        body: { playlist_id: managedId, image_url: imageUrl },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "falha ao aplicar capa");
      setLocalCover(data.cover_url ?? imageUrl);
      clearPending();
      toast({
        title: data.confirmed ? "Capa aplicada no Spotify" : "Capa enviada ao Spotify",
        description: data.confirmed ? "A nova capa já foi confirmada no Spotify." : "O Spotify aceitou a capa, mas a CDN ainda pode levar alguns segundos para exibir.",
      });
    } catch (e: any) {
      toast({ title: "Erro ao enviar capa", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const isCoverApplying = uploading || applyingLeader !== null;
  const selectedCoverPreview = pendingPreview ?? selectedLeader?.cover_url ?? null;
  const selectedCoverName = pendingFile?.name ?? selectedLeader?.name ?? "";
  const selectedCoverHint = pendingFile ? "Imagem escolhida do seu computador." : "Capa selecionada das faixas do nicho.";

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Capa</span>
        <div className="flex items-center gap-2">
          <label className={cn(
            "inline-flex items-center gap-1 h-7 px-2 text-xs rounded-md cursor-pointer",
            "bg-primary text-primary-foreground hover:bg-primary/90 font-medium",
            isCoverApplying && "opacity-60 pointer-events-none",
          )}>
            <Plus className="h-3 w-3" />
            Escolher capa
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={isCoverApplying}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) selectFile(f); e.currentTarget.value = ""; }}
            />
          </label>
          <Button asChild size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground">
            <a href={`https://open.spotify.com/playlist/${spotifyPlaylistId}`} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3 w-3" /> Abrir no Spotify
            </a>
          </Button>
        </div>
      </div>
      {selectedCoverPreview && (pendingFile || selectedLeader) && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <img src={selectedCoverPreview} alt="capa selecionada" className="w-16 h-16 rounded-md object-cover ring-1 ring-border" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{selectedCoverName}</div>
            <div className="text-[10px] text-muted-foreground">{selectedCoverHint}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={clearPending} disabled={isCoverApplying} className="h-7 text-xs">
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={() => pendingFile ? applyPending() : selectedLeader && applyLeaderCover(selectedLeader)}
            disabled={isCoverApplying}
            className="h-7 text-xs gap-1.5"
          >
            {isCoverApplying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {isCoverApplying ? "Aplicando..." : "Aplicar no Spotify"}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-[auto_1fr] gap-4 items-start">
        <div className="space-y-1.5">
          <div className="text-[10px] text-muted-foreground">Atual</div>
          {localCover ? (
            <img src={localCover} alt="capa atual"
              className="w-28 h-28 rounded-lg object-cover ring-1 ring-border" />
          ) : (
            <div className="w-28 h-28 rounded-lg bg-elevated grid place-items-center">
              <Music2 className="h-6 w-6 text-muted-foreground/40" />
            </div>
          )}
        </div>
        <div className="space-y-1.5 min-w-0">
          <div className="text-[10px] text-muted-foreground">Capas dos líderes do nicho — referência visual</div>
          {leaders.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">Sem dados de líderes neste diagnóstico.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {leaders.slice(0, 8).map((l) => {
                const busy = applyingLeader === l.spotify_playlist_id;
                return (
                  <div key={l.spotify_playlist_id} className="relative group">
                    {l.cover_url ? (
                      <img src={l.cover_url} alt={l.name}
                        className="w-16 h-16 rounded-md object-cover ring-1 ring-border group-hover:ring-primary/50 transition-all" />
                    ) : (
                      <div className="w-16 h-16 rounded-md bg-elevated" />
                    )}
                    <div className="absolute inset-0 rounded-md bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 p-1">
                      <button
                        type="button"
                        disabled={!l.cover_url || isCoverApplying}
                        onClick={() => selectLeaderCover(l)}
                        title={`Selecionar capa de "${l.name}"`}
                        className="text-[9px] font-semibold leading-tight text-primary-foreground bg-primary hover:bg-primary/90 rounded px-1.5 py-0.5 disabled:opacity-50"
                      >
                        {busy ? "..." : "Escolher"}
                      </button>
                      <a
                        href={`https://open.spotify.com/playlist/${l.spotify_playlist_id}`}
                        target="_blank" rel="noreferrer"
                        title={l.name}
                        className="text-[9px] text-white/80 hover:text-white underline"
                      >
                        abrir
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="text-[11px] text-muted-foreground pt-1">
            Escolha uma capa sua ou uma referência. Depois confirme em "Aplicar no Spotify".
          </div>
        </div>
      </div>
    </Card>
  );
}


const ACTION_META = {
  remove: { label: "Remover", Icon: Trash2, tone: "border-destructive/40 bg-destructive/10 text-destructive", hint: "Faixas sem tração ou saturadas" },
  demote: { label: "Rebaixar", Icon: ArrowDown, tone: "border-warning/40 bg-warning/10 text-warning", hint: "Na vitrine sem performance" },
  promote: { label: "Promover", Icon: ArrowUp, tone: "border-primary/40 bg-primary/10 text-primary", hint: "Mercado já reconheceu" },
  add: { label: "Adicionar", Icon: Plus, tone: "border-primary/50 bg-primary/15 text-primary", hint: "Faixas dominando o nicho" },
} as const;

function ActionCard({ kind, count, hrefId }: { kind: keyof typeof ACTION_META; count: number; hrefId: string }) {
  const m = ACTION_META[kind];
  const disabled = count === 0;
  return (
    <a
      href={`#${hrefId}`}
      onClick={(e) => {
        if (disabled) { e.preventDefault(); return; }
        e.preventDefault();
        document.getElementById(hrefId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
      className={cn(
        "rounded-2xl border p-4 transition-all",
        m.tone,
        disabled ? "opacity-40 cursor-not-allowed" : "hover:scale-[1.02] cursor-pointer",
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <m.Icon className="h-4 w-4" />
        <span className="text-[10px] uppercase tracking-wider font-bold">{m.label}</span>
      </div>
      <div className="text-3xl font-bold tabular-nums leading-none">{count}</div>
      <div className="text-[11px] opacity-80 mt-1.5 leading-snug">{m.hint}</div>
    </a>
  );
}

// -------- buckets --------
function BucketShell({
  id, kind, count, headerRight, children,
}: { id: string; kind: keyof typeof ACTION_META; count: number; headerRight?: React.ReactNode; children: React.ReactNode }) {
  const m = ACTION_META[kind];
  if (count === 0) return null;
  return (
    <Card id={id} className="overflow-hidden scroll-mt-20">
      <div className={cn("flex items-center justify-between px-4 py-3 border-b", m.tone, "bg-opacity-40")}>
        <div className="flex items-center gap-2">
          <m.Icon className="h-4 w-4" />
          <span className="text-sm font-bold uppercase tracking-wider">{m.label}</span>
          <span className="text-xs opacity-70">· {count} {count === 1 ? "faixa" : "faixas"}</span>
        </div>
        {headerRight}
      </div>
      <div className="divide-y divide-border/40 max-h-[440px] overflow-y-auto">{children}</div>
    </Card>
  );
}

function PositionBadge({ from, to }: { from: number; to: number | null }) {
  return (
    <div className="flex items-center gap-1 text-[11px] font-mono tabular-nums shrink-0 w-20">
      <span className="text-muted-foreground">#{from}</span>
      <span className="text-muted-foreground/50">→</span>
      <span className={cn("font-semibold", to == null ? "text-destructive" : "text-primary")}>
        {to == null ? "—" : `#${to}`}
      </span>
    </div>
  );
}

function TrackLine({
  position, target, title, artist, reason, action,
}: { position: number; target: number | null; title: string; artist: string; reason: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-elevated/40 transition-colors">
      <PositionBadge from={position} to={target} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{title}</div>
        <div className="text-xs text-muted-foreground truncate">{artist} · {reason}</div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function BucketRemove({ items, applying, onApplyAll }: {
  items: AnalysisTrack[]; applying: boolean; onApplyAll: () => void;
}) {
  return (
    <BucketShell
      id="bucket-remove"
      kind="remove"
      count={items.length}
      headerRight={
        items.length > 0 && (
          <Button
            size="sm"
            variant="destructive"
            onClick={onApplyAll}
            disabled={applying}
            className="h-7 text-xs gap-1"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Remover todas ({items.length})
          </Button>
        )
      }
    >
      {items.map((t) => (
        <TrackLine
          key={t.spotify_track_id}
          position={t.position + 1}
          target={null}
          title={t.track_name ?? "—"}
          artist={t.artist_name ?? "—"}
          reason={(t.reasons ?? [])[0] ?? "baixa performance"}
          action={<span className="text-[10px] text-muted-foreground uppercase tracking-wider">Remover</span>}
        />
      ))}
    </BucketShell>
  );
}

function BucketReorder({ kind, items, totalTracks, applying, onApplyAll }: {
  kind: "promote" | "demote";
  items: AnalysisTrack[];
  totalTracks: number;
  applying: boolean;
  onApplyAll: () => void;
}) {
  return (
    <BucketShell
      id={`bucket-${kind}`}
      kind={kind}
      count={items.length}
      headerRight={
        items.length > 0 && (
          <Button
            size="sm"
            onClick={onApplyAll}
            disabled={applying}
            variant={kind === "promote" ? "default" : "outline"}
            className="h-7 text-xs gap-1"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> :
              kind === "promote" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {kind === "promote" ? "Promover todas" : "Rebaixar todas"} ({items.length})
          </Button>
        )
      }
    >
      {items.map((t) => (
        <TrackLine
          key={t.spotify_track_id}
          position={t.position + 1}
          target={t.target_position ?? (kind === "promote" ? 5 : Math.max(30, totalTracks - 10))}
          title={t.track_name ?? "—"}
          artist={t.artist_name ?? "—"}
          reason={(t.reasons ?? []).join(" · ") || "—"}
          action={
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {kind === "promote" ? "Promover" : "Rebaixar"}
            </span>
          }
        />
      ))}
    </BucketShell>
  );
}

function BucketAdd({ items, applying, onApplyAll }: {
  items: Suggestion[]; applying: boolean; onApplyAll: () => void;
}) {
  return (
    <BucketShell
      id="bucket-add"
      kind="add"
      count={items.length}
      headerRight={
        items.length > 0 && (
          <Button
            size="sm"
            onClick={onApplyAll}
            disabled={applying}
            className="h-7 text-xs gap-1"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Adicionar todas ({items.length})
          </Button>
        )
      }
    >
      {items.map((t) => (
        <TrackLine
          key={t.spotify_track_id}
          position={0}
          target={t.suggested_position}
          title={t.nome || "—"}
          artist={t.artista || "—"}
          reason={`${t.count}× nas playlists vencedoras do nicho${t.from_missing_artist ? " · artista faltando" : ""}`}
          action={
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Adicionar
            </span>
          }
        />
      ))}
    </BucketShell>
  );
}

// -------- mercado --------
function MarketBlock({ market, idealRange }: { market: any; idealRange: any }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Tamanho ideal</span>
        </div>
        <div className="text-2xl font-bold tabular-nums">
          {idealRange?.[0] ?? "—"}<span className="text-muted-foreground mx-1">–</span>{idealRange?.[1] ?? "—"}
          <span className="text-xs text-muted-foreground ml-1 font-normal">faixas</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Saturação média do nicho: <strong className="text-foreground">{market.avg_saturation_pct ?? "—"}%</strong>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Baseado em <strong className="text-foreground">{market.niche_playlist_count ?? "—"}</strong> playlists varridas
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Artistas dominando</span>
        </div>
        <ul className="space-y-1">
          {(market.top_artists ?? []).slice(0, 6).map((a: any, i: number) => (
            <li key={i} className="flex justify-between text-xs">
              <span className="truncate">{a.name}</span>
              <span className="text-muted-foreground tabular-nums shrink-0 ml-2">{a.plays_in_niche}×</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Faixas mais recorrentes</span>
        </div>
        <ul className="space-y-1.5">
          {(market.top_recurring_tracks ?? []).slice(0, 5).map((t: any, i: number) => (
            <li key={i} className="text-xs">
              <div className="font-medium truncate">{t.title ?? "—"}</div>
              <div className="text-muted-foreground truncate flex justify-between">
                <span>{t.artist ?? "—"}</span>
                <span className="tabular-nums">{t.niche_playlists_count}×</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {(market.leader_playlists?.length ?? 0) > 0 && (
        <Card className="p-4 space-y-2 lg:col-span-3">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Playlists líderes do nicho</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {market.leader_playlists.slice(0, 6).map((p: any) => (
              <a
                key={p.spotify_playlist_id}
                href={`https://open.spotify.com/playlist/${p.spotify_playlist_id}`}
                target="_blank" rel="noreferrer"
                className="flex items-center gap-2 p-2 rounded-lg border border-border hover:border-primary/40 transition-colors"
              >
                {p.cover_url && <img src={p.cover_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">{fmtNum(p.followers)} seg.</div>
                </div>
              </a>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// -------------------- EditorialBanner --------------------
const MODE_META: Record<string, { label: string; tone: string; Icon: any }> = {
  hold:       { label: "Não mexer",            tone: "border-primary/40 bg-primary/5 text-primary",                Icon: ShieldCheck },
  light:      { label: "Intervenção leve",     tone: "border-warning/40 bg-warning/5 text-warning",                Icon: Activity },
  moderate:   { label: "Intervenção moderada", tone: "border-warning/60 bg-warning/10 text-warning",               Icon: Zap },
  structural: { label: "Reciclagem estrutural", tone: "border-destructive/40 bg-destructive/5 text-destructive",   Icon: RotateCcw },
};

function EditorialBanner({
  diag,
  onRediagnose,
  running,
}: {
  diag: Diagnosis;
  onRediagnose: () => void;
  running: boolean;
}) {
  const mode = diag.raw?.recommendation_mode ?? "light";
  const state = diag.raw?.curatorial_state;
  const justification = diag.raw?.editorial_justification ?? "";
  const caps = diag.raw?.applied_caps;
  const cooldowns = diag.raw?.active_cooldowns ?? [];
  const meta = MODE_META[mode] ?? MODE_META.light;
  const Icon = meta.Icon;

  return (
    <Card className={cn("p-3 md:p-4 border", meta.tone)}>
      <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-5">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={cn("h-8 w-8 rounded-lg border grid place-items-center shrink-0", meta.tone)}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 space-y-0.5 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Modo curatorial</span>
              <span className="text-sm font-bold leading-none">{meta.label}</span>
              {state && <CuratorialStateBadge state={state} compact />}
            </div>
            {mode === "hold" ? (
              <p className="text-xs font-medium text-foreground">
                Nenhuma alteração recomendada agora. {justification}
              </p>
            ) : (
              <p className="text-xs text-foreground/90 leading-snug line-clamp-2">{justification}</p>
            )}
            {caps && mode !== "hold" && (
              <p className="text-[11px] text-muted-foreground tabular-nums">
                Limite deste ciclo: <span className="text-foreground font-semibold">{caps.max_changes}</span> faixas ({caps.max_change_pct}%)
                {caps.original_suggestions > caps.capped_suggestions && (
                  <> · {caps.original_suggestions - caps.capped_suggestions} suprimidas</>
                )}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 md:items-end shrink-0">
          {cooldowns.length > 0 && (
            <div className="flex flex-wrap gap-1.5 md:justify-end">
              {cooldowns.map((c) => (
                <CooldownChip key={c.action_type} action={c.action_type} daysRemaining={c.days_remaining} />
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant={mode === "hold" ? "outline" : "default"}
            onClick={onRediagnose}
            disabled={running}
            className="gap-1.5"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Reavaliar
          </Button>
        </div>
      </div>

      {mode === "hold" && cooldowns.length === 0 && (
        <div className="mt-4 pt-4 border-t border-current/10 flex items-start gap-2 text-[12px] text-muted-foreground">
          <Heart className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
          <span>Playlist madura. O melhor movimento agora é <span className="text-foreground font-medium">observar resultados</span> e deixar o algoritmo do Spotify maturar.</span>
        </div>
      )}
    </Card>
  );
}

