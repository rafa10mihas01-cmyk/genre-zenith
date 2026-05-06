import { useEffect, useMemo, useState } from "react";
import {
  Sparkles, Flame, AlertTriangle, Archive, RefreshCw, Loader2,
  Check, Music2, ExternalLink, AlertCircle, ChevronDown, ChevronRight,
  Send, Image as ImageIcon, Pencil, Play, Inbox, Clock, Search, X, Wand2, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { KpiBig } from "@/components/KpiBig";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { LoadMore, usePagination } from "@/components/LoadMore";
import { useSetSidebarKpis } from "@/contexts/SidebarContext";

/**
 * CRIAÇÃO — Cockpit de Execução.
 *
 * Princípio: o sistema decide, o usuário valida em poucos cliques.
 *
 *   🔥 Hot   (score ≥ 75) → fluxo 2 cliques (Capa → Publicar). Capas auto-geradas.
 *   ⚠️ Médio (45-74)      → fluxo 3 cliques (Aprovar → Capa → Publicar).
 *   📦 Arquivado (<45)    → seção colapsada no fim, ruído zero.
 *
 * Conta Spotify é auto-selecionada (a com mais espaço disponível).
 */

type Template = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  replication_score: number;
  final_score: number;
  quality_tier: "hot" | "medium" | "weak" | "archived";
  score_breakdown: Record<string, number> | null;
  cover_brief: string | null;
  cover_image_url: string | null;
  cover_variations: Array<{ index: number; url: string; palette?: string; style?: string }> | null;
  cover_selected_index: number | null;
  cover_generated_at: string | null;
  auto_cover_requested: boolean;
  spotify_playlist_id: string | null;
  spotify_url: string | null;
  spotify_owner_id: string | null;
  track_seeds: Array<{ nome: string; artista: string; spotify_track_id?: string }> | null;
  tracks_added: number;
  tracks_failed: number;
  creation_error: string | null;
  created_on_spotify_at: string | null;
  genre_id: string;
  blueprint_id: string;
  created_at: string;
  genres?: { id: string; nome: string } | null;
};

type SortKey = "score_desc" | "score_asc" | "recent" | "alpha" | "genre";
type StatusFilter = "all" | "no_cover" | "with_cover" | "with_error";

function getCoverGenerationErrorMessage(error: any, data: any) {
  const code = data?.code;
  if (code === "AI_PAYMENT_REQUIRED") {
    return "Sem créditos de IA. Adicione saldo em Settings → Workspace → Usage.";
  }
  if (code === "AI_RATE_LIMITED") {
    return "Muitas requisições. Aguarde alguns segundos e tente de novo.";
  }
  return data?.error || error?.message || "Erro desconhecido";
}

