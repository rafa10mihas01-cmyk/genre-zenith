import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Wand2, Layers, CheckCircle2, XCircle, Clock, Trash2, ExternalLink, FileText, Music2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatNumber, timeAgo } from "@/lib/format";

type Blueprint = {
  id: string;
  genre_id: string;
  tier: string;
  name: string;
  slug: string;
  name_pattern: string | null;
  format: string | null;
  mood: string | null;
  cover_style: any;
  track_dna: any;
  source_playlists: any[];
  sample_size: number;
  confidence: string;
  notes: string | null;
  replication_score: number;
  status: string;
  updated_at: string;
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
  regras: any;
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
  mega: "≥100k seguidores",
  big: "10k–100k",
  medium: "1k–10k",
  small: "<1k",
};
const STATUS_LABEL: Record<string, { label: string; tone: string; icon: any }> = {
  pending:  { label: "Pendente",  tone: "bg-warning/15 text-warning",       icon: Clock },
  approved: { label: "Aprovado",  tone: "bg-primary/15 text-primary",       icon: CheckCircle2 },
  rejected: { label: "Rejeitado", tone: "bg-destructive/15 text-destructive", icon: XCircle },
  created:  { label: "Criado",    tone: "bg-emerald-500/15 text-emerald-400", icon: CheckCircle2 },
};

