import { useEffect, useMemo, useState } from "react";
import {
  Sparkles, Flame, AlertTriangle, Archive, RefreshCw, Loader2,
  Check, Music2, ExternalLink, AlertCircle, ChevronDown, ChevronRight,
  Send, Image as ImageIcon, Pencil, X, Play, Inbox, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  cover_variations: Array<{ index: number; url: string }> | null;
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
};

export default function Criacao() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [expiring, setExpiring] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<Template | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("playlist_templates")
      .select("id,name,description,status,replication_score,final_score,quality_tier,score_breakdown,cover_brief,cover_image_url,cover_variations,cover_selected_index,cover_generated_at,auto_cover_requested,spotify_playlist_id,spotify_url,spotify_owner_id,track_seeds,tracks_added,tracks_failed,creation_error,created_on_spotify_at,genre_id,blueprint_id")
      .in("status", ["pending", "approved", "created", "archived"])
      .order("final_score", { ascending: false })
      .limit(300);
    if (data) setTemplates(data as any);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

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

  // ─── grupos por tier ───
  const groups = useMemo(() => {
    const hot: Template[] = [];
    const medium: Template[] = [];
    const archived: Template[] = [];
    const published: Template[] = [];
    for (const t of templates) {
      if (t.status === "created") published.push(t);
      else if (t.status === "archived" || t.quality_tier === "weak") archived.push(t);
      else if (t.quality_tier === "hot") hot.push(t);
      else medium.push(t);
    }
    return { hot, medium, archived, published };
  }, [templates]);

  const kpi = useMemo(() => ({
    hot: groups.hot.length,
    medium: groups.medium.length,
    archived: groups.archived.length,
    published7d: (() => {
      const cutoff = Date.now() - 7 * 86400_000;
      return groups.published.filter(t => t.created_on_spotify_at && new Date(t.created_on_spotify_at).getTime() > cutoff).length;
    })(),
  }), [groups]);

  return (
    <PageContainer>
      <PageHeader
        kicker="Módulo de Criação"
        icon={Sparkles}
        title="Cockpit de Execução"
        subtitle="Templates ranqueados pelo sistema. Aprovar, escolher capa e publicar em poucos cliques."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="rounded-full h-9 gap-1.5"
              onClick={expireStale}
              disabled={expiring}
              title="Arquiva templates ⚠️ médios parados há mais de 72h"
            >
              {expiring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
              Expirar 72h
            </Button>
            <Button
              variant="outline"
              className="rounded-full h-9 gap-1.5"
              onClick={rescoreAll}
              disabled={scoring}
            >
              {scoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Reranquear
            </Button>
            <Button
              variant="premium"
              className="rounded-full h-9 gap-1.5"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Atualizar
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBig icon={Flame}         label="Prontos pra publicar" value={kpi.hot}        tone="primary" hint="Score ≥ 75" />
        <KpiBig icon={AlertTriangle} label="Médios"               value={kpi.medium}     tone="warning" hint="Precisam ajuste" />
        <KpiBig icon={Send}          label="Publicadas (7d)"      value={kpi.published7d} tone="primary" hint="Foram pro Spotify" />
        <KpiBig icon={Archive}       label="Arquivados"           value={kpi.archived}   hint="Auto-removidos" />
      </section>

      {/* HOT */}
      <Section
        icon={Flame}
        iconClass="text-primary"
        title="🔥 Prontos pra publicar"
        subtitle="Score ≥ 75 — capas auto-geradas, fluxo de 2 cliques"
        count={groups.hot.length}
        emptyTitle={loading ? "Carregando…" : "Nenhum template pronto"}
        emptyMsg={loading ? "" : "Quando o Cérebro gerar templates fortes, eles aparecem aqui."}
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {groups.hot.map(t => (
            <TemplateCard key={t.id} t={t} variant="hot" onOpen={() => setActiveTemplate(t)} />
          ))}
        </div>
      </Section>

      {/* MEDIUM */}
      <Section
        icon={AlertTriangle}
        iconClass="text-warning"
        title="⚠️ Médios"
        subtitle="Precisam aprovação manual antes de publicar"
        count={groups.medium.length}
        emptyTitle={loading ? "" : "Sem médios pendentes"}
        emptyMsg=""
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {groups.medium.map(t => (
            <TemplateCard key={t.id} t={t} variant="medium" onOpen={() => setActiveTemplate(t)} />
          ))}
        </div>
      </Section>

      {/* PUBLISHED (info, sem ação principal) */}
      {groups.published.length > 0 && (
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
      )}

      {/* ARCHIVED — colapsado */}
      {groups.archived.length > 0 && (
        <ArchivedSection
          items={groups.archived}
          showArchived={showArchived}
          setShowArchived={setShowArchived}
          onOpen={setActiveTemplate}
        />
      )}

      {/* DETAIL DIALOG */}
      <TemplateDetailDialog
        template={activeTemplate}
        onClose={() => setActiveTemplate(null)}
        onChanged={async () => { await load(); }}
      />
    </PageContainer>
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
  t, variant, onOpen,
}: { t: Template; variant: CardVariant; onOpen: () => void }) {
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
      "nx-card !p-0 overflow-hidden flex flex-col group transition-all",
      isArchived && "opacity-60",
    )}>
      {/* Cover */}
      <button onClick={onOpen} className="relative aspect-square bg-elevated overflow-hidden">
        {t.cover_image_url ? (
          <img src={t.cover_image_url} alt="" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
        ) : t.cover_variations && t.cover_variations.length > 0 ? (
          <div className="grid grid-cols-2 grid-rows-2 w-full h-full">
            {t.cover_variations.slice(0, 4).map(v => (
              <img key={v.index} src={v.url} alt="" className="w-full h-full object-cover" />
            ))}
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground gap-1.5">
            {t.auto_cover_requested ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-[9px] uppercase tracking-wider">Gerando…</span>
              </>
            ) : (
              <>
                <ImageIcon className="h-5 w-5" />
                <span className="text-[9px] uppercase tracking-wider">Sem capa</span>
              </>
            )}
          </div>
        )}
        <div className="absolute top-1.5 left-1.5">{tierBadge}</div>
        <div className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 h-4 rounded text-[9px] font-bold text-foreground bg-background/80 backdrop-blur border border-border tabular-nums">
          {score}
        </div>
      </button>

      {/* Info */}
      <div className="p-2 flex-1 flex flex-col gap-1.5">
        <div className="min-w-0">
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
  template, onClose, onChanged,
}: { template: Template | null; onClose: () => void; onChanged: () => Promise<void> }) {
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

  async function generateCovers() {
    if (!tpl) return;
    setBusy("cover");
    const { data, error } = await supabase.functions.invoke("generate-cover-variations", {
      body: { template_id: tpl.id },
    });
    setBusy(null);
    if (error || !(data as any)?.ok) {
      toast({ title: "Falha ao gerar capas", description: error?.message || (data as any)?.error || "Erro", variant: "destructive" });
      return;
    }
    toast({ title: "Capas geradas" });
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
                  {(!tpl.cover_variations || tpl.cover_variations.length === 0) && (
                    <Button
                      onClick={generateCovers}
                      disabled={busy === "cover"}
                      size="sm"
                      variant="premium"
                      className="rounded-full h-8 gap-1.5"
                    >
                      {busy === "cover" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      Gerar 4 variações
                    </Button>
                  )}
                </div>
                {tpl.cover_variations && tpl.cover_variations.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2">
                    {tpl.cover_variations.map(v => {
                      const isSel = tpl.cover_selected_index === v.index;
                      return (
                        <button
                          key={v.index}
                          onClick={() => selectCover(v.index, v.url)}
                          className={cn(
                            "relative aspect-square rounded-lg overflow-hidden border-2 transition-all",
                            isSel ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-muted-foreground",
                          )}
                        >
                          <img src={v.url} alt="" className="w-full h-full object-cover" />
                          {isSel && (
                            <div className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground rounded-full p-0.5">
                              <Check className="h-3 w-3" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : busy === "cover" || tpl.auto_cover_requested ? (
                  <div className="grid grid-cols-4 gap-2">
                    {[0,1,2,3].map(i => (
                      <div key={i} className="aspect-square rounded-lg bg-elevated border border-border flex items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="aspect-[4/1] rounded-lg border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground">
                    Sem capas geradas. Clique em Gerar 4 variações.
                  </div>
                )}
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
