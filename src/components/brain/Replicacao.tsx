// Replicação manual — separado em 2 componentes:
//   <Variacoes>  : Fase 2 da aba — playlists prontas (lista única, filtro por status, ações inline)
//   <Moldes>     : Fase 3 da aba — blueprints compactos (1 linha cada, ações: gerar +5)
// Mesma lógica de antes, sem accordion gigante. Cada componente carrega seu próprio dado.
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Loader2, Sparkles, Wand2, Layers, CheckCircle2, XCircle, Clock, Trash2,
  ExternalLink, Music2, AlertTriangle, ChevronDown, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import { LoadMore, usePagination } from "@/components/LoadMore";
import { AutopilotButton } from "@/components/brain/AutopilotButton";

type Blueprint = {
  id: string;
  genre_id: string;
  tier: string;
  name: string;
  slug: string;
  name_pattern: string | null;
  format: string | null;
  mood: string | null;
  source_playlists: any[];
  sample_size: number;
  confidence: string;
  notes: string | null;
  replication_score: number;
  status: string;
  updated_at: string;
  performance_source: string | null;
  replication_priority: string;
  replication_reason: string | null;
};

type Template = {
  id: string;
  blueprint_id: string;
  variation_index: number;
  name: string;
  description: string | null;
  cover_brief: string | null;
  track_seeds: any[];
  keywords: any[];
  replication_score: number;
  status: string;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  spotify_playlist_id: string | null;
  spotify_url: string | null;
  tracks_added: number | null;
  tracks_failed: number | null;
  creation_error: string | null;
  created_on_spotify_at: string | null;
};

const TIER_LABEL: Record<string, string> = { mega: "Mega", big: "Big", medium: "Médio", small: "Small" };
const TIER_HINT: Record<string, string> = {
  mega: "≥100k",
  big: "10k–100k",
  medium: "1k–10k",
  small: "<1k",
};

const STATUS_META: Record<string, { label: string; cls: string; icon: any }> = {
  pending:  { label: "Pendente",  cls: "bg-warning/15 text-warning border-warning/30",       icon: Clock },
  approved: { label: "Aprovado",  cls: "bg-primary/15 text-primary border-primary/30",       icon: CheckCircle2 },
  rejected: { label: "Rejeitado", cls: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle },
  created:  { label: "No Spotify",cls: "bg-success/15 text-success border-success/30", icon: CheckCircle2 },
};

const FILTERS: { v: string; label: string }[] = [
  { v: "all",      label: "Todas" },
  { v: "pending",  label: "Pendentes" },
  { v: "approved", label: "Aprovadas" },
  { v: "created",  label: "No Spotify" },
  { v: "rejected", label: "Rejeitadas" },
];

/* ============================================================================
 *  VARIAÇÕES — Fase 2: lista única de playlists prontas pra publicar
 * ============================================================================ */