export default function Criacao() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [expiring, setExpiring] = useState(false);
  const [batchCovers, setBatchCovers] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<Template | null>(null);
  // IDs de templates atualmente gerando capa (mostra overlay no card correto)
  const [generatingCoverIds, setGeneratingCoverIds] = useState<Set<string>>(new Set());
  const markGenerating = (id: string, on: boolean) => {
    setGeneratingCoverIds(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };

  // Toolbar state
  const [search, setSearch] = useState("");
  const [genreFilter, setGenreFilter] = useState<string | null>(null); // null = todos
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("score_desc");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("playlist_templates")
      .select("id,name,description,status,replication_score,final_score,quality_tier,score_breakdown,cover_brief,cover_image_url,cover_variations,cover_selected_index,cover_generated_at,auto_cover_requested,spotify_playlist_id,spotify_url,spotify_owner_id,track_seeds,tracks_added,tracks_failed,creation_error,created_on_spotify_at,genre_id,blueprint_id,created_at")
      .in("status", ["pending", "approved", "created", "archived"])
      .order("final_score", { ascending: false })
      .limit(300);

    if (error) {
      toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
      setTemplates([]);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as any[];
    // Busca gêneros em separado (não há FK direta de playlist_templates pra genres)
    const genreIds = Array.from(new Set(rows.map(r => r.genre_id).filter(Boolean)));
    let genreMap = new Map<string, { id: string; nome: string }>();
    if (genreIds.length > 0) {
      const { data: gData } = await supabase.from("genres").select("id,nome").in("id", genreIds);
      genreMap = new Map((gData ?? []).map(g => [g.id, g]));
    }

    const enriched = rows.map(r => ({ ...r, genres: genreMap.get(r.genre_id) ?? null }));
    setTemplates(enriched as any);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Sidebar KPIs: hot / médios / sem capa
  useSetSidebarKpis(
    templates.length > 0
      ? [
          {
            label: "Hot",
            value: templates.filter((t) => t.quality_tier === "hot").length,
            intent: "primary",
          },
          {
            label: "Médios",
            value: templates.filter((t) => t.quality_tier === "medium").length,
            intent: "warning",
          },
          {
            label: "Sem capa",
            value: templates.filter(
              (t) => !t.cover_image_url && !t.spotify_playlist_id && t.quality_tier !== "archived",
            ).length,
            intent: "danger",
          },
        ]
      : [],
  );

  async function rescoreAll() {
    setScoring(true);
    const { data, error } = await supabase.functions.invoke("score-templates", {
      body: { force: true },
    });
    setScoring(false);
    if (error || !(data as any)?.ok) {
      toast({ title: "Falha ao pontuar", description: error?.message || (data as any)?.error || "Erro", variant: "destructive" });
      return;
    }
    const b = (data as any).breakdown;
    const cap = (data as any).cap;
    toast({
      title: `Ranqueamento concluído`,
      description: `🔥 ${b.hot} (cap ${Math.round((cap?.pct ?? 0.3) * 100)}% = max ${cap?.max_allowed ?? "?"}) • ⚠️ ${b.medium} • ❌ ${b.weak}`,
    });
    await load();
  }

  async function expireStale() {
    setExpiring(true);
    const { data, error } = await supabase.functions.invoke("expire-stale-templates", {
      body: { hours: 72 },
    });
    setExpiring(false);
    if (error || !(data as any)?.ok) {
      toast({ title: "Falha ao expirar", description: error?.message || (data as any)?.error || "Erro", variant: "destructive" });
      return;
    }
    const n = (data as any).expired ?? 0;
    toast({
      title: n > 0 ? `${n} médios expirados` : "Nada pra expirar",
      description: n > 0 ? "Templates ⚠️ parados há 72h foram arquivados." : "Nenhum template medium ultrapassou 72h.",
    });
    await load();
  }

  // ─── Lista de gêneros disponíveis (chips) ───
  const availableGenres = useMemo(() => {
    const map = new Map<string, { id: string; nome: string; count: number }>();
    for (const t of templates) {
      const g = t.genres;
      if (!g?.id) continue;
      const cur = map.get(g.id);
      if (cur) cur.count++;
      else map.set(g.id, { id: g.id, nome: g.nome, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [templates]);

  // ─── Filtra + ordena (aplicado a todos os grupos) ───
  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = templates.filter(t => {
      if (q && !t.name.toLowerCase().includes(q)) return false;
      if (genreFilter && t.genre_id !== genreFilter) return false;
      if (statusFilter === "no_cover" && t.cover_image_url) return false;
      if (statusFilter === "with_cover" && !t.cover_image_url) return false;
      if (statusFilter === "with_error" && !t.creation_error) return false;
      return true;
    });
    arr = [...arr].sort((a, b) => {
      switch (sort) {
        case "score_asc":  return a.final_score - b.final_score;
        case "recent":     return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
        case "alpha":      return a.name.localeCompare(b.name);
        case "genre":      return (a.genres?.nome ?? "").localeCompare(b.genres?.nome ?? "");
        case "score_desc":
        default:           return b.final_score - a.final_score;
      }
    });
    return arr;
  }, [templates, search, genreFilter, statusFilter, sort]);

  // ─── grupos por tier (sobre o filtrado) ───
  const groups = useMemo(() => {
    const hot: Template[] = [];
    const medium: Template[] = [];
    const archived: Template[] = [];
    const published: Template[] = [];
    for (const t of filteredTemplates) {
      if (t.status === "created") published.push(t);
      else if (t.status === "archived" || t.quality_tier === "weak") archived.push(t);
      else if (t.quality_tier === "hot") hot.push(t);
      else medium.push(t);
    }
    return { hot, medium, archived, published };
  }, [filteredTemplates]);

  const kpi = useMemo(() => ({
    hot: groups.hot.length,
    medium: groups.medium.length,
    archived: groups.archived.length,
    published7d: (() => {
      const cutoff = Date.now() - 7 * 86400_000;
      return groups.published.filter(t => t.created_on_spotify_at && new Date(t.created_on_spotify_at).getTime() > cutoff).length;
    })(),
  }), [groups]);

  // Quantos hot estão sem capa (alvo da ação em lote)
  const hotMissingCovers = useMemo(
    () => groups.hot.filter(t => !t.cover_image_url && !t.auto_cover_requested),
    [groups.hot],
  );

  async function generateCoversBatch() {
    if (hotMissingCovers.length === 0) {
      toast({ title: "Nenhum hot sem capa", description: "Todos os prontos já têm capa selecionada." });
      return;
    }
    setBatchCovers(true);
    let ok = 0, fail = 0;
    for (const t of hotMissingCovers) {
      markGenerating(t.id, true);
      const { data, error } = await supabase.functions.invoke("generate-cover-variations", {
        body: { template_id: t.id },
      });
      markGenerating(t.id, false);
      if (error || !(data as any)?.ok) fail++;
      else ok++;
    }
    setBatchCovers(false);
    toast({
      title: `Capas geradas`,
      description: `✅ ${ok} sucesso${fail > 0 ? ` • ❌ ${fail} falha${fail > 1 ? "s" : ""}` : ""}`,
      variant: fail > 0 && ok === 0 ? "destructive" : "default",
    });
    await load();
  }

  // 🔄 Regenera capa do zero (force=true descarta variações antigas e gera nova).
  // Usado pra capas com "2024" antigo que precisam ser refeitas.
  // Bloqueado no backend pra playlists já publicadas no Spotify.
  async function regenerateCover(t: Template) {
    if (t.spotify_playlist_id) {
      toast({
        title: "Não é possível regenerar",
        description: "Esta playlist já está publicada no Spotify.",
        variant: "destructive",
      });
      return;
    }
    markGenerating(t.id, true);
    const { data, error } = await supabase.functions.invoke("generate-cover-variations", {
      body: { template_id: t.id, force: true },
    });
    markGenerating(t.id, false);
    if (error || !(data as any)?.ok) {
      toast({
        title: "Falha ao regenerar capa",
        description: getCoverGenerationErrorMessage(error, data),
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Capa regenerada", description: "Nova capa pronta — nome atualizado." });
    await load();
  }

  const hasFilters = !!search || !!genreFilter || statusFilter !== "all" || sort !== "score_desc";
  function clearFilters() {
    setSearch("");
    setGenreFilter(null);
    setStatusFilter("all");
    setSort("score_desc");
  }

  return (
    <PageContainer>
      <PageHeader
        title="Criação"
        subtitle="Gerar e preparar playlists"
        actions={
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="outline"
              className="rounded-full h-9 gap-1.5"
              onClick={expireStale}
              disabled={expiring}
              title="Arquiva templates ⚠️ médios parados há mais de 72h"
            >
              {expiring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
              <span className="hidden xl:inline">Expirar 72h</span>
            </Button>
            <Button
              variant="outline"
              className="rounded-full h-9 gap-1.5"
              onClick={rescoreAll}
              disabled={scoring}
            >
              {scoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span className="hidden xl:inline">Reranquear</span>
            </Button>
            <Button
              variant="premium"
              className="rounded-full h-9 gap-1.5"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              <span className="truncate">Atualizar</span>
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBig icon={Flame}         label="Prontos pra publicar" value={kpi.hot}        tone="primary" hint="Score ≥ 75" />
        <KpiBig icon={AlertTriangle} label="Médios"               value={kpi.medium}     tone="warning" hint="Precisam ajuste" />
        <KpiBig icon={Send}          label="Publicadas (7d)"      value={kpi.published7d} tone="primary" hint="Foram pro Spotify" />
        <KpiBig icon={Archive}       label="Arquivados"           value={kpi.archived}   hint="Auto-removidos" />
      </section>

      {/* TOOLBAR */}
      <Toolbar
        search={search} setSearch={setSearch}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        sort={sort} setSort={setSort}
        availableGenres={availableGenres}
        genreFilter={genreFilter} setGenreFilter={setGenreFilter}
        hasFilters={hasFilters} onClear={clearFilters}
        hotMissingCovers={hotMissingCovers.length}
        onBatchCovers={generateCoversBatch}
        batchCovers={batchCovers}
        totalShown={filteredTemplates.length}
        totalAll={templates.length}
      />

      {/* TABS — separa "trabalho do dia" do que já foi publicado/arquivado */}
      <Tabs defaultValue="work" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 h-11 bg-card/50 border border-border/50 p-1">
          <TabsTrigger value="work" className="gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
            <Flame className="h-4 w-4" />
            <span>Trabalho</span>
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] font-bold">
              {groups.hot.length + groups.medium.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="published" className="gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
            <Check className="h-4 w-4" />
            <span>Publicadas</span>
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] font-bold">
              {groups.published.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="archived" className="gap-2 data-[state=active]:bg-muted data-[state=active]:text-foreground">
            <Archive className="h-4 w-4" />
            <span>Arquivados</span>
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] font-bold">
              {groups.archived.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* ABA: TRABALHO (Hot + Médios) */}
        <TabsContent value="work" className="space-y-6 mt-6">
          <Section
            icon={Flame}
            iconClass="text-primary"
            title="🔥 Prontos pra publicar"
            subtitle="Score ≥ 75 — capas auto-geradas, fluxo de 2 cliques"
            count={groups.hot.length}
            emptyTitle={loading ? "Carregando…" : "Nenhum template pronto"}
            emptyMsg={loading ? "" : "Quando o Cérebro gerar templates fortes, eles aparecem aqui."}
          >
            <PagedTemplateGrid items={groups.hot} variant="hot" itemLabel="templates prontos" onOpen={setActiveTemplate} generatingIds={generatingCoverIds} onRegenerate={regenerateCover} />
          </Section>

          <Section
            icon={AlertTriangle}
            iconClass="text-warning"
            title="⚠️ Médios"
            subtitle="Precisam aprovação manual antes de publicar"
            count={groups.medium.length}
            emptyTitle={loading ? "" : "Sem médios pendentes"}
            emptyMsg=""
          >
            <PagedTemplateGrid items={groups.medium} variant="medium" itemLabel="templates médios" onOpen={setActiveTemplate} generatingIds={generatingCoverIds} onRegenerate={regenerateCover} />
          </Section>
        </TabsContent>

        {/* ABA: PUBLICADAS */}
        <TabsContent value="published" className="mt-6">
          {groups.published.length > 0 ? (
            <Section
              icon={Check}
              iconClass="text-primary"
              title="Publicadas"
              subtitle="No ar no Spotify"
              count={groups.published.length}
              emptyTitle=""
              emptyMsg=""
            >
              <PublishedGrid items={groups.published} onOpen={setActiveTemplate} />
            </Section>
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              <Check className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Nenhuma playlist publicada ainda.</p>
            </div>
          )}
        </TabsContent>

        {/* ABA: ARQUIVADOS */}
        <TabsContent value="archived" className="mt-6">
          {groups.archived.length > 0 ? (
            <ArchivedSection
              items={groups.archived}
              showArchived={true}
              setShowArchived={setShowArchived}
              onOpen={setActiveTemplate}
              onRegenerate={regenerateCover}
            />
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              <Archive className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Nada arquivado.</p>
            </div>
          )}
        </TabsContent>
      </Tabs>


      {/* DETAIL DIALOG */}
      <TemplateDetailDialog
        template={activeTemplate}
        onClose={() => setActiveTemplate(null)}
        onChanged={async () => { await load(); }}
        onGeneratingChange={markGenerating}
      />
    </PageContainer>
  );
}

/* ───────────────── Toolbar (busca, gênero, filtro, ordenação, ação em lote) ───────────────── */

const SORT_LABELS: Record<SortKey, string> = {
  score_desc: "Score (maior)",
  score_asc:  "Score (menor)",
  recent:     "Mais recentes",
  alpha:      "Alfabético",
  genre:      "Por gênero",
};

const STATUS_LABELS: Record<StatusFilter, string> = {
  all:        "Todos",
  no_cover:   "Sem capa",
  with_cover: "Com capa",
  with_error: "Com erro",
};

function Toolbar({
  search, setSearch,
  statusFilter, setStatusFilter,
  sort, setSort,
  availableGenres, genreFilter, setGenreFilter,
  hasFilters, onClear,
  hotMissingCovers, onBatchCovers, batchCovers,
  totalShown, totalAll,
}: {
  search: string; setSearch: (v: string) => void;
  statusFilter: StatusFilter; setStatusFilter: (v: StatusFilter) => void;
  sort: SortKey; setSort: (v: SortKey) => void;
  availableGenres: { id: string; nome: string; count: number }[];
  genreFilter: string | null; setGenreFilter: (v: string | null) => void;
  hasFilters: boolean; onClear: () => void;
  hotMissingCovers: number; onBatchCovers: () => void; batchCovers: boolean;
  totalShown: number; totalAll: number;
}) {
  return (
    <section className="nx-card space-y-3">
      {/* Linha 1: busca + filtros + ordenação + ação em lote */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Busca */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome do template…"
            className="pl-9 pr-9 h-9 rounded-full"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full hover:bg-elevated flex items-center justify-center"
              aria-label="Limpar busca"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Status segmented */}
        <div className="inline-flex items-center bg-elevated border border-border rounded-full p-0.5 h-9">
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((k) => (
            <button
              key={k}
              onClick={() => setStatusFilter(k)}
              className={cn(
                "px-3 h-8 rounded-full text-[11px] font-semibold transition-colors",
                statusFilter === k
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {STATUS_LABELS[k]}
            </button>
          ))}
        </div>

        {/* Ordenação */}
        <div className="relative">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="appearance-none h-9 rounded-full bg-elevated border border-border px-3 pr-8 text-[12px] font-semibold text-foreground hover:bg-card cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        </div>

        {/* Limpar filtros */}
        {hasFilters && (
          <Button
            onClick={onClear}
            variant="ghost"
            size="sm"
            className="rounded-full h-9 gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Limpar
          </Button>
        )}

        <div className="flex-1" />

        {/* Ação em lote */}
        <Button
          onClick={onBatchCovers}
          disabled={batchCovers || hotMissingCovers === 0}
          variant={hotMissingCovers > 0 ? "premium" : "outline"}
          size="sm"
          className="rounded-full h-9 gap-1.5"
          title={hotMissingCovers === 0
            ? "Todos os templates 🔥 já têm capa"
            : `Gera capas pra ${hotMissingCovers} template${hotMissingCovers > 1 ? "s" : ""} 🔥 sem capa`}
        >
          {batchCovers ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Gerar capas pendentes {hotMissingCovers > 0 ? `(${hotMissingCovers})` : ""}
        </Button>
      </div>

      {/* Linha 2: chips de gênero + contador */}
      {availableGenres.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mr-1">Gênero:</span>
          <button
            onClick={() => setGenreFilter(null)}
            className={cn(
              "px-3 h-7 rounded-full text-[11px] font-semibold transition-colors border",
              genreFilter === null
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-elevated text-muted-foreground border-border hover:text-foreground",
            )}
          >
            Todos
          </button>
          {availableGenres.map((g) => (
            <button
              key={g.id}
              onClick={() => setGenreFilter(genreFilter === g.id ? null : g.id)}
              className={cn(
                "px-3 h-7 rounded-full text-[11px] font-semibold transition-colors border inline-flex items-center gap-1.5 capitalize",
                genreFilter === g.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-elevated text-muted-foreground border-border hover:text-foreground",
              )}
            >
              {g.nome}
              <span className={cn(
                "tabular-nums text-[10px] px-1 rounded",
                genreFilter === g.id ? "bg-primary-foreground/20" : "bg-background/60",
              )}>{g.count}</span>
            </button>
          ))}
          <div className="flex-1" />
          <span className="text-[11px] text-muted-foreground tabular-nums">
            Mostrando <strong className="text-foreground">{totalShown}</strong> de {totalAll}
          </span>
        </div>
      )}
    </section>
  );
}

/* ───────────────── Section wrapper ───────────────── */

function Section({
  icon: Icon, iconClass, title, subtitle, count, emptyTitle, emptyMsg, children,
}: {
  icon: any; iconClass: string; title: string; subtitle: string; count: number;
  emptyTitle: string; emptyMsg: string; children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <div className={cn("h-9 w-9 rounded-full bg-elevated border border-border flex items-center justify-center")}>
          <Icon className={cn("h-4 w-4", iconClass)} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <span className="text-[11px] font-bold tabular-nums text-muted-foreground bg-elevated border border-border rounded-full px-2.5 h-6 inline-flex items-center">
          {count}
        </span>
      </div>
      {count === 0 ? (
        emptyTitle ? (
          <div className="nx-card text-center py-8">
            <div className="h-10 w-10 rounded-full bg-elevated border border-border mx-auto flex items-center justify-center">
              <Inbox className="h-4 w-4 text-muted-foreground" />
            </div>
            <h4 className="mt-3 font-semibold text-sm">{emptyTitle}</h4>
            {emptyMsg && <p className="text-xs text-muted-foreground mt-1.5 max-w-md mx-auto">{emptyMsg}</p>}
          </div>
        ) : null
      ) : children}
    </section>
  );
}

/* ───────────────── Template Card ───────────────── */

type CardVariant = "hot" | "medium" | "archived" | "published";

function TemplateCard({
  t, variant, onOpen, isGenerating = false, onRegenerate,
}: { t: Template; variant: CardVariant; onOpen: () => void; isGenerating?: boolean; onRegenerate?: (t: Template) => void | Promise<void> }) {
  const isHot = variant === "hot";
  const isPublished = variant === "published";
  const isArchived = variant === "archived";

  const tierBadge = isPublished ? (
    <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded text-[10px] font-bold text-primary bg-primary/15 border border-primary/40">
      <Check className="h-3 w-3" /> NO AR
    </span>
  ) : isHot ? (
    <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded text-[10px] font-bold text-primary bg-primary/15 border border-primary/40">
      🔥 HOT
    </span>
  ) : isArchived ? (
    <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded text-[10px] font-bold text-muted-foreground bg-muted/30 border border-border">
      📦 ARQUIVADO
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded text-[10px] font-bold text-warning bg-warning/15 border border-warning/40">
      ⚠️ MÉDIO
    </span>
  );

  const tracksCount = t.tracks_added > 0 ? t.tracks_added : (t.track_seeds?.length ?? 0);
  const score = Math.round(t.final_score);

  return (
    <div className={cn(
      "nx-card !p-0 overflow-hidden flex flex-col group transition-[transform,box-shadow,border-color] duration-200",
      isArchived && "opacity-60",
    )}>
      {/* Cover */}
      <button onClick={onOpen} className="relative aspect-square bg-elevated overflow-hidden">
        {t.cover_image_url ? (
          <img src={t.cover_image_url} alt="" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
        ) : isGenerating ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground gap-1.5">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-[9px] uppercase tracking-wider text-primary font-bold">Gerando capa…</span>
          </div>
        ) : t.cover_variations && t.cover_variations.length > 0 ? (
          <>
            <div className="grid grid-cols-2 grid-rows-2 w-full h-full">
              {t.cover_variations.slice(0, 4).map(v => {
                const ver = t.cover_generated_at ? new Date(t.cover_generated_at).getTime() : 0;
                const imgSrc = ver ? `${v.url}${v.url.includes("?") ? "&" : "?"}v=${ver}` : v.url;
                return <img key={v.index} src={imgSrc} alt="" className="w-full h-full object-cover" />;
              })}
            </div>
            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-1.5 h-4 rounded text-[9px] font-bold text-primary bg-background/85 backdrop-blur border border-primary/40">
              {t.cover_variations.length} variações
            </div>
          </>
        ) : t.auto_cover_requested ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground gap-1.5">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-[9px] uppercase tracking-wider text-primary font-bold">Gerando capa…</span>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground gap-1.5">
            <ImageIcon className="h-5 w-5" />
            <span className="text-[9px] uppercase tracking-wider">Sem capa</span>
          </div>
        )}
        {isGenerating && t.cover_image_url && (
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm flex flex-col items-center justify-center gap-1.5">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-[10px] uppercase tracking-wider text-primary font-bold">Gerando capa…</span>
          </div>
        )}
        <div className="absolute top-1.5 left-1.5">{tierBadge}</div>
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
          {/* 🔄 Regenerar capa — só pra não-publicadas, só quando tem capa pra refazer */}
          {onRegenerate && !isPublished && (t.cover_image_url || (t.cover_variations && t.cover_variations.length > 0)) && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (!isGenerating) onRegenerate(t); }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !isGenerating) {
                  e.stopPropagation(); e.preventDefault(); onRegenerate(t);
                }
              }}
              title="Regenerar capa (descarta a atual e gera uma nova)"
              aria-label="Regenerar capa"
              className={cn(
                "inline-flex items-center justify-center h-5 w-5 rounded text-foreground bg-background/85 backdrop-blur border border-border transition-colors cursor-pointer hover:bg-primary hover:text-primary-foreground hover:border-primary",
                isGenerating && "opacity-50 cursor-not-allowed",
              )}
            >
              {isGenerating ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Wand2 className="h-2.5 w-2.5" />}
            </span>
          )}
          <span className="inline-flex items-center gap-1 px-1.5 h-4 rounded text-[9px] font-bold text-foreground bg-background/80 backdrop-blur border border-border tabular-nums">
            {score}
          </span>
        </div>
      </button>

      {/* Info */}
      <div className="p-2 flex-1 flex flex-col gap-1.5">
        <div className="min-w-0">
          {t.genres?.nome && (
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold truncate mb-0.5">
              {t.genres.nome}
            </div>
          )}
          <div className="text-[12px] font-semibold truncate leading-tight" title={t.name}>{t.name}</div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
            <span className="inline-flex items-center gap-0.5">
              <Music2 className="h-2.5 w-2.5" /> {tracksCount}
            </span>
            {t.creation_error && (
              <span className="inline-flex items-center gap-0.5 text-destructive">
                <AlertCircle className="h-2.5 w-2.5" /> erro
              </span>
            )}
            {isPublished && t.spotify_url && (
              <a
                href={t.spotify_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 hover:text-primary ml-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </div>

        <Button
          onClick={onOpen}
          variant={isHot ? "premium" : isPublished ? "outline" : "secondary"}
          size="sm"
          className="w-full rounded-full h-7 text-[11px] gap-1 mt-auto px-2"
        >
          {isPublished ? (
            <><Check className="h-3 w-3" /> Detalhes</>
          ) : isHot ? (
            <>
              {t.cover_image_url ? <Send className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
              {t.cover_image_url ? "Publicar" : "Capa"}
            </>
          ) : isArchived ? (
            <><Pencil className="h-3 w-3" /> Revisar</>
          ) : (
            <><Check className="h-3 w-3" /> Aprovar</>
          )}
        </Button>
      </div>
    </div>
  );
}

/* ───────────────── Detail Dialog (fluxo híbrido inline) ───────────────── */

function TemplateDetailDialog({
  template, onClose, onChanged, onGeneratingChange,
}: { template: Template | null; onClose: () => void; onChanged: () => Promise<void>; onGeneratingChange?: (id: string, on: boolean) => void }) {
  const { toast } = useToast();
  const [tpl, setTpl] = useState<Template | null>(template);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setTpl(template);
    if (template) {
      setEditName(template.name);
      setEditDesc(template.description ?? "");
    }
  }, [template]);

  if (!tpl) return null;

  const isHot = tpl.quality_tier === "hot";
  const isPublished = tpl.status === "created";
  const isArchived = tpl.status === "archived";

  // Etapa atual no fluxo
  // hot:    needs_cover → ready_publish → published
  // medium: needs_approve → needs_cover → ready_publish → published
  let step: "needs_approve" | "needs_cover" | "ready_publish" | "published" = "needs_approve";
  if (isPublished) step = "published";
  else if (isHot && !tpl.cover_image_url) step = "needs_cover";
  else if (isHot && tpl.cover_image_url) step = "ready_publish";
  else if (tpl.status === "approved" && !tpl.cover_image_url) step = "needs_cover";
  else if (tpl.status === "approved" && tpl.cover_image_url) step = "ready_publish";

  async function refreshOne() {
    if (!tpl) return;
    const { data } = await supabase.from("playlist_templates")
      .select("*").eq("id", tpl.id).maybeSingle();
    if (data) setTpl(data as any);
  }

  async function handleApprove() {
    if (!tpl) return;
    setBusy("approve");
    const { error } = await supabase.from("playlist_templates")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        name: editName.trim(),
        description: editDesc.trim().slice(0, 300),
      })
      .eq("id", tpl.id);
    setBusy(null);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Aprovado" });
    await refreshOne();
    await onChanged();
  }

  // Gera 1 capa. Se palette for passada, gera/recupera só aquela cor (cache).
  // Quando vier de cache (cached:true), nem chama a IA — custo zero.
  async function generateCovers(palette?: string) {
    if (!tpl) return;
    const targetId = tpl.id;
    setBusy("cover");
    onGeneratingChange?.(targetId, true);
    const { data, error } = await supabase.functions.invoke("generate-cover-variations", {
      body: { template_id: targetId, ...(palette ? { palette } : {}) },
    });
    setBusy(null);
    onGeneratingChange?.(targetId, false);
    if (error || !(data as any)?.ok) {
      toast({
        title: "Falha ao gerar capa",
        description: getCoverGenerationErrorMessage(error, data),
        variant: "destructive",
      });
      return;
    }
    const variation = (data as any)?.variation as { index: number; url: string; palette?: string } | undefined;
    const wasCached = (data as any)?.cached === true;
    // Auto-seleciona a capa recém-gerada (ou recém-trocada do cache)
    if (variation) {
      await supabase.from("playlist_templates")
        .update({ cover_selected_index: variation.index, cover_image_url: variation.url })
        .eq("id", targetId);
    }
    toast({
      title: wasCached ? "Cor trocada" : "Capa gerada",
      description: wasCached ? "Reutilizada do cache (sem custo)." : undefined,
    });
    await refreshOne();
    await onChanged();
  }

  async function selectCover(index: number, url: string) {
    if (!tpl) return;
    const { error } = await supabase.from("playlist_templates")
      .update({ cover_selected_index: index, cover_image_url: url })
      .eq("id", tpl.id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    await refreshOne();
    await onChanged();
  }

  async function removeCover() {
    if (!tpl) return;

    const variations = tpl.cover_variations ?? [];
    const activeVariation = (tpl.cover_selected_index !== null
      ? variations.find((v) => v.index === tpl.cover_selected_index)
      : null) ?? variations.find((v) => v.url === tpl.cover_image_url) ?? null;

    const remainingVariations = activeVariation
      ? variations.filter((v) => v.index !== activeVariation.index)
      : variations;

    const fallbackVariation = remainingVariations[0] ?? null;

    setBusy("remove_cover");
    const { error } = await supabase.from("playlist_templates")
      .update({
        cover_variations: remainingVariations,
        cover_image_url: fallbackVariation?.url ?? null,
        cover_selected_index: fallbackVariation?.index ?? null,
      })
      .eq("id", tpl.id);
    setBusy(null);

    if (error) {
      toast({ title: "Erro ao excluir capa", description: error.message, variant: "destructive" });
      return;
    }

    toast({
      title: activeVariation || tpl.cover_image_url ? "Capa excluída" : "Sem capa para excluir",
      description: fallbackVariation ? "A próxima variação foi selecionada automaticamente." : undefined,
    });
    await refreshOne();
    await onChanged();
  }

  async function regenerateCoverFromScratch() {
    if (!tpl) return;
    if (tpl.spotify_playlist_id) {
      toast({
        title: "Não é possível regenerar",
        description: "Esta playlist já está publicada no Spotify.",
        variant: "destructive",
      });
      return;
    }

    setBusy("regenerate_cover");
    onGeneratingChange?.(tpl.id, true);
    const { data, error } = await supabase.functions.invoke("generate-cover-variations", {
      body: { template_id: tpl.id, force: true },
    });
    onGeneratingChange?.(tpl.id, false);
    setBusy(null);

    if (error || !(data as any)?.ok) {
      toast({
        title: "Falha ao gerar outra capa",
        description: getCoverGenerationErrorMessage(error, data),
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Nova capa gerada" });
    await refreshOne();
    await onChanged();
  }

  async function publish() {
    if (!tpl) return;
    setBusy("publish");
    // Garante status approved (caso seja hot pulando aprovação)
    if (tpl.status !== "approved" && tpl.status !== "created") {
      await supabase.from("playlist_templates")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", tpl.id);
    }
    const { data, error } = await supabase.functions.invoke("create-spotify-playlist", {
      body: { template_id: tpl.id, public: true },
    });
    if (error || !(data as any)?.ok) {
      setBusy(null);
      toast({ title: "Falha ao publicar", description: error?.message || (data as any)?.error || "Erro", variant: "destructive" });
      return;
    }
    // Envia capa após criação
    if (tpl.cover_image_url) {
      await supabase.functions.invoke("upload-playlist-cover", {
        body: { template_id: tpl.id, image_url: tpl.cover_image_url },
      });
    }
    setBusy(null);
    toast({ title: "Publicada", description: `${(data as any).tracks_added} faixas adicionadas` });
    await refreshOne();
    await onChanged();
  }

  async function unarchive() {
    if (!tpl) return;
    setBusy("unarchive");
    await supabase.from("playlist_templates")
      .update({ status: "pending", quality_tier: "medium", rejection_reason: null })
      .eq("id", tpl.id);
    setBusy(null);
    toast({ title: "Desarquivado" });
    await refreshOne();
    await onChanged();
  }

  const breakdown = tpl.score_breakdown ?? {};

  return (
    <Dialog open={!!template} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            {isHot && <Flame className="h-4 w-4 text-primary" />}
            {!isHot && !isArchived && !isPublished && <AlertTriangle className="h-4 w-4 text-warning" />}
            {isArchived && <Archive className="h-4 w-4 text-muted-foreground" />}
            {isPublished && <Check className="h-4 w-4 text-primary" />}
            <span className="truncate">{tpl.name}</span>
          </DialogTitle>
          <DialogDescription className="flex items-center gap-3 text-xs">
            <span className="font-mono tabular-nums">Score {Math.round(tpl.final_score)}</span>
            <span>•</span>
            <span>{tpl.track_seeds?.length ?? 0} faixas</span>
            {tpl.creation_error && (
              <>
                <span>•</span>
                <span className="text-destructive">{tpl.creation_error.slice(0, 60)}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Breakdown */}
        {Object.keys(breakdown).length > 0 && (
          <div className="grid grid-cols-5 gap-1.5 text-center">
            {[
              ["replication", "Replic"],
              ["tracks", "Tracks"],
              ["source", "Fonte"],
              ["dna", "DNA"],
              ["naming", "Nome"],
            ].map(([key, label]) => (
              <div key={key} className="bg-elevated border border-border rounded-md p-2">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">{label}</div>
                <div className="text-sm font-bold tabular-nums">{breakdown[key] ?? 0}</div>
              </div>
            ))}
          </div>
        )}

        {/* Conteúdo do passo */}
        {step === "published" ? (
          <div className="text-center space-y-3 py-4">
            <div className="h-14 w-14 rounded-full bg-primary/15 border border-primary/40 mx-auto flex items-center justify-center">
              <Check className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Playlist publicada</h3>
              <p className="text-sm text-muted-foreground">
                {tpl.tracks_added} faixas adicionadas
                {tpl.tracks_failed > 0 ? `, ${tpl.tracks_failed} falharam` : ""}.
              </p>
            </div>
            {tpl.spotify_url && (
              <a href={tpl.spotify_url} target="_blank" rel="noreferrer" className="inline-block">
                <Button variant="outline" className="rounded-full gap-1.5">
                  <ExternalLink className="h-4 w-4" /> Abrir no Spotify
                </Button>
              </a>
            )}
          </div>
        ) : isArchived ? (
          <div className="text-center space-y-3 py-4">
            <div className="h-14 w-14 rounded-full bg-muted/30 border border-border mx-auto flex items-center justify-center">
              <Archive className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Template arquivado</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Score abaixo do mínimo de qualidade. Você pode desarquivar e revisar manualmente.
              </p>
            </div>
            <Button onClick={unarchive} disabled={busy === "unarchive"} variant="outline" className="rounded-full gap-1.5">
              {busy === "unarchive" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Desarquivar
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Edição inline (sempre visível pra médios, e na aprovação dos hot opcional) */}
            {step === "needs_approve" && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="name" className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Nome</Label>
                  <Input id="name" value={editName} onChange={e => setEditName(e.target.value)} className="mt-1.5 h-9" />
                </div>
                <div>
                  <Label htmlFor="desc" className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Descrição</Label>
                  <Textarea id="desc" value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3} maxLength={300} className="mt-1.5" />
                </div>
              </div>
            )}

            {/* Capas */}
            {(step === "needs_cover" || step === "ready_publish") && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Capa</h4>
                  <span className="text-[11px] text-muted-foreground">
                    {tpl.cover_variations?.length ?? 0}/4 cores geradas
                  </span>
                </div>

                {(() => {
                  // Definição visual das 4 paletas (mesma ordem do backend)
                  const PALETTE_OPTIONS = [
                    { name: "spotify-green",  label: "Verde",   gradient: "linear-gradient(135deg,#1DB954,#0d6b30)" },
                    { name: "deep-purple",    label: "Roxo",    gradient: "linear-gradient(135deg,#7b2cbf,#2d0a4e)" },
                    { name: "vibrant-orange", label: "Laranja", gradient: "linear-gradient(135deg,#ff6b35,#c2410c)" },
                    { name: "midnight-blue",  label: "Azul",    gradient: "linear-gradient(135deg,#1e3a8a,#0c1733)" },
                  ];
                  const variations = tpl.cover_variations ?? [];
                  const hasAny = variations.length > 0;
                  const hasSelectedCover = !!tpl.cover_image_url;
                  const isBusy = ["cover", "remove_cover", "regenerate_cover"].includes(busy ?? "");
                  const ver = tpl.cover_generated_at ? new Date(tpl.cover_generated_at).getTime() : 0;
                  // Capa "ativa" para preview grande: a selecionada, ou a 1ª gerada
                  const active = (tpl.cover_selected_index !== null
                    ? variations.find(v => v.index === tpl.cover_selected_index)
                    : null) ?? variations[0] ?? null;
                  const previewUrl = active?.url ?? tpl.cover_image_url ?? null;
                  const activeSrc = previewUrl
                    ? `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}v=${ver}`
                    : null;

                  return (
                    <div className="space-y-3">
                      {/* Preview grande da capa ativa */}
                      <div className="aspect-square w-full max-w-[280px] mx-auto rounded-xl overflow-hidden border border-border bg-elevated relative">
                        {activeSrc ? (
                          <img src={activeSrc} alt="" className="w-full h-full object-cover" />
                        ) : isBusy ? (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
                            <Loader2 className="h-6 w-6 animate-spin" />
                            <span className="text-xs">Gerando capa…</span>
                          </div>
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground p-4 text-center">
                            <ImageIcon className="h-6 w-6" />
                            <span className="text-xs">Clique numa cor abaixo<br/>para gerar a capa</span>
                          </div>
                        )}
                        {isBusy && activeSrc && (
                          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                          </div>
                        )}
                      </div>

                      {/* 4 swatches de cor — clica e troca/gera */}
                      <div className="flex items-center justify-center gap-3">
                        {PALETTE_OPTIONS.map(opt => {
                          const v = variations.find(x => x.palette === opt.name);
                          const isGenerated = !!v;
                          const isActive = active?.palette === opt.name;
                          const handleClick = () => {
                            if (isBusy) return;
                            if (v) {
                              // já existe → seleção instantânea (0 crédito)
                              selectCover(v.index, v.url);
                            } else {
                              // ainda não → gera essa cor (1 crédito)
                              generateCovers(opt.name);
                            }
                          };
                          return (
                            <button
                              key={opt.name}
                              onClick={handleClick}
                              disabled={isBusy}
                              title={isGenerated ? `Trocar para ${opt.label} (sem custo)` : `Gerar capa ${opt.label} (1 crédito)`}
                              className={cn(
                                "relative h-10 w-10 rounded-full transition-transform border-2",
                                isActive ? "border-primary scale-110 ring-2 ring-primary/30" : "border-border hover:scale-105",
                                isBusy && "opacity-50 cursor-not-allowed",
                              )}
                              style={{ background: opt.gradient }}
                            >
                              {isGenerated ? (
                                isActive && (
                                  <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
                                )
                              ) : (
                                <span className="absolute inset-0 flex items-center justify-center text-white text-lg font-light drop-shadow">
                                  +
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="rounded-full gap-1.5"
                          onClick={removeCover}
                          disabled={isBusy || (!hasAny && !hasSelectedCover)}
                          title={!hasAny && !hasSelectedCover ? "Não há capa para excluir" : "Excluir capa atual"}
                        >
                          {busy === "remove_cover" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          Excluir capa
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="rounded-full gap-1.5"
                          onClick={regenerateCoverFromScratch}
                          disabled={isBusy || !!tpl.spotify_playlist_id}
                          title={tpl.spotify_playlist_id ? "Playlist já publicada não pode regenerar capa" : "Descartar a atual e gerar outra"}
                        >
                          {busy === "regenerate_cover" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          Gerar outra
                        </Button>
                      </div>

                      <p className="text-[11px] text-center text-muted-foreground">
                        {hasAny
                          ? "Cores com ✓ = trocar não gasta crédito. Cores com + = gera nova (1 crédito)."
                          : "Escolha uma cor pra gerar a capa (1 crédito por cor)."}
                      </p>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* CTA principal */}
            <div className="flex items-center gap-2 pt-2 border-t border-border">
              {step === "needs_approve" && (
                <Button onClick={handleApprove} disabled={busy === "approve"} className="flex-1 rounded-full" variant="premium">
                  {busy === "approve" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                  Aprovar e ir pra capa
                </Button>
              )}
              {step === "needs_cover" && (
                <Button
                  disabled
                  className="flex-1 rounded-full"
                  variant="outline"
                >
                  Selecione uma capa pra continuar
                </Button>
              )}
              {step === "ready_publish" && (
                <Button onClick={publish} disabled={busy === "publish"} className="flex-1 rounded-full" variant="premium" size="lg">
                  {busy === "publish" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                  Publicar no Spotify
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────── Grids paginados ───────────────── */

function PagedTemplateGrid({
  items,
  onOpen,
  variant,
  itemLabel,
  resetKey,
  generatingIds,
  onRegenerate,
}: {
  items: Template[];
  onOpen: (t: Template) => void;
  variant: CardVariant;
  itemLabel: string;
  resetKey?: unknown;
  generatingIds?: Set<string>;
  onRegenerate?: (t: Template) => void | Promise<void>;
}) {
  const { visibleItems, hasMore, canCollapse, loadMore, collapse, total, visible } = usePagination(items, 20, resetKey ?? items);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {visibleItems.map(t => (
          <TemplateCard
            key={t.id}
            t={t}
            variant={variant}
            onOpen={() => onOpen(t)}
            isGenerating={generatingIds?.has(t.id) ?? false}
            onRegenerate={onRegenerate}
          />
        ))}
      </div>
      <LoadMore visible={visible} total={total} hasMore={hasMore} canCollapse={canCollapse} onLoadMore={loadMore} onCollapse={collapse} itemLabel={itemLabel} />
    </div>
  );
}

function PublishedGrid({ items, onOpen }: { items: Template[]; onOpen: (t: Template) => void }) {
  return <PagedTemplateGrid items={items} variant="published" itemLabel="publicadas" onOpen={onOpen} />;
}

function ArchivedSection({
  items, showArchived, setShowArchived, onOpen, onRegenerate,
}: {
  items: Template[];
  showArchived: boolean;
  setShowArchived: (v: boolean | ((prev: boolean) => boolean)) => void;
  onOpen: (t: Template) => void;
  onRegenerate?: (t: Template) => void | Promise<void>;
}) {
  const { visibleItems, hasMore, canCollapse, loadMore, collapse, total, visible } = usePagination(items, 20, showArchived ? "open" : "closed");
  return (
    <section className="nx-card !p-0 overflow-hidden">
      <button
        onClick={() => setShowArchived(v => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-elevated/40 transition-colors text-left"
      >
        {showArchived ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <Archive className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-sm font-semibold">📦 Arquivados</div>
          <div className="text-xs text-muted-foreground">
            {items.length} templates auto-arquivados (score &lt; 45)
          </div>
        </div>
      </button>
      {showArchived && (
        <div className="border-t border-border p-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {visibleItems.map(t => (
              <TemplateCard key={t.id} t={t} variant="archived" onOpen={() => onOpen(t)} onRegenerate={onRegenerate} />
            ))}
          </div>
          <LoadMore visible={visible} total={total} hasMore={hasMore} canCollapse={canCollapse} onLoadMore={loadMore} onCollapse={collapse} itemLabel="arquivados" />
        </div>
      )}
    </section>
  );
}
