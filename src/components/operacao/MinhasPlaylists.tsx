import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatNumber, timeAgo } from "@/lib/format";
import {
  Plus, RefreshCw, ExternalLink, Music2, Sparkles, Archive, ArchiveRestore,
  ListMusic, AlertCircle, Activity,
} from "lucide-react";
import { PlaylistScoreBadge, type PlaylistScoreRow } from "./PlaylistScoreBadge";

type ManagedPlaylist = {
  id: string;
  spotify_playlist_id: string;
  spotify_url: string;
  name: string;
  cover_url: string | null;
  followers: number;
  tracks_count: number;
  genre_id: string | null;
  archived_at: string | null;
  last_diagnosis_at: string | null;
  imported_at: string;
  canonical_playlist_id: string | null;
};

type Diagnosis = {
  id: string;
  name_score: number | null;
  name_current: string | null;
  name_suggestion: string | null;
  name_reasons: any;
  tracks_suggestions: any;
  cover_suggestion: any;
  created_at: string;
};

type Valuation = {
  spotify_playlist_id: string;
  valuation_score: number;
  recommendation: string;
  estimated_monthly_plays: number;
  risk_level: string;
};

export function MinhasPlaylists() {
  const [items, setItems] = useState<ManagedPlaylist[]>([]);
  const [scores, setScores] = useState<Record<string, PlaylistScoreRow>>({});
  const [valuations, setValuations] = useState<Record<string, Valuation>>({});
  const [recalcing, setRecalcing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [sortBy, setSortBy] = useState<"recent" | "valuation">("recent");
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);

  async function handleBulkImport() {
    setBulkImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("import-account-playlists", {
        body: {},
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      toast({
        title: "Importação concluída",
        description: `${data.imported} playlists da conta (${data.others_count} ignoradas por não serem suas)`,
      });
      load();
    } catch (e: any) {
      toast({ title: "Erro na importação em massa", description: e.message, variant: "destructive" });
    } finally {
      setBulkImporting(false);
    }
  }
  const [drawerPl, setDrawerPl] = useState<ManagedPlaylist | null>(null);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const loadScores = useCallback(async (canonicalIds: string[]) => {
    if (!canonicalIds.length) { setScores({}); return; }
    const { data } = await supabase
      .from("playlist_scores")
      .select("playlist_id, health_score, delivery_score, capacity_score, risk_score, activity_score, calculated_at")
      .in("playlist_id", canonicalIds);
    const map: Record<string, PlaylistScoreRow> = {};
    (data ?? []).forEach((r: any) => { map[r.playlist_id] = r; });
    setScores(map);
  }, []);

  const loadValuations = useCallback(async (spotifyIds: string[]) => {
    if (!spotifyIds.length) { setValuations({}); return; }
    const { data, error } = await supabase.rpc("evaluate_playlists_batch", { p_spotify_ids: spotifyIds });
    if (error) return;
    const map: Record<string, Valuation> = {};
    (data ?? []).forEach((r: any) => { map[r.spotify_playlist_id] = r; });
    setValuations(map);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("managed_playlists")
      .select("*")
      .order("imported_at", { ascending: false });
    if (error) toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
    const list = (data ?? []) as ManagedPlaylist[];
    setItems(list);
    setLoading(false);
    const canonicals = list.map(i => i.canonical_playlist_id).filter(Boolean) as string[];
    loadScores(canonicals);
    loadValuations(list.map(i => i.spotify_playlist_id).filter(Boolean));
  }, [loadScores, loadValuations]);

  async function handleRecalc() {
    setRecalcing(true);
    try {
      const { error } = await supabase.rpc("trigger_recalc_playlist_scores");
      if (error) throw error;
      toast({ title: "Scores recalculados" });
      const canonicals = items.map(i => i.canonical_playlist_id).filter(Boolean) as string[];
      await loadScores(canonicals);
    } catch (e: any) {
      toast({ title: "Erro ao recalcular", description: e.message, variant: "destructive" });
    } finally {
      setRecalcing(false);
    }
  }

  useEffect(() => { load(); }, [load]);

  const visible = items
    .filter((p) => (showArchived ? !!p.archived_at : !p.archived_at))
    .slice()
    .sort((a, b) => {
      if (sortBy !== "valuation") return 0;
      const va = valuations[a.spotify_playlist_id]?.valuation_score ?? -1;
      const vb = valuations[b.spotify_playlist_id]?.valuation_score ?? -1;
      return vb - va;
    });

  async function handleImport() {
    if (!importUrl.trim()) return;
    setImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("import-managed-playlist", {
        body: { url: importUrl.trim() },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      toast({ title: "Playlist importada", description: data.playlist?.name });
      setImportOpen(false);
      setImportUrl("");
      load();
    } catch (e: any) {
      toast({ title: "Não consegui importar", description: e.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  async function openDiagnosis(pl: ManagedPlaylist) {
    setDrawerPl(pl);
    setDiagnosis(null);
    setDiagLoading(true);
    // Busca último diagnóstico
    const { data: last } = await supabase
      .from("playlist_diagnoses")
      .select("*")
      .eq("playlist_id", pl.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last) setDiagnosis(last as any);
    setDiagLoading(false);
  }

  async function runDiagnosis(pl: ManagedPlaylist) {
    setDiagLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("diagnose-managed-playlist", {
        body: { playlist_id: pl.id },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      setDiagnosis(data.diagnosis);
      toast({ title: "Diagnóstico atualizado" });
      load();
    } catch (e: any) {
      toast({ title: "Erro no diagnóstico", description: e.message, variant: "destructive" });
    } finally {
      setDiagLoading(false);
    }
  }

  async function archive(pl: ManagedPlaylist, restore = false) {
    const { error } = await supabase.functions.invoke("archive-managed-playlist", {
      body: { playlist_id: pl.id, restore },
    });
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: restore ? "Restaurada" : "Arquivada" });
    setDrawerPl(null);
    load();
  }

  // KPI agregados sobre as playlists visíveis (não-arquivadas)
  const activeItems = items.filter(i => !i.archived_at);
  const scoreRows = activeItems
    .map(i => i.canonical_playlist_id ? scores[i.canonical_playlist_id] : null)
    .filter(Boolean) as PlaylistScoreRow[];
  const avgHealth = scoreRows.length ? Math.round(scoreRows.reduce((a, s) => a + s.health_score, 0) / scoreRows.length) : 0;
  const atRisk = scoreRows.filter(s => s.risk_score >= 60).length;
  const inactive = scoreRows.filter(s => s.activity_score < 30).length;
  const topPerf = scoreRows.filter(s => s.health_score >= 70).length;

  return (
    <section className="space-y-4">
      {/* KPI bar */}
      {activeItems.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="nx-card !p-3 flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Health médio</span>
            <span className="text-lg font-semibold tabular-nums">{avgHealth}</span>
          </div>
          <div className="nx-card !p-3 flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Top performers</span>
            <span className="text-lg font-semibold tabular-nums text-primary">{topPerf}</span>
          </div>
          <div className="nx-card !p-3 flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Em risco</span>
            <span className={cn("text-lg font-semibold tabular-nums", atRisk > 0 && "text-destructive")}>{atRisk}</span>
          </div>
          <div className="nx-card !p-3 flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Inativas</span>
            <span className={cn("text-lg font-semibold tabular-nums", inactive > 0 && "text-warning")}>{inactive}</span>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setImportOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Importar playlist
        </Button>
        <Button
          variant="outline"
          onClick={handleBulkImport}
          disabled={bulkImporting}
          className="gap-1.5"
        >
          <RefreshCw className={cn("h-4 w-4", bulkImporting && "animate-spin")} />
          {bulkImporting ? "Importando da conta…" : "Importar tudo da conta"}
        </Button>
        <Button variant="outline" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Atualizar
        </Button>
        <Button variant="outline" onClick={handleRecalc} disabled={recalcing} className="gap-1.5">
          <Activity className={cn("h-4 w-4", recalcing && "animate-pulse")} />
          {recalcing ? "Recalculando…" : "Recalcular scores"}
        </Button>
        <Button
          variant="outline"
          onClick={() => setSortBy(sortBy === "valuation" ? "recent" : "valuation")}
          className="gap-1.5"
        >
          {sortBy === "valuation" ? "Ordem: valuation" : "Ordem: recente"}
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setShowArchived(false)}
            className={cn(
              "h-8 px-3 rounded-full text-xs font-medium border transition-colors",
              !showArchived
                ? "bg-primary/15 border-primary/40 text-primary"
                : "bg-elevated border-border text-muted-foreground hover:text-foreground",
            )}
          >Ativas ({items.filter(i => !i.archived_at).length})</button>
          <button
            onClick={() => setShowArchived(true)}
            className={cn(
              "h-8 px-3 rounded-full text-xs font-medium border transition-colors",
              showArchived
                ? "bg-primary/15 border-primary/40 text-primary"
                : "bg-elevated border-border text-muted-foreground hover:text-foreground",
            )}
          >Arquivadas ({items.filter(i => i.archived_at).length})</button>
        </div>
      </div>

      {/* Grid */}
      {loading && items.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="nx-card !p-0 overflow-hidden">
              <Skeleton className="aspect-square w-full rounded-none bg-muted/40" />
              <div className="p-2.5 space-y-2">
                <Skeleton className="h-3.5 w-3/4 bg-muted/50" />
                <Skeleton className="h-3 w-1/2 bg-muted/40" />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="nx-card text-center py-12">
          <div className="h-12 w-12 rounded-full bg-elevated border border-border mx-auto flex items-center justify-center">
            <ListMusic className="h-5 w-5 text-muted-foreground" />
          </div>
          <h4 className="mt-3 font-semibold">
            {showArchived ? "Nenhuma playlist arquivada" : "Nenhuma playlist gerenciada"}
          </h4>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            {showArchived
              ? "Playlists que você arquivar ficam aqui (mantém histórico e métricas)."
              : "Cole a URL de uma playlist do Spotify para começar a operar com a inteligência do sistema."}
          </p>
          {!showArchived && (
            <Button onClick={() => setImportOpen(true)} className="mt-4 gap-1.5">
              <Plus className="h-4 w-4" /> Importar primeira playlist
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {visible.map((p) => (
            <button
              key={p.id}
              onClick={() => openDiagnosis(p)}
              className="nx-card !p-0 overflow-hidden text-left group hover:border-foreground/25 transition-colors flex flex-col"
            >
              <div className="relative aspect-square bg-elevated overflow-hidden">
                {p.cover_url ? (
                  <img src={p.cover_url} alt={p.name} loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Music2 className="h-7 w-7 text-muted-foreground/40" />
                  </div>
                )}
                {p.last_diagnosis_at && (
                  <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-2 h-6 rounded-full bg-primary/20 border border-primary/40 text-primary text-[10px] font-medium">
                    <Sparkles className="h-3 w-3" /> diag {timeAgo(p.last_diagnosis_at)}
                  </span>
                )}
                {valuations[p.spotify_playlist_id] && (
                  <span
                    title={`Valuation ${valuations[p.spotify_playlist_id].valuation_score}/100`}
                    className={cn(
                      "absolute top-1.5 left-1.5 inline-flex items-center px-2 h-6 rounded-full border text-[10px] font-bold tabular-nums",
                      valuations[p.spotify_playlist_id].recommendation === "buy" && "bg-primary/20 border-primary/40 text-primary",
                      valuations[p.spotify_playlist_id].recommendation === "maybe" && "bg-warning/15 border-warning/40 text-warning",
                      valuations[p.spotify_playlist_id].recommendation === "skip" && "bg-muted/30 border-border text-muted-foreground",
                    )}
                  >
                    V {Math.round(valuations[p.spotify_playlist_id].valuation_score)}
                  </span>
                )}
              </div>
              <div className="p-2.5 flex-1 flex flex-col gap-1.5">
                <div className="flex items-start gap-1.5">
                  <h4 className="flex-1 text-[13px] font-semibold leading-tight line-clamp-1" title={p.name}>{p.name}</h4>
                  <PlaylistScoreBadge scores={p.canonical_playlist_id ? scores[p.canonical_playlist_id] ?? null : null} />
                </div>
                <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
                  <span><span className="font-semibold text-foreground">{formatNumber(p.followers)}</span> seg.</span>
                  <span><span className="font-semibold text-foreground">{p.tracks_count || "—"}</span> fx</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar playlist</DialogTitle>
            <DialogDescription>
              Cole a URL pública da playlist no Spotify. O sistema puxa nome, capa e contagem.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://open.spotify.com/playlist/..."
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancelar</Button>
            <Button onClick={handleImport} disabled={importing || !importUrl.trim()}>
              {importing ? "Importando..." : "Importar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diagnosis drawer */}
      <Sheet open={!!drawerPl} onOpenChange={(o) => !o && setDrawerPl(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {drawerPl && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  {drawerPl.cover_url && (
                    <img src={drawerPl.cover_url} alt="" className="h-12 w-12 rounded-md object-cover" />
                  )}
                  <span className="truncate">{drawerPl.name}</span>
                </SheetTitle>
                <SheetDescription>
                  {formatNumber(drawerPl.followers)} seguidores · {drawerPl.tracks_count} faixas
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => runDiagnosis(drawerPl)} disabled={diagLoading} className="gap-1.5">
                    <Sparkles className="h-4 w-4" />
                    {diagLoading ? "Analisando..." : diagnosis ? "Rodar novo diagnóstico" : "Diagnosticar agora"}
                  </Button>
                  <Button variant="outline" asChild>
                    <a href={drawerPl.spotify_url} target="_blank" rel="noreferrer" className="gap-1.5">
                      <ExternalLink className="h-4 w-4" /> Abrir no Spotify
                    </a>
                  </Button>
                  {drawerPl.archived_at ? (
                    <Button variant="outline" onClick={() => archive(drawerPl, true)} className="gap-1.5">
                      <ArchiveRestore className="h-4 w-4" /> Restaurar
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => archive(drawerPl)} className="gap-1.5">
                      <Archive className="h-4 w-4" /> Arquivar
                    </Button>
                  )}
                </div>

                {!diagnosis && !diagLoading && (
                  <div className="nx-card text-center py-8 text-sm text-muted-foreground">
                    Sem diagnóstico ainda. Clique em <strong>Diagnosticar agora</strong> para gerar sugestões.
                  </div>
                )}

                {diagnosis && (
                  <>
                    <div className="nx-card space-y-3">
                      <div className="flex items-center justify-between">
                        <h5 className="font-semibold text-sm">Nome</h5>
                        {diagnosis.name_score !== null && (
                          <span className={cn(
                            "text-xs font-medium px-2 h-6 inline-flex items-center rounded-full border",
                            diagnosis.name_score >= 70
                              ? "bg-primary/15 border-primary/40 text-primary"
                              : "bg-warning/10 border-warning/30 text-warning",
                          )}>Score {diagnosis.name_score}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">Atual</div>
                      <div className="text-sm">{diagnosis.name_current}</div>
                      {diagnosis.name_suggestion && (
                        <>
                          <div className="text-xs text-muted-foreground mt-2">Sugestão</div>
                          <div className="text-sm font-medium text-primary">{diagnosis.name_suggestion}</div>
                          <div className="flex items-center gap-2 pt-2">
                            <Button size="sm" disabled className="gap-1.5">
                              Aplicar nome no Spotify
                            </Button>
                            <span className="text-[11px] text-muted-foreground">em breve</span>
                          </div>
                        </>
                      )}
                      {Array.isArray(diagnosis.name_reasons) && diagnosis.name_reasons.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Faltando: {diagnosis.name_reasons.map((r: any) => r.value).join(", ")}
                        </div>
                      )}
                    </div>

                    {Array.isArray(diagnosis.tracks_suggestions) && diagnosis.tracks_suggestions.length > 0 && (
                      <div className="nx-card space-y-2">
                        <h5 className="font-semibold text-sm">Faixas sugeridas</h5>
                        <ul className="space-y-1 text-sm">
                          {diagnosis.tracks_suggestions.slice(0, 8).map((t: any, i: number) => (
                            <li key={i} className="flex items-center gap-2 text-xs">
                              <Music2 className="h-3 w-3 text-muted-foreground" />
                              <span className="truncate">{t?.name ?? t?.title ?? t?.track_name ?? JSON.stringify(t).slice(0, 60)}</span>
                            </li>
                          ))}
                        </ul>
                        <Button size="sm" disabled className="gap-1.5">Adicionar no Spotify</Button>
                        <span className="text-[11px] text-muted-foreground ml-2">em breve</span>
                      </div>
                    )}

                    <div className="nx-card text-xs text-muted-foreground flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>Sugestões geradas pelo cérebro do gênero. Aplicação no Spotify ainda é manual: copie e cole no app.</span>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