export function Replicacao({ genreId }: { genreId?: string }) {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [templatesByBp, setTemplatesByBp] = useState<Record<string, Template[]>>({});
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    if (!genreId) return;
    setLoading(true);
    const { data: bps } = await supabase
      .from("playlist_blueprints")
      .select("*")
      .eq("genre_id", genreId)
      .order("replication_score", { ascending: false });
    setBlueprints((bps ?? []) as Blueprint[]);
    if (bps && bps.length > 0) {
      const ids = bps.map((b: any) => b.id);
      const { data: tps } = await supabase
        .from("playlist_templates")
        .select("*")
        .in("blueprint_id", ids)
        .order("variation_index", { ascending: true });
      const map: Record<string, Template[]> = {};
      for (const t of (tps ?? []) as Template[]) {
        (map[t.blueprint_id] ??= []).push(t);
      }
      setTemplatesByBp(map);
    } else {
      setTemplatesByBp({});
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [genreId]);

  const runExtract = async () => {
    if (!genreId || extracting) return;
    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-blueprints", {
        body: { genre_id: genreId, max_per_tier: 5 },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data?.error ?? "Falha ao extrair");
      toast.success(`${data?.total ?? 0} blueprints extraídos`, {
        description: `${data?.created?.length ?? 0} novos · ${data?.updated?.length ?? 0} atualizados`,
      });
      await load();
    } catch (e: any) {
      toast.error("Erro ao extrair", { description: e?.message });
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
      toast.success(`${data?.count ?? 0} variações geradas`);
      setExpanded(prev => new Set(prev).add(bpId));
      await load();
    } catch (e: any) {
      toast.error("Erro ao gerar", { description: e?.message });
    } finally {
      setGenerating(null);
    }
  };

  const updateTemplateStatus = async (id: string, status: "approved" | "rejected" | "pending") => {
    const patch: any = { status };
    if (status === "approved") patch.approved_at = new Date().toISOString();
    if (status !== "approved") patch.approved_at = null;
    const { error } = await supabase.from("playlist_templates").update(patch).eq("id", id);
    if (error) { toast.error("Erro ao atualizar"); return; }
    toast.success(status === "approved" ? "Aprovado" : status === "rejected" ? "Rejeitado" : "Pendente");
    await load();
  };

  const deleteTemplate = async (id: string) => {
    const { error } = await supabase.from("playlist_templates").delete().eq("id", id);
    if (error) { toast.error("Erro"); return; }
    toast.success("Template removido");
    await load();
  };

  const createOnSpotify = async (id: string) => {
    setCreating(id);
    try {
      const { data, error } = await supabase.functions.invoke("create-spotify-playlist", {
        body: { template_id: id, public: true },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data?.error ?? "Falha ao criar");
      toast.success("Playlist criada no Spotify", {
        description: `${data?.tracks_added ?? 0} faixas adicionadas · ${data?.tracks_failed ?? 0} falhas`,
        action: data?.spotify_url ? { label: "Abrir", onClick: () => window.open(data.spotify_url, "_blank") } : undefined,
      });
      await load();
    } catch (e: any) {
      const msg = e?.message ?? "Erro desconhecido";
      toast.error("Erro ao criar no Spotify", {
        description: msg.includes("Nenhuma conta") ? "Conecte uma conta Spotify em Configurações." : msg,
      });
    } finally {
      setCreating(null);
    }
  };

  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="nx-card p-5 h-40 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-bold flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Blueprints replicáveis
          </h3>
          <p className="text-xs text-muted-foreground">
            Padrões estruturais extraídos das top playlists. Cada blueprint pode gerar variações prontas para criação.
          </p>
        </div>
        <Button size="sm" onClick={runExtract} disabled={extracting || !genreId}>
          {extracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {blueprints.length > 0 ? "Re-extrair" : "Extrair blueprints"}
        </Button>
      </div>

      {blueprints.length === 0 ? (
        <div className="nx-card p-12 text-center space-y-2">
          <Layers className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nenhum blueprint ainda. Rode a extração para identificar padrões nas top playlists.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {blueprints.map((bp) => {
            const templates = templatesByBp[bp.id] ?? [];
            const isOpen = expanded.has(bp.id);
            return (
              <div key={bp.id} className="nx-card overflow-hidden">
                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-elevated border border-border">
                          {TIER_LABEL[bp.tier] ?? bp.tier} · {TIER_HINT[bp.tier]}
                        </span>
                        <span className={cn(
                          "text-[10px] uppercase font-bold px-2 py-0.5 rounded-full",
                          bp.confidence === "alta" ? "bg-primary/15 text-primary"
                          : bp.confidence === "media" ? "bg-warning/15 text-warning"
                          : "bg-muted text-muted-foreground",
                        )}>{bp.confidence}</span>
                        <ScoreBadge score={Number(bp.replication_score)} />
                      </div>
                      <h4 className="font-bold text-base mt-1.5 truncate">{bp.name}</h4>
                      {bp.name_pattern && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Padrão: <span className="font-mono text-foreground">{bp.name_pattern}</span>
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => toggleExpand(bp.id)}>
                        {isOpen ? "Recolher" : `${templates.length} variações`}
                      </Button>
                      <Button size="sm" onClick={() => runGenerate(bp.id)} disabled={generating === bp.id}>
                        {generating === bp.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                        Gerar
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs pt-1">
                    <Field label="Formato" value={bp.format} />
                    <Field label="Mood" value={bp.mood} />
                    <Field label="Amostra" value={`${bp.sample_size} playlists`} />
                    <Field label="Atualizado" value={timeAgo(bp.updated_at)} />
                  </div>

                  {bp.notes && (
                    <p className="text-xs text-foreground/85 p-2.5 rounded-lg bg-elevated border border-border">
                      {bp.notes}
                    </p>
                  )}

                  {bp.source_playlists?.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] uppercase text-muted-foreground tracking-wider">Fontes:</span>
                      {bp.source_playlists.slice(0, 4).map((p: any, i: number) => (
                        <a key={i} href={p.url} target="_blank" rel="noreferrer"
                           className="text-xs px-2 py-0.5 rounded bg-elevated border border-border hover:border-primary/50 inline-flex items-center gap-1">
                          {p.nome?.slice(0, 30)} <span className="text-muted-foreground">({formatNumber(p.seguidores)})</span>
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                {isOpen && (
                  <div className="border-t border-border bg-elevated/30 p-4 space-y-2">
                    {templates.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-6">
                        Nenhuma variação gerada ainda. Clique em "Gerar".
                      </p>
                    ) : (
                      templates.map((t) => <TemplateCard
                        key={t.id} t={t}
                        creating={creating === t.id}
                        onApprove={() => updateTemplateStatus(t.id, "approved")}
                        onReject={() => updateTemplateStatus(t.id, "rejected")}
                        onReset={() => updateTemplateStatus(t.id, "pending")}
                        onDelete={() => deleteTemplate(t.id)}
                        onCreate={() => createOnSpotify(t.id)}
                      />)
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className="text-sm font-medium truncate">{value ?? "—"}</div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 80 ? "bg-primary/20 text-primary border-primary/30"
    : score >= 60 ? "bg-warning/15 text-warning border-warning/30"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded border tabular-nums", tone)}>
      score {Math.round(score)}
    </span>
  );
}

function TemplateCard({ t, creating, onApprove, onReject, onReset, onDelete, onCreate }: {
  t: Template;
  creating: boolean;
  onApprove: () => void;
  onReject: () => void;
  onReset: () => void;
  onDelete: () => void;
  onCreate: () => void;
}) {
  const meta = STATUS_LABEL[t.status] ?? STATUS_LABEL.pending;
  const Icon = meta.icon;
  const isCreated = !!t.spotify_playlist_id;
  return (
    <div className="rounded-lg border border-border bg-background p-3 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[10px] font-mono text-muted-foreground">#{t.variation_index + 1}</span>
          <h5 className="font-bold text-sm truncate">{t.name}</h5>
          <ScoreBadge score={Number(t.replication_score)} />
          <span className={cn("text-[10px] uppercase font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1", meta.tone)}>
            <Icon className="h-3 w-3" /> {meta.label}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {t.status !== "approved" && t.status !== "created" && (
            <Button size="sm" variant="outline" onClick={onApprove} className="h-7 px-2 text-xs">
              <CheckCircle2 className="h-3 w-3" /> Aprovar
            </Button>
          )}
          {t.status === "approved" && !isCreated && (
            <Button size="sm" onClick={onCreate} disabled={creating} className="h-7 px-2 text-xs">
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Music2 className="h-3 w-3" />}
              Criar no Spotify
            </Button>
          )}
          {isCreated && t.spotify_url && (
            <a href={t.spotify_url} target="_blank" rel="noreferrer"
               className="h-7 px-2 text-xs inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20">
              <Music2 className="h-3 w-3" /> Abrir no Spotify <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
          {t.status !== "rejected" && t.status !== "created" && (
            <Button size="sm" variant="outline" onClick={onReject} className="h-7 px-2 text-xs">
              <XCircle className="h-3 w-3" /> Rejeitar
            </Button>
          )}
          {t.status !== "pending" && t.status !== "created" && (
            <Button size="sm" variant="ghost" onClick={onReset} className="h-7 px-2 text-xs">
              Reset
            </Button>
          )}
          {!isCreated && (
            <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 w-7 p-0 text-destructive hover:text-destructive">
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {isCreated && (
        <div className="text-[11px] flex items-center gap-3 px-2 py-1.5 rounded bg-emerald-500/5 border border-emerald-500/20 text-emerald-300">
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

      {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}

      {t.cover_brief && (
        <div className="text-xs p-2 rounded bg-primary/5 border border-primary/20 text-foreground/85 flex items-start gap-1.5">
          <FileText className="h-3 w-3 text-primary shrink-0 mt-0.5" />
          <span>{t.cover_brief}</span>
        </div>
      )}

      {t.keywords?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {t.keywords.slice(0, 8).map((k: any, i: number) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-elevated border border-border">{String(k)}</span>
          ))}
        </div>
      )}

      {t.track_seeds?.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {t.track_seeds.length} faixas-semente
          </summary>
          <div className="mt-1.5 space-y-0.5 max-h-40 overflow-y-auto nx-scroll">
            {t.track_seeds.slice(0, 20).map((s: any, i: number) => (
              <div key={i} className="text-xs flex gap-2">
                <span className="text-muted-foreground tabular-nums w-5">{i + 1}</span>
                <span className="font-medium truncate">{s.nome}</span>
                <span className="text-muted-foreground truncate">— {s.artista}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