export function Variacoes({ genreId }: { genreId?: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async (showSkeleton = false) => {
    if (!genreId) return;
    if (showSkeleton) setLoading(true);
    const { data: bps } = await supabase
      .from("playlist_blueprints")
      .select("*")
      .eq("genre_id", genreId)
      .order("replication_score", { ascending: false });
    const bpList = (bps ?? []) as Blueprint[];
    setBlueprints(bpList);
    if (bpList.length > 0) {
      const ids = bpList.map(b => b.id);
      const { data: tps } = await supabase
        .from("playlist_templates")
        .select("*")
        .in("blueprint_id", ids)
        .order("created_at", { ascending: false });
      setTemplates((tps ?? []) as Template[]);
    } else {
      setTemplates([]);
    }
    setLoading(false);
    setHasLoadedOnce(true);
  };

  useEffect(() => {
    setHasLoadedOnce(false);
    load(true);
    /* eslint-disable-next-line */
  }, [genreId]);

  const updateStatus = async (id: string, status: "approved" | "rejected" | "pending") => {
    const patch: any = { status };
    if (status === "approved") patch.approved_at = new Date().toISOString();
    if (status !== "approved") patch.approved_at = null;
    const { error } = await supabase.from("playlist_templates").update(patch).eq("id", id);
    if (error) { toast.error("Erro ao atualizar"); return; }
    toast.success(status === "approved" ? "Aprovada" : status === "rejected" ? "Rejeitada" : "Pendente");
    if (status === "approved") {
      const tpl: any = templates.find(x => x.id === id);
      if (tpl && !(tpl as any).cover_image_url && !((tpl as any).cover_variations?.length)) {
        supabase.functions.invoke("generate-cover-variations", { body: { template_id: id } })
          .then(({ error }) => { if (!error) toast.success("Capas sendo geradas em background"); })
          .catch(() => {});
      }
    }
    await load(false);
  };

  const removeTemplate = async (id: string) => {
    const { error } = await supabase.from("playlist_templates").delete().eq("id", id);
    if (error) { toast.error("Erro"); return; }
    toast.success("Removida");
    await load(false);
  };

  const createOnSpotify = async (id: string) => {
    setCreating(id);
    try {
      const { data, error } = await supabase.functions.invoke("create-spotify-playlist", {
        body: { template_id: id, public: true },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data?.error ?? "Falha ao criar");
      toast.success("Publicada no Spotify", {
        description: `${data?.tracks_added ?? 0} faixas · ${data?.tracks_failed ?? 0} falhas`,
        action: data?.spotify_url ? { label: "Abrir", onClick: () => window.open(data.spotify_url, "_blank") } : undefined,
      });
      await load(false);
    } catch (e: any) {
      const msg = e?.message ?? "Erro";
      toast.error("Erro ao criar", {
        description: msg.includes("Nenhuma conta") ? "Conecte uma conta Spotify em Operação." : msg,
      });
    } finally {
      setCreating(null);
    }
  };

  const bpMap = useMemo(() => new Map(blueprints.map(b => [b.id, b])), [blueprints]);

  const counts = useMemo(() => ({
    all: templates.length,
    pending: templates.filter(t => t.status === "pending").length,
    approved: templates.filter(t => t.status === "approved").length,
    created: templates.filter(t => t.status === "created" || !!t.spotify_playlist_id).length,
    rejected: templates.filter(t => t.status === "rejected").length,
  }), [templates]);

  const filtered = useMemo(() => {
    if (filter === "all") return templates;
    if (filter === "created") return templates.filter(t => t.status === "created" || !!t.spotify_playlist_id);
    return templates.filter(t => t.status === filter);
  }, [templates, filter]);

  if (loading && !hasLoadedOnce) return <div className="grid gap-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="nx-card h-16 animate-pulse" />)}</div>;

  if (templates.length === 0) {
    return (
      <div className="nx-card p-8 text-center space-y-2">
        <Wand2 className="h-7 w-7 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Nenhuma variação gerada ainda. Vá nos <strong>Moldes</strong> abaixo e clique em <em>Gerar +5</em>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map(f => {
          const c = (counts as any)[f.v] ?? 0;
          const active = filter === f.v;
          return (
            <button
              key={f.v}
              onClick={() => setFilter(f.v)}
              className={cn(
                "text-xs px-3 py-1.5 rounded-full border transition-colors tabular-nums",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-elevated border-border text-muted-foreground hover:text-foreground hover:border-foreground/40",
              )}
            >
              {f.label} <span className="opacity-70">·{c}</span>
            </button>
          );
        })}
      </div>

      {/* Lista */}
      <VariacoesList
        filtered={filtered}
        bpMap={bpMap}
        expanded={expanded}
        creating={creating}
        setExpanded={setExpanded}
        updateStatus={updateStatus}
        removeTemplate={removeTemplate}
        createOnSpotify={createOnSpotify}
      />
    </div>
  );
}

