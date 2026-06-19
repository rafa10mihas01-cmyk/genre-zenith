import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import {
  CalendarDays, AlertCircle, Clock, CheckCircle2, ChevronDown, ChevronRight,
  Sparkles, History as HistoryIcon, Music2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** Janela padrão entre manutenções (alinhada com SEO experiments / cooldown). */
const MAINT_WINDOW_DAYS = 14;

type ItemLite = {
  id: string;
  spotify_playlist_id: string;
  name: string;
  cover_url: string | null;
  genre_id: string | null;
  archived_at: string | null;
  imported_at: string;
  last_maintenance_at?: string | null;
  lifecycle_stage?: "onboarding" | "testing" | "mature" | null;
};

type GenreLite = { id: string; nome: string };

type CooldownRow = {
  playlist_id: string;
  action_type: string;
  cooldown_until: string;
  reason: string | null;
};

type AdjustmentRow = {
  id: string;
  spotify_playlist_id: string | null;
  template_id: string | null;
  action_type: string;
  status: string;
  created_at: string;
};

type Bucket = "atrasada" | "hoje" | "proxima7" | "futura" | "cooldown" | "onboarding";

const BUCKET_META: Record<Bucket, { label: string; cls: string; icon: LucideIcon; hint: string }> = {
  atrasada:   { label: "Atrasadas",        cls: "text-destructive border-destructive/40 bg-destructive/10", icon: AlertCircle,   hint: "Já passou da janela ideal de manutenção." },
  hoje:       { label: "Hoje",             cls: "text-primary border-primary/40 bg-primary/10",             icon: Sparkles,      hint: "Pode mexer hoje." },
  proxima7:   { label: "Próximos 7 dias",  cls: "text-warning border-warning/40 bg-warning/10",             icon: CalendarDays,  hint: "Manutenção entra na janela em breve." },
  cooldown:   { label: "Em cooldown",      cls: "text-muted-foreground border-border bg-muted/30",          icon: Clock,         hint: "Esperando assentar — não mexer." },
  futura:     { label: "Mais para frente", cls: "text-muted-foreground border-border bg-elevated",          icon: CheckCircle2,  hint: "Estável, sem ação prevista." },
  onboarding: { label: "Em onboarding",    cls: "text-muted-foreground border-border bg-muted/20",          icon: Music2,        hint: "Ainda coletando dados — não conta como manutenção." },
};

const ACTION_LABEL: Record<string, string> = {
  swap_tracks: "Troca de músicas",
  swap: "Troca",
  track_change: "Mudança de faixa",
  pause: "Pausada",
  resume: "Retomada",
  rename: "Renomeada",
  description_update: "Descrição atualizada",
  cover_update: "Capa atualizada",
  seo_experiment_apply: "Experimento SEO",
};

function labelAction(a: string) {
  return ACTION_LABEL[a] ?? a.replace(/_/g, " ");
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function daysBetween(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export function MaintenanceCalendarDialog({
  open,
  onOpenChange,
  items,
  genres,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: ItemLite[];
  genres: GenreLite[];
}) {
  const [loading, setLoading] = useState(false);
  const [cooldowns, setCooldowns] = useState<CooldownRow[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeBucket, setActiveBucket] = useState<Bucket | "all">("all");

  const activeItems = useMemo(() => items.filter(i => !i.archived_at), [items]);
  const genreMap = useMemo(() => Object.fromEntries(genres.map(g => [g.id, g.nome])), [genres]);

  useEffect(() => {
    if (!open || activeItems.length === 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const ids = activeItems.map(i => i.id);
      const spIds = activeItems.map(i => i.spotify_playlist_id).filter(Boolean);
      const since = new Date(Date.now() - 90 * 86400000).toISOString();
      const nowIso = new Date().toISOString();

      const [{ data: cds }, { data: adjs }] = await Promise.all([
        supabase
          .from("playlist_cooldowns")
          .select("playlist_id,action_type,cooldown_until,reason")
          .in("playlist_id", ids)
          .gt("cooldown_until", nowIso),
        spIds.length
          ? supabase
              .from("playlist_adjustments")
              .select("id,spotify_playlist_id,template_id,action_type,status,created_at")
              .in("spotify_playlist_id", spIds)
              .gte("created_at", since)
              .order("created_at", { ascending: false })
              .limit(500)
          : Promise.resolve({ data: [] as AdjustmentRow[] }),
      ]);
      if (cancelled) return;
      setCooldowns((cds as CooldownRow[]) ?? []);
      setAdjustments((adjs as AdjustmentRow[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, activeItems]);

  const rows = useMemo(() => {
    const now = new Date();
    const cdByPl = new Map<string, CooldownRow[]>();
    cooldowns.forEach(c => {
      const arr = cdByPl.get(c.playlist_id) ?? [];
      arr.push(c);
      cdByPl.set(c.playlist_id, arr);
    });
    const adjBySp = new Map<string, AdjustmentRow[]>();
    adjustments.forEach(a => {
      if (!a.spotify_playlist_id) return;
      const arr = adjBySp.get(a.spotify_playlist_id) ?? [];
      arr.push(a);
      adjBySp.set(a.spotify_playlist_id, arr);
    });

    return activeItems.map((it) => {
      const lifecycle = it.lifecycle_stage ?? null;
      const cds = cdByPl.get(it.id) ?? [];
      const maxCooldown = cds.reduce<Date | null>((max, c) => {
        const d = new Date(c.cooldown_until);
        return !max || d > max ? d : max;
      }, null);

      const lastMaint = it.last_maintenance_at ? new Date(it.last_maintenance_at) : null;
      const baseline = lastMaint ?? new Date(it.imported_at);
      const nextDue = new Date(baseline.getTime() + MAINT_WINDOW_DAYS * 86400000);
      const effectiveNext = maxCooldown && maxCooldown > nextDue ? maxCooldown : nextDue;
      const diffDays = daysBetween(effectiveNext, now);

      let bucket: Bucket;
      if (lifecycle === "onboarding") bucket = "onboarding";
      else if (maxCooldown && maxCooldown > now) bucket = "cooldown";
      else if (diffDays < 0) bucket = "atrasada";
      else if (diffDays === 0) bucket = "hoje";
      else if (diffDays <= 7) bucket = "proxima7";
      else bucket = "futura";

      return {
        item: it,
        bucket,
        lastMaint,
        nextDue: effectiveNext,
        diffDays,
        maxCooldown,
        history: (adjBySp.get(it.spotify_playlist_id) ?? []).slice(0, 6),
      };
    }).sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime());
  }, [activeItems, cooldowns, adjustments]);

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { atrasada: 0, hoje: 0, proxima7: 0, cooldown: 0, futura: 0, onboarding: 0 };
    rows.forEach(r => { c[r.bucket] += 1; });
    return c;
  }, [rows]);

  const filteredRows = activeBucket === "all" ? rows : rows.filter(r => r.bucket === activeBucket);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            Calendário de manutenção
          </DialogTitle>
          <DialogDescription>
            Quando cada playlist está pronta para a próxima manutenção. Janela padrão de {MAINT_WINDOW_DAYS} dias após a última intervenção para deixar os dados assentarem.
          </DialogDescription>
        </DialogHeader>

        {/* Filtros por bucket */}
        <div className="flex flex-wrap gap-1.5 -mt-1">
          <BucketChip label={`Todas (${rows.length})`} active={activeBucket === "all"} onClick={() => setActiveBucket("all")} />
          {(Object.keys(BUCKET_META) as Bucket[]).map((b) => {
            if (counts[b] === 0) return null;
            const meta = BUCKET_META[b];
            return (
              <BucketChip
                key={b}
                label={`${meta.label} (${counts[b]})`}
                active={activeBucket === b}
                onClick={() => setActiveBucket(b)}
                className={meta.cls}
              />
            );
          })}
        </div>

        <div className="overflow-y-auto -mx-6 px-6 flex-1 mt-2">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-10">
              Nenhuma playlist nesta categoria.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {filteredRows.map((r) => {
                const meta = BUCKET_META[r.bucket];
                const Icon = meta.icon;
                const isOpen = !!expanded[r.item.id];
                const genreName = r.item.genre_id ? genreMap[r.item.genre_id] ?? "—" : "Sem gênero";
                return (
                  <li key={r.item.id} className="rounded-2xl border border-border bg-card overflow-hidden">
                    <button
                      onClick={() => setExpanded((e) => ({ ...e, [r.item.id]: !isOpen }))}
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-elevated/60 transition-colors"
                    >
                      {r.item.cover_url ? (
                        <img src={r.item.cover_url} alt="" className="h-10 w-10 rounded-md object-cover shrink-0" loading="lazy" />
                      ) : (
                        <div className="h-10 w-10 rounded-md bg-muted shrink-0 grid place-items-center">
                          <Music2 className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-foreground truncate">{r.item.name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {genreName} ·{" "}
                          {r.lastMaint
                            ? <>Última manutenção {timeAgo(r.lastMaint.toISOString())}</>
                            : <>Sem manutenção registrada</>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wider", meta.cls)}>
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {r.bucket === "onboarding"
                            ? "—"
                            : r.diffDays < 0
                              ? `${Math.abs(r.diffDays)}d atrasada`
                              : r.diffDays === 0
                                ? `Pronta hoje`
                                : `Em ${r.diffDays}d · ${fmtDate(r.nextDue)}`}
                        </span>
                      </div>
                      {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </button>
                    {isOpen && (
                      <div className="border-t border-border bg-elevated/40 px-3 py-3 space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[11px]">
                          <KV label="Última manutenção" value={r.lastMaint ? r.lastMaint.toLocaleDateString("pt-BR") : "—"} />
                          <KV label="Próxima janela" value={r.nextDue.toLocaleDateString("pt-BR")} />
                          <KV label="Ciclo" value={`${MAINT_WINDOW_DAYS} dias`} />
                          {r.maxCooldown && (
                            <KV label="Cooldown até" value={r.maxCooldown.toLocaleDateString("pt-BR")} />
                          )}
                          <KV label="Estágio" value={r.item.lifecycle_stage ?? "—"} />
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                            <HistoryIcon className="h-3 w-3" /> Histórico recente
                          </div>
                          {r.history.length === 0 ? (
                            <div className="text-[12px] text-muted-foreground">Sem intervenções nos últimos 90 dias.</div>
                          ) : (
                            <ul className="space-y-1">
                              {r.history.map((h) => (
                                <li key={h.id} className="flex items-center justify-between text-[12px]">
                                  <span className="text-foreground/80 truncate">{labelAction(h.action_type)}</span>
                                  <span className="text-muted-foreground tabular-nums shrink-0 ml-2">
                                    {timeAgo(h.created_at)} · {h.status}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground italic">{meta.hint}</div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BucketChip({ label, active, onClick, className }: { label: string; active: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-7 px-3 rounded-full text-[11px] font-medium border transition-colors tabular-nums",
        active
          ? className ?? "bg-primary/15 border-primary/40 text-primary"
          : "bg-elevated border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-foreground/90 tabular-nums">{value}</div>
    </div>
  );
}