function VariacoesList({
  filtered, bpMap, expanded, creating,
  setExpanded, updateStatus, removeTemplate, createOnSpotify,
}: {
  filtered: Template[];
  bpMap: Map<string, Blueprint>;
  expanded: Set<string>;
  creating: string | null;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  updateStatus: (id: string, status: "approved" | "rejected" | "pending") => void;
  removeTemplate: (id: string) => void;
  createOnSpotify: (id: string) => void;
}) {
  const { visibleItems, hasMore, canCollapse, loadMore, collapse, total, visible } = usePagination(filtered, 20, filtered);

  if (filtered.length === 0) {
    return (
      <div className="nx-card p-8 text-center text-sm text-muted-foreground">
        Nenhuma variação com esse filtro.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {visibleItems.map(t => (
          <VariationRow
            key={t.id}
            t={t}
            bp={bpMap.get(t.blueprint_id)}
            expanded={expanded.has(t.id)}
            creating={creating === t.id}
            onToggle={() => setExpanded(prev => {
              const n = new Set(prev);
              if (n.has(t.id)) n.delete(t.id); else n.add(t.id);
              return n;
            })}
            onApprove={() => updateStatus(t.id, "approved")}
            onReject={() => updateStatus(t.id, "rejected")}
            onReset={() => updateStatus(t.id, "pending")}
            onDelete={() => removeTemplate(t.id)}
            onCreate={() => createOnSpotify(t.id)}
          />
        ))}
      </div>
      <LoadMore visible={visible} total={total} hasMore={hasMore} canCollapse={canCollapse} onLoadMore={loadMore} onCollapse={collapse} itemLabel="variações" />
    </>
  );
}

function VariationRow({ t, bp, expanded, creating, onToggle, onApprove, onReject, onReset, onDelete, onCreate }: {
  t: Template;
  bp?: Blueprint;
  expanded: boolean;
  creating: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onReset: () => void;
  onDelete: () => void;
  onCreate: () => void;
}) {
  const status = t.status === "created" || t.spotify_playlist_id ? "created" : t.status;
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  const Icon = meta.icon;
  const isCreated = !!t.spotify_playlist_id;

  return (
    <div className="nx-card !p-0 overflow-hidden">
      {/* Linha principal */}
      <div className="flex items-center gap-3 p-3 hover:bg-elevated/30 transition-colors">
        <button onClick={onToggle} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h5 className="font-semibold text-sm truncate">{t.name}</h5>
            <span className={cn("inline-flex items-center gap-1 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border", meta.cls)}>
              <Icon className="h-3 w-3" /> {meta.label}
            </span>
            <ScoreBadge score={Number(t.replication_score)} />
          </div>
          {bp && (
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
              molde: <span className="text-foreground/75">{bp.name}</span> · {TIER_LABEL[bp.tier] ?? bp.tier}
            </div>
          )}
        </div>

        {/* Ações inline */}
        <div className="flex items-center gap-1 shrink-0">
          {isCreated && t.spotify_url && (
            <a href={t.spotify_url} target="_blank" rel="noreferrer"
               className="h-8 px-3 text-xs inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 text-success hover:bg-success/20">
              <Music2 className="h-3 w-3" /> Abrir <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
          {!isCreated && status === "approved" && (
            <Button size="sm" onClick={onCreate} disabled={creating} className="h-8 px-3 text-xs">
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Music2 className="h-3 w-3" />}
              Criar no Spotify
            </Button>
          )}
          {!isCreated && status === "pending" && (
            <Button size="sm" onClick={onApprove} variant="outline" className="h-8 px-3 text-xs">
              <CheckCircle2 className="h-3 w-3" /> Aprovar
            </Button>
          )}
          {!isCreated && status !== "rejected" && (
            <Button size="sm" variant="ghost" onClick={onReject} className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive">
              <XCircle className="h-3 w-3" />
            </Button>
          )}
          {!isCreated && (status === "approved" || status === "rejected") && (
            <Button size="sm" variant="ghost" onClick={onReset} className="h-8 px-2 text-[10px] text-muted-foreground">
              Reset
            </Button>
          )}
          {!isCreated && (
            <Button size="sm" variant="ghost" onClick={onDelete} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive">
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Detalhes expandidos */}
      {expanded && (
        <div className="border-t border-border bg-elevated/20 p-4 space-y-3">
          {isCreated && (
            <div className="text-[11px] flex items-center gap-3 px-2 py-1.5 rounded bg-success/5 border border-success/20 text-success">
              <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Criada no Spotify</span>
              <span className="text-muted-foreground">·</span>
              <span>{t.tracks_added ?? 0} faixas adicionadas</span>
              {(t.tracks_failed ?? 0) > 0 && <span className="text-warning">{t.tracks_failed} não encontradas</span>}
              {t.created_on_spotify_at && <span className="text-muted-foreground ml-auto">{timeAgo(t.created_on_spotify_at)}</span>}
            </div>
          )}

          {t.creation_error && !isCreated && (
            <div className="text-[11px] flex items-start gap-1.5 px-2 py-1.5 rounded bg-destructive/10 border border-destructive/30 text-destructive">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" /><span>{t.creation_error}</span>
            </div>
          )}

          {t.description && <p className="text-xs text-foreground/80">{t.description}</p>}

          {t.cover_brief && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">Brief de capa</div>
              <p className="text-xs p-2.5 rounded bg-primary/5 border border-primary/20 text-foreground/85">{t.cover_brief}</p>
            </div>
          )}

          {t.keywords?.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1.5">Keywords</div>
              <div className="flex flex-wrap gap-1">
                {t.keywords.slice(0, 12).map((k: any, i: number) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-elevated border border-border">{String(k)}</span>
                ))}
              </div>
            </div>
          )}

          {t.track_seeds?.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1.5">{t.track_seeds.length} faixas-semente</div>
              <div className="space-y-0.5 max-h-48 overflow-y-auto nx-scroll">
                {t.track_seeds.slice(0, 30).map((s: any, i: number) => (
                  <div key={i} className="text-xs flex gap-2 py-0.5">
                    <span className="text-muted-foreground tabular-nums w-5">{i + 1}</span>
                    <span className="font-medium truncate">{s.nome}</span>
                    <span className="text-muted-foreground truncate">— {s.artista}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 *  MOLDES — Fase 3: lista compacta de blueprints, 1 linha cada
 * ============================================================================ */

// Cota padrão de variações por molde — evita gerar duplicado / queimar crédito de IA.
// Pode ser ajustada por molde no futuro (regra de replicação).
const COTA_POR_MOLDE = 5;

type TplStats = { total: number; published: number; pending: number };

export function Moldes({ genreId, onAfterGenerate, hideEmpty = false }: { genreId?: string; onAfterGenerate?: () => void; hideEmpty?: boolean }) {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [tplStats, setTplStats] = useState<Record<string, TplStats>>({});
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [showSaturated, setShowSaturated] = useState(false);

  const load = async (showSkeleton = false) => {
    if (!genreId) return;
    if (showSkeleton) setLoading(true);
    const { data: bps } = await supabase
      .from("playlist_blueprints")
      .select("*")
      .eq("genre_id", genreId)
      .order("replication_score", { ascending: false });
    const list = (bps ?? []) as Blueprint[];
    setBlueprints(list);
    if (list.length > 0) {
      const ids = list.map(b => b.id);
      const { data: tps } = await supabase
        .from("playlist_templates")
        .select("blueprint_id, status, spotify_playlist_id")
        .in("blueprint_id", ids);
      const stats: Record<string, TplStats> = {};
      for (const t of (tps ?? []) as any[]) {
        const s = stats[t.blueprint_id] ?? { total: 0, published: 0, pending: 0 };
        s.total += 1;
        if (t.spotify_playlist_id || t.status === "created") s.published += 1;
        if (t.status === "pending") s.pending += 1;
        stats[t.blueprint_id] = s;
      }
      setTplStats(stats);
    } else {
      setTplStats({});
    }
    setLoading(false);
    setHasLoadedOnce(true);
  };

  useEffect(() => {
    // Mostra skeleton só no primeiro load por gênero. Recarregamentos posteriores
    // (depois de gerar/extrair) atualizam silenciosamente sem piscar.
    setHasLoadedOnce(false);
    load(true);
    /* eslint-disable-next-line */
  }, [genreId]);

  const runExtract = async () => {
    if (!genreId || extracting) return;
    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-blueprints", {
        body: { genre_id: genreId, max_per_tier: 5 },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data?.error ?? "Falha");
      toast.success(`${data?.total ?? 0} moldes`, {
        description: `${data?.created?.length ?? 0} novos · ${data?.updated?.length ?? 0} atualizados`,
      });
      await load(false);
    } catch (e: any) {
      toast.error("Erro ao atualizar moldes", { description: e?.message });
    } finally {
      setExtracting(false);
    }
  };

  const runGenerate = async (bpId: string) => {
    setGenerating(bpId);
    try {
      const { data, error } = await supabase.functions.invoke("generate-templates", {
        body: { blueprint_id: bpId, count: 5 },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data?.error ?? "Falha");
      toast.success(`${data?.count ?? 0} variações geradas`, {
        description: "Veja na seção 'Playlists prontas' acima.",
      });
      await load(false);
      onAfterGenerate?.();
    } catch (e: any) {
      toast.error("Erro ao gerar", { description: e?.message });
    } finally {
      setGenerating(null);
    }
  };

  // Separa moldes em "ativos" (ainda dentro da cota) e "saturados" (já cumpriram)
  const { active, saturated } = useMemo(() => {
    const a: Blueprint[] = [];
    const s: Blueprint[] = [];
    for (const bp of blueprints) {
      const stat = tplStats[bp.id] ?? { total: 0, published: 0, pending: 0 };
      if (stat.total >= COTA_POR_MOLDE) s.push(bp);
      else a.push(bp);
    }
    return { active: a, saturated: s };
  }, [blueprints, tplStats]);

  const visibleSaturated = hideEmpty || showSaturated ? saturated : [];

  if (loading && !hasLoadedOnce) return <div className="grid gap-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="nx-card h-14 animate-pulse" />)}</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AutopilotButton
          genreId={genreId}
          onComplete={() => { load(); onAfterGenerate?.(); }}
        />
        <Button size="sm" variant="outline" onClick={runExtract} disabled={extracting || !genreId}>
          {extracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {blueprints.length > 0 ? "Atualizar moldes" : "Extrair moldes"}
        </Button>
      </div>

      {blueprints.length === 0 ? (
        <div className="nx-card p-8 text-center space-y-2">
          <Layers className="h-7 w-7 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nenhum molde extraído. Clique em <strong>Extrair moldes</strong> pra começar.
          </p>
        </div>
      ) : (
        <>
          {/* Resumo do funil */}
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
            <span><strong className="text-foreground">{blueprints.length}</strong> moldes</span>
            <span>·</span>
            <span><strong className="text-foreground">{active.length}</strong> pendentes</span>
            <span>·</span>
            <span><strong className="text-success">{saturated.length}</strong> com cota cheia</span>
          </div>

          {/* Ativos — ainda precisam gerar */}
          {active.length > 0 && (
            <div className="space-y-1.5">
              {active.map(bp => (
                <BlueprintRow
                  key={bp.id}
                  bp={bp}
                  stats={tplStats[bp.id] ?? { total: 0, published: 0, pending: 0 }}
                  generating={generating === bp.id}
                  onGenerate={() => runGenerate(bp.id)}
                />
              ))}
            </div>
          )}

          {/* Saturados — colapsável */}
          {saturated.length > 0 && !hideEmpty && (
            <button
              onClick={() => setShowSaturated(v => !v)}
              className="w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1.5 py-2 border-t border-border/50"
            >
              {showSaturated ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {showSaturated ? "Esconder" : "Mostrar"} {saturated.length} {saturated.length === 1 ? "molde já saturado" : "moldes já saturados"}
            </button>
          )}

          {visibleSaturated.length > 0 && (
            <div className="space-y-1.5 opacity-70">
              {visibleSaturated.map(bp => (
                <BlueprintRow
                  key={bp.id}
                  bp={bp}
                  stats={tplStats[bp.id] ?? { total: 0, published: 0, pending: 0 }}
                  generating={generating === bp.id}
                  onGenerate={() => runGenerate(bp.id)}
                />
              ))}
            </div>
          )}

          {active.length === 0 && saturated.length > 0 && !showSaturated && !hideEmpty && (
            <div className="nx-card p-6 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="h-6 w-6 mx-auto text-success mb-2" />
              Todos os moldes já têm variações suficientes. Aprove e publique na seção <strong>Variações</strong> acima.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BlueprintRow({ bp, stats, generating, onGenerate }: {
  bp: Blueprint;
  stats: TplStats;
  generating: boolean;
  onGenerate: () => void;
}) {
  const tierLabel = TIER_LABEL[bp.tier] ?? bp.tier;
  const reasonTooltip = [
    bp.replication_reason,
    bp.replication_priority && `Prioridade: ${bp.replication_priority}`,
    bp.confidence && `Confiança: ${bp.confidence}`,
    bp.performance_source && `Performance: ${bp.performance_source}`,
  ].filter(Boolean).join(" · ");

  const saturated = stats.total >= COTA_POR_MOLDE;
  const progressPct = Math.min(100, (stats.total / COTA_POR_MOLDE) * 100);

  return (
    <div className="nx-card !p-3 flex items-center gap-3 hover:border-foreground/20 transition-colors">
      <div className="flex items-center gap-2 shrink-0" title={`${tierLabel} · ${TIER_HINT[bp.tier] ?? ""}`}>
        <Layers className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-elevated border border-border tabular-nums">
          {tierLabel}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h5 className="font-semibold text-sm truncate">{bp.name}</h5>
          <ScoreBadge score={Number(bp.replication_score)} />
        </div>
        <div className="text-[11px] text-muted-foreground truncate" title={reasonTooltip}>
          {bp.format ?? "—"}{bp.mood ? ` · ${bp.mood}` : ""} · {bp.sample_size} playlists · {timeAgo(bp.updated_at)}
        </div>
      </div>

      {/* Progresso da cota */}
      <div className="hidden sm:flex flex-col items-end gap-1 shrink-0 w-24">
        <div className="text-[10px] tabular-nums text-muted-foreground">
          <span className={cn("font-bold", saturated ? "text-success" : "text-foreground")}>{stats.total}</span>
          <span>/{COTA_POR_MOLDE}</span>
          {stats.published > 0 && <span className="text-success ml-1">· {stats.published} pub</span>}
        </div>
        <div className="h-1 w-full rounded-full bg-elevated overflow-hidden">
          <div
            className={cn("h-full transition-all", saturated ? "bg-success" : "bg-primary")}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {saturated ? (
          <Button
            size="sm"
            variant="outline"
            disabled
            className="h-8 px-3 text-xs gap-1.5 cursor-not-allowed"
            title="Cota cheia. Vá em 'Variações' para aprovar/publicar antes de gerar mais."
          >
            <CheckCircle2 className="h-3 w-3 text-success" />
            Cota cheia
          </Button>
        ) : (
          <Button size="sm" onClick={onGenerate} disabled={generating} className="h-8 px-3 text-xs">
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
            Gerar +{Math.min(5, COTA_POR_MOLDE - stats.total)}
          </Button>
        )}
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 80 ? "bg-primary/20 text-primary border-primary/30"
    : score >= 60 ? "bg-warning/15 text-warning border-warning/30"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded border tabular-nums shrink-0", tone)}>
      score {Math.round(score)}
    </span>
  );
}
