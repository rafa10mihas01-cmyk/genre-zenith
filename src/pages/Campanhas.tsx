import { useMemo, useState } from "react";
import { useScreenField } from "@/lib/screen-state";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/status-dot";
import { Plus, RefreshCw, Target, ListChecks, Calculator, Megaphone, CheckCircle2, Percent, MoreHorizontal, Pause, Play, Archive, ArchiveRestore, Trash2, Handshake, Link2, Copy, Check, Clock, MessageSquareWarning, Upload, Loader2, ImagePlus, X, Mail, Music2, AtSign, Coins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatBRLDetail } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { PUBLIC_DOMAIN } from "@/lib/curatorPublicUrl";
import { Calculadora } from "@/components/operacao/calculadora/Calculadora";
import { KpiBig } from "@/components/KpiBig";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCampaigns, type Campaign } from "@/hooks/useCampaigns";
import { CollectionSourceBadge } from "@/components/campanhas/CollectionSourceBadge";


const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  draft: "neutral",
  paused: "warning",
  completed: "neutral",
  cancelled: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Ativa", draft: "Rascunho", paused: "Pausada", completed: "Concluída", cancelled: "Cancelada",
};

const MAX_MANUAL_BASELINE_FILES = 20;

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Status efetivo (display-only) — corrige duas distorções do banco:
 *  1) NewCampaignDialog grava status='active' direto pelo toggle do form, antes dos portões.
 *     Enquanto plan_approved_at for null, a campanha ainda é rascunho operacional.
 *  2) Nenhum job fecha a campanha quando total_delivered >= goal_plays.
 *     Tratamos como Concluída pra não poluir a aba Ativas.
 * Não muta o banco — apenas como filtramos/rotulamos.
 */
function effectiveStatus(c: { status: string; total_delivered: number | null; goal_plays: number | null; client_approved_at: string | null; plan_approved_at: string | null; collection_mode?: string | null; }): string {
  if (c.status === "cancelled" || c.status === "paused" || c.status === "completed") return c.status;
  const delivered = Number(c.total_delivered || 0);
  const goal = Number(c.goal_plays || 0);
  if (goal > 0 && delivered >= goal) return "completed";
  // Portão 2 (plano interno) é considerado fechado quando:
  //  - plan_approved_at != null, OU
  //  - collection_mode='spreadsheet' E status='active' (modo planilha não grava plan_approved_at;
  //    o portão fica read-only assim que a campanha vai ao ar).
  const planGateClosed = !!c.plan_approved_at || (c.collection_mode === "spreadsheet" && c.status === "active");
  if (!c.client_approved_at || !planGateClosed) return "draft";
  return "active";
}

type PipelineFilter =
  | "all"
  | "awaiting_client"
  | "awaiting_internal"
  | "running"
  | "completed";

const PIPELINE_LABEL: Record<PipelineFilter, string> = {
  all: "Todas",
  awaiting_client: "Aguardando cliente",
  awaiting_internal: "Aguardando você",
  running: "Rodando",
  completed: "Concluída",
};

function pipelineStage(c: import("@/hooks/useCampaigns").Campaign): PipelineFilter {
  const eff = effectiveStatus(c);
  if (eff === "completed" || eff === "cancelled") return "completed";
  if (!c.client_approved_at) return "awaiting_client";
  const planGateClosed = !!c.plan_approved_at || (c.collection_mode === "spreadsheet" && c.status === "active");
  if (!planGateClosed) return "awaiting_internal";
  return "running";
}



export default function Campanhas() {
  const navigate = useNavigate();
  const { items, loading, recalcAll } = useCampaigns();
  const [filter, setFilter] = useScreenField<PipelineFilter>("/campanhas", "filter", "all");
  const [tab, setTab] = useScreenField<"lista" | "financeiro">("/campanhas", "tab", "financeiro");

  const filtered = useMemo(
    () => filter === "all" ? items : items.filter(i => pipelineStage(i) === filter),
    [items, filter]
  );

  const stageCounts = useMemo(() => {
    const counts: Record<PipelineFilter, number> = {
      all: items.length,
      awaiting_client: 0,
      awaiting_internal: 0,
      running: 0,
      completed: 0,
    };
    for (const c of items) counts[pipelineStage(c)]++;
    return counts;
  }, [items]);


  const kpis = useMemo(() => {
    const active = items.filter(i => effectiveStatus(i) === "active");
    const goal = active.reduce((s, i) => s + Number(i.goal_plays || 0), 0);
    const delivered = active.reduce((s, i) => s + Number(i.total_delivered || 0), 0);
    const allocated = active.reduce((s, i) => s + Number(i.total_allocated || 0), 0);
    const pct = goal > 0 ? Math.round((delivered / goal) * 100) : 0;
    // CPP médio ponderado (só campanhas ativas com valor e entrega > 0)
    let totalCost = 0;
    let totalDeliveredCpp = 0;
    for (const c of active) {
      const cost = Number(c.valor_cobrado || 0);
      const d = Number(c.total_delivered || 0);
      if (cost > 0 && d > 0) { totalCost += cost; totalDeliveredCpp += d; }
    }
    const cpp = totalDeliveredCpp > 0 ? totalCost / totalDeliveredCpp : null;
    return { activeCount: active.length, goal, delivered, allocated, pct, cpp };
  }, [items]);

  async function doRecalcAll() {
    try {
      await recalcAll.mutateAsync();
      toast({ title: "Recalculado" });
    } catch (e) {
      toast({ title: "Erro no recálculo", description: (e as Error).message, variant: "destructive" });
    }
  }



  return (
    <>
      <PageHeader
        kicker="Operação"
        icon={Target}
        title="Campanhas"
        subtitle="Metas e distribuição"
        domain="campaigns"
        manualKey="campanhas"

        actions={
          tab === "lista" ? (
            <Button variant="outline" onClick={doRecalcAll} disabled={recalcAll.isPending}>
              <RefreshCw className={`h-4 w-4 mr-2 ${recalcAll.isPending ? "animate-spin" : ""}`} />
              Recalcular
            </Button>
          ) : undefined
        }



      />

      <PageContainer>
        {/* KPIs globais — sempre visíveis pra manter padrão entre abas */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <KpiBig
            tier="hero"
            icon={Target}
            label="Meta total"
            value={kpis.goal.toLocaleString("pt-BR")}
            hint="Plays planejados"
            domain="campaigns"
            loading={loading}
            className="col-span-2 md:col-span-1"
          />
          <KpiBig
            icon={Megaphone}
            label="Ativas"
            value={kpis.activeCount.toLocaleString("pt-BR")}
            hint="Em execução agora"
            domain="campaigns"
            loading={loading}
          />
          <KpiBig
            icon={CheckCircle2}
            label="Entregue"
            value={kpis.delivered.toLocaleString("pt-BR")}
            hint="Plays já contabilizados"
            domain="deals"
            loading={loading}
          />
          <KpiBig
            icon={Percent}
            label="Cumprimento"
            value={`${kpis.pct}%`}
            hint="Entregue ÷ meta"
            domain="playlists"
            loading={loading}
          />
          <KpiBig
            icon={Coins}
            label="CPP médio"
            value={kpis.cpp != null ? formatBRLDetail(kpis.cpp) : "—"}
            hint="Custo por play (ativas)"
            domain="campaigns"
            loading={loading}
          />
        </section>


        {(() => {
          const TABS_TOP = [
            { id: "financeiro", label: "Planejamento", icon: Calculator },
            { id: "lista", label: "Aprovação", icon: ListChecks },
            { id: "deals", label: "Negociações", icon: Handshake },
          ] as const;
          const onPick = (id: typeof TABS_TOP[number]["id"]) => {
            if (id === "deals") navigate("/playlist-deals");
            else setTab(id as "lista" | "financeiro");
          };
          return (
            <>
              {/* Mobile: grid de cards */}
              <div className="grid grid-cols-3 gap-1.5 mb-4 sm:hidden">
                {TABS_TOP.map(t => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => onPick(t.id)}
                      className={cn(
                        "rounded-xl border px-1 py-2 flex flex-col items-center justify-center gap-1 transition-colors",
                        active
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : "border-border bg-card text-muted-foreground hover:text-foreground",
                      )}
                      aria-pressed={active}
                    >
                      <Icon className={cn("h-4 w-4", active ? "text-primary" : "")} />
                      <span className="text-[11px] font-medium leading-none text-center">{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Desktop: rail clássico */}
              <div className="hidden sm:flex items-center gap-1 border-b border-border mb-6 overflow-x-auto overflow-y-hidden scrollbar-none -mx-4 px-4 lg:mx-0 lg:px-0">
                {TABS_TOP.map(t => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => onPick(t.id)}
                      className={cn(
                        "px-3 lg:px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0",
                        active
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          );
        })()}

        {tab === "lista" && (
          <>
            {/* Filtros */}
            {(() => {
              const FILTER_META: Record<PipelineFilter, { icon: typeof ListChecks; short: string }> = {
                all: { icon: ListChecks, short: "Todas" },
                awaiting_client: { icon: Clock, short: "Cliente" },
                awaiting_internal: { icon: MessageSquareWarning, short: "Você" },
                running: { icon: Play, short: "Rodando" },
                completed: { icon: CheckCircle2, short: "Feitas" },
              };
              const order = ["all", "awaiting_client", "awaiting_internal", "running", "completed"] as const;
              return (
                <>
                  {/* Mobile: régua única com 5 colunas, ícone + contagem */}
                  <div className="grid grid-cols-5 gap-1.5 mb-4 sm:hidden">
                    {order.map(f => {
                      const count = stageCounts[f];
                      const meta = FILTER_META[f];
                      const Icon = meta.icon;
                      const isActive = filter === f;
                      const isDisabled = f !== "all" && count === 0;
                      return (
                        <button
                          key={f}
                          onClick={() => setFilter(f)}
                          disabled={isDisabled}
                          aria-label={`${PIPELINE_LABEL[f]} (${count})`}
                          className={`flex flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 transition-colors ${
                            isActive
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-card text-muted-foreground hover:text-foreground"
                          } ${isDisabled ? "opacity-40 pointer-events-none" : ""}`}
                        >
                          <Icon className="w-4 h-4" />
                          <span className="text-[10px] font-medium leading-none truncate max-w-full">{meta.short}</span>
                          <span className="text-[10px] tabular-nums opacity-70 leading-none">{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Desktop / tablet: layout original */}
                  <div className="hidden sm:flex flex-wrap gap-2 mb-4">
                    {order.map(f => {
                      const count = stageCounts[f];
                      return (
                        <Button
                          key={f}
                          variant={filter === f ? "default" : "outline"}
                          size="sm"
                          onClick={() => setFilter(f)}
                          disabled={f !== "all" && count === 0}
                        >
                          {PIPELINE_LABEL[f]}
                          <span className="ml-1.5 text-xs opacity-60 tabular-nums">{count}</span>
                        </Button>
                      );
                    })}
                  </div>
                </>
              );
            })()}

            {/* Lista */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="border border-border rounded-2xl p-12 text-center text-muted-foreground">
                Sem campanhas {filter !== "all" ? PIPELINE_LABEL[filter].toLowerCase() : ""}.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {filtered.map(c => <CampaignRow key={c.id} c={c} />)}
              </div>
            )}
          </>

        )}

        {tab === "financeiro" && <Calculadora />}
      </PageContainer>
    </>
  );
}



function CampaignRow({ c }: { c: Campaign }) {
  const { updateStatus, removeCampaign, approve, refresh } = useCampaigns();
  const pct = c.goal_plays > 0 ? Math.min(100, Math.round((c.total_delivered / c.goal_plays) * 100)) : 0;
  const daysLeft = Math.ceil((new Date(c.deadline).getTime() - Date.now()) / 86400_000);
  const href = c.snapshot_locked_at ? `/campanhas/${c.id}/execucao` : `/campanhas/${c.id}`;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [baselineOpen, setBaselineOpen] = useState(false);
  const [baselineFiles, setBaselineFiles] = useState<Array<{ file: File; url: string }>>([]);
  const [baselineSaving, setBaselineSaving] = useState(false);
  const busy = updateStatus.isPending || removeCampaign.isPending || approve.isPending;

  const clientUrl = c.public_plan_token
    ? `${PUBLIC_DOMAIN}/p/plano/${c.public_plan_token}`
    : null;
  const clientApproved = !!c.client_approved_at;
  const clientPendingAdjust = !!c.client_rejected_at && !clientApproved;

  async function copyClientLink(e?: React.MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (!clientUrl) return;
    try {
      await navigator.clipboard.writeText(clientUrl);
      setCopied(true);
      toast({ title: "Link do cliente copiado", description: "Cole no WhatsApp ou e-mail." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Não consegui copiar", description: clientUrl, variant: "destructive" });
    }
  }

  function addBaselineFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []).filter((file) => file.type.startsWith("image/"));
    const next = [...baselineFiles, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, MAX_MANUAL_BASELINE_FILES);
    setBaselineFiles(next);
  }

  function removeBaselineFile(index: number) {
    const current = baselineFiles[index];
    if (current) URL.revokeObjectURL(current.url);
    setBaselineFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function submitManualBaseline() {
    if (baselineFiles.length === 0) {
      toast({ title: "Envie pelo menos um print", variant: "destructive" });
      return;
    }
    setBaselineSaving(true);
    try {
      const { data: dealRow, error: dealErr } = await supabase
        .from("curator_deals")
        .select("id")
        .eq("campaign_id", c.id)
        .limit(1)
        .maybeSingle();
      if (dealErr) throw dealErr;
      if (!dealRow?.id) throw new Error("Campanha sem deal criado.");
      const dealId = dealRow.id as string;

      const { data: songRow } = await supabase
        .from("curator_deal_songs")
        .select("id")
        .eq("deal_id", dealId)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      const songId = (songRow?.id as string | undefined) ?? null;

      const printUrls: string[] = [];
      for (let i = 0; i < baselineFiles.length; i++) {
        const item = baselineFiles[i];
        const ext = (item.file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
        const path = `${dealId}/manual-baseline-${Date.now()}-${i}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from("deal-prints").upload(path, item.file, {
          contentType: item.file.type || "image/jpeg",
          upsert: false,
        });
        if (uploadErr) throw uploadErr;
        const { data } = supabase.storage.from("deal-prints").getPublicUrl(path);
        printUrls.push(data.publicUrl);
      }

      const images = await Promise.all(baselineFiles.map(async ({ file }) => ({ base64: await fileToBase64(file), mime_type: file.type || "image/jpeg" })));
      const { data: analyzed, error: analyzeErr } = await supabase.functions.invoke("analyze-deal-prints", {
        body: { images, playlists: [], mode: "baseline" },
      });
      if (analyzeErr) throw analyzeErr;
      const matches = ((analyzed as any)?.matches ?? []).filter((m: any) => m?.found && m?.plays != null && m?.playlist_name);
      if (matches.length === 0) throw new Error("Não consegui ler playlists nos prints enviados.");

      const { data: allocs } = await supabase.from("campaign_eco_allocations").select("managed_playlist_id").eq("campaign_id", c.id);
      const managedIds = Array.from(new Set((allocs ?? []).map((a: any) => a.managed_playlist_id).filter(Boolean)));
      const { data: managed } = managedIds.length
        ? await supabase.from("managed_playlists").select("id, name, spotify_playlist_id, spotify_url, followers, cover_url").in("id", managedIds)
        : c.curator_id
          ? await supabase
            .from("managed_playlists")
            .select("id, name, spotify_playlist_id, spotify_url, followers, cover_url")
            .eq("curator_id", c.curator_id)
            .is("archived_at", null)
            .order("followers", { ascending: false, nullsFirst: false })
            .limit(500)
          : { data: [] as any[] };
      const managedByName = new Map((managed ?? []).map((p: any) => [normalizeText(p.name), p]));

      const { data: existing } = await supabase
        // Separação operacional × observacional: dedup só contra playlists operacionais reais.
        .from("v_curator_playlists_operational")
        .select("id, playlist_name, spotify_playlist_id")
        .eq("deal_id", dealId);
      const existingByKey = new Map((existing ?? []).map((p: any) => [p.spotify_playlist_id ? `id:${p.spotify_playlist_id}` : `name:${normalizeText(p.playlist_name)}`, p.id]));
      const capturedAt = new Date().toISOString();
      const snapshotRows: any[] = [];

      for (const match of matches) {
        const managedMatch = managedByName.get(normalizeText(match.playlist_name));
        const key = managedMatch?.spotify_playlist_id ? `id:${managedMatch.spotify_playlist_id}` : `name:${normalizeText(match.playlist_name)}`;
        let playlistId = existingByKey.get(key);
        if (!playlistId) {
          const { data: inserted, error: insertErr } = await supabase
            .from("curator_playlists")
            .insert({
              deal_id: dealId,
              song_id: songId,
              spotify_url: managedMatch?.spotify_url ?? "",
              playlist_name: managedMatch?.name ?? match.playlist_name,
              followers: managedMatch?.followers ?? null,
              is_baseline: true,
              spotify_playlist_id: managedMatch?.spotify_playlist_id ?? null,
              image_url: managedMatch?.cover_url ?? null,
              streams_total: Number(match.plays ?? 0),
              match_status: "curator",
              match_reason: "baseline manual por print",
            } as any)
            .select("id")
            .single();
          if (insertErr) throw insertErr;
          playlistId = inserted.id;
          existingByKey.set(key, playlistId);
        } else if (managedMatch) {
          const { error: updatePlaylistErr } = await supabase
            .from("curator_playlists")
            .update({
              spotify_url: managedMatch.spotify_url ?? `https://open.spotify.com/playlist/${managedMatch.spotify_playlist_id}`,
              playlist_name: managedMatch.name ?? match.playlist_name,
              followers: managedMatch.followers ?? null,
              spotify_playlist_id: managedMatch.spotify_playlist_id ?? null,
              image_url: managedMatch.cover_url ?? null,
              streams_total: Number(match.plays ?? 0),
              match_status: "baseline",
              match_reason: "baseline manual por print",
            } as any)
            .eq("id", playlistId);
          if (updatePlaylistErr) throw updatePlaylistErr;
        }
        snapshotRows.push({
          deal_id: dealId,
          song_id: songId,
          playlist_id: playlistId,
          plays: Number(match.plays ?? 0),
          captured_at: capturedAt,
          print_url: printUrls[Math.max(0, Number(match.source_index ?? 0))] ?? printUrls[0] ?? null,
          is_baseline: true,
          source: "manual_print",
          match_method: managedMatch ? "managed_playlist_name" : "ai_name",
          ai_raw: match,
        });
      }

      // Dedupe por playlist_id: a IA pode ler a mesma playlist em prints diferentes.
      // Mantém a linha com mais plays (mais completa) e evita violar
      // UNIQUE (playlist_id, captured_at).
      const dedupMap = new Map<string, any>();
      for (const row of snapshotRows) {
        const key = String(row.playlist_id);
        const prev = dedupMap.get(key);
        if (!prev || Number(row.plays || 0) > Number(prev.plays || 0)) {
          dedupMap.set(key, row);
        }
      }
      const uniqueSnapshotRows = Array.from(dedupMap.values());
      const total = uniqueSnapshotRows.reduce((sum, row) => sum + Number(row.plays || 0), 0);
      const { error: snapErr } = await supabase
        .from("curator_deal_snapshots")
        .upsert(uniqueSnapshotRows, { onConflict: "playlist_id,captured_at", ignoreDuplicates: false });
      if (snapErr) throw snapErr;
      const { error: logErr } = await supabase.from("curator_deal_logs").insert({
        deal_id: dealId,
        song_id: songId,
        total_plays: total,
        note: "[manual] baseline por prints",
        is_baseline: true,
        print_urls: printUrls,
      } as any);
      if (logErr) throw logErr;
      await supabase.from("curator_deals").update({ state: "collecting", baseline_captured_at: capturedAt, baseline_plays: total } as any).eq("id", dealId);
      const { data: planResult, error: planErr } = await supabase.functions.invoke("build-deal-plan", {
        body: { deal_id: dealId },
      });
      if (planErr) throw planErr;
      if ((planResult as any)?.ok === false) throw new Error((planResult as any)?.error ?? "Falha ao gerar plano de entrega.");

      toast({ title: "Baseline registrada", description: `${uniqueSnapshotRows.length} playlist(s) lida(s) · plano gerado` });
      setBaselineOpen(false);
      baselineFiles.forEach((item) => URL.revokeObjectURL(item.url));
      setBaselineFiles([]);
      await refresh();
    } catch (err) {
      toast({ title: "Erro ao registrar baseline", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBaselineSaving(false);
    }
  }

  async function doUpdateStatus(status: Campaign["status"], label: string) {
    try {
      await updateStatus.mutateAsync({ id: c.id, status });
      toast({ title: label });
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function approveCampaign() {
    if (!c.curator_id) {
      toast({ title: "Sem curador", description: "Edite a campanha e selecione o curador dono das playlists.", variant: "destructive" });
      return;
    }
    try {
      const data = await approve.mutateAsync(c.id);
      toast({ title: "Campanha aprovada", description: "Deal real criado e enviado para a fila de coleta." });
      return data;
    } catch (e) {
      const raw = (e as Error).message ?? "";
      const map: Record<string, { title: string; description: string }> = {
        client_approval_required: {
          title: "Aguardando aprovação do cliente",
          description: "Copie o link público do plano e mande pro cliente. Quando ele aprovar, este botão libera.",
        },
        curator_required: {
          title: "Sem curador",
          description: "Edite a campanha e selecione o curador dono das playlists.",
        },
        campaign_not_in_approvable_state: {
          title: "Campanha já aprovada",
          description: "Esta campanha não está em rascunho — não precisa aprovar de novo.",
        },
        campaign_not_found: {
          title: "Campanha não encontrada",
          description: "Talvez tenha sido excluída. Recarregue a página.",
        },
        baseline_required: {
          title: "Falta a planilha baseline do cliente",
          description: "Peça pro cliente subir a primeira planilha no portal antes de distribuir — sem baseline o sistema não consegue medir entrega.",
        },
      };
      const key = Object.keys(map).find((k) => raw.includes(k));
      const t = key ? map[key] : { title: "Erro ao aprovar", description: raw };
      toast({ title: t.title, description: t.description, variant: "destructive" });
    }
  }

  async function doDelete() {
    try {
      await removeCampaign.mutateAsync(c.id);
      toast({ title: "Campanha excluída" });
    } catch (e) {
      toast({ title: "Erro ao excluir", description: (e as Error).message, variant: "destructive" });
    } finally {
      setConfirmDelete(false);
    }
  }


  // Mostra "Aprovar e disparar" só quando: cliente já aprovou, plano ainda
  // não foi disparado internamente, e a campanha não está cancelada/encerrada.
  // Enquanto estiver "Aguardando cliente" o botão fica oculto — não faz
  // sentido aprovar internamente antes do cliente bater o ok.
  const isDraftReady =
    !!c.client_approved_at &&
    !c.plan_approved_at &&
    c.status !== "cancelled" &&
    c.status !== "completed";

  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

  const eff = effectiveStatus(c as any);
  const mode = (c as any).collection_mode as string | undefined;
  const isSpreadsheet = mode === "spreadsheet";
  const hasBaseline = !!c.baseline_captured_at;
  const baselineChip = (() => {
    if (isSpreadsheet) {
      return hasBaseline ? (
        <span
          className="text-[10px] uppercase tracking-wider rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary"
          title={`Baseline coletada em ${new Date(c.baseline_captured_at!).toLocaleString("pt-BR")}`}
        >
          Baseline ok
        </span>
      ) : (
        <span
          className="text-[10px] uppercase tracking-wider rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-500"
          title="Cliente ainda não enviou a primeira planilha (baseline)."
        >
          Baseline pendente
        </span>
      );
    }
    if (c.plan_approved_at && hasBaseline) {
      return (
        <span className="text-[10px] uppercase tracking-wider rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary">
          Baseline ok
        </span>
      );
    }
    if (c.plan_approved_at && !hasBaseline) {
      const bstatus = (c as any).baseline_status as string | null | undefined;
      return (
        <span
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-500"
          title="Bot ainda não capturou a baseline. Coleta roda automaticamente no próximo ciclo do bot Spotify."
        >
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-60 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
          </span>
          {bstatus === "failed" ? "Baseline falhou" : "Aguardando baseline"}
        </span>
      );
    }
    return null;
  })();

  const daysChip =
    daysLeft > 0
      ? `${daysLeft}d restantes`
      : daysLeft === 0
        ? "Vence hoje"
        : `${Math.abs(daysLeft)}d em atraso`;

  return (
    <div className="relative">
      <Link
        to={href}
        className="group block rounded-2xl border border-border/50 border-l-2 border-l-domain-campaigns/60 bg-card hover:bg-[hsl(var(--elevated))] hover:border-foreground/20 hover:border-l-domain-campaigns transition-colors flex flex-col h-full"
      >
        {/* Linha 1 — identidade */}
        <div className="flex items-start gap-3 px-4 pt-3.5 pb-2.5 min-w-0 pr-10">
          {c.cover_url ? (
            <img
              src={c.cover_url}
              alt=""
              loading="lazy"
              className="h-10 w-10 rounded-md object-cover shrink-0"
            />
          ) : (
            <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0">
              <Music2 className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2 min-w-0">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-foreground truncate leading-tight">
                  {c.track_name}
                </div>
                <div className="text-[11.5px] text-muted-foreground truncate mt-0.5">
                  {c.artist && <span>{c.artist}</span>}
                  {c.artist && <span className="mx-1.5 opacity-50">·</span>}
                  <span>{daysChip}</span>
                </div>
              </div>
              <div className="shrink-0 mt-0.5 flex items-center gap-1.5">
                <StatusDot variant={STATUS_TONE[eff]} />
                <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  {STATUS_LABEL[eff]}
                </span>
              </div>
            </div>
            {/* Chips — alinhados com nome */}
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <CollectionSourceBadge collectionMode={mode} />
              {baselineChip}
              {c.status === "draft" && hasBaseline && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary">
                  <span className="relative inline-flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                  </span>
                  Pronto p/ aprovação
                </span>
              )}
              {(c.client_decision_round ?? 1) > 1 && (
                <span className="text-[10px] uppercase tracking-wider rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-500">
                  Rodada {c.client_decision_round}
                </span>
              )}
              {(c.access_emails_count ?? 0) > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider rounded border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-blue-400"
                  title={`${c.access_emails_count} e-mail(s) com acesso ao portal do cliente`}
                >
                  <Mail className="h-2.5 w-2.5" />
                  Acesso · {c.access_emails_count}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Divisor sutil */}
        <div className="mx-4 border-t border-border/40" />

        {/* Linha 2 — métricas + progresso + footer */}
        <div className="flex flex-col gap-3 px-4 py-3 min-w-0 mt-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium mb-0.5">Meta</div>
              <div className="text-[14px] font-semibold tabular-nums">{c.goal_plays.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium mb-0.5">Entregue</div>
              <div className="text-[14px] font-semibold tabular-nums">{c.total_delivered.toLocaleString()}</div>
            </div>
          </div>

          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
              <span className="uppercase tracking-[0.12em] font-medium">Progresso</span>
              <span className="tabular-nums font-semibold text-foreground">{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </div>

          {/* Aprovação do cliente — visível em rascunho e ativa */}
          {clientUrl && (c.status === "draft" || c.status === "active") && (
            <div
              className={cn(
                "rounded-lg border px-2.5 py-1.5 flex items-center justify-between gap-2",
                clientApproved
                  ? "border-primary/30 bg-primary/5"
                  : clientPendingAdjust
                    ? "border-amber-500/30 bg-amber-500/5"
                    : "border-border/60 bg-muted/20",
              )}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {clientApproved ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                ) : clientPendingAdjust ? (
                  <MessageSquareWarning className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                ) : (
                  <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="text-[11px] truncate">
                  {clientApproved
                    ? `Aprovado por ${c.client_approved_by ?? "cliente"}`
                    : clientPendingAdjust
                      ? "Cliente pediu ajuste"
                      : "Aguardando cliente"}
                </span>
              </div>
              <button
                type="button"
                onClick={copyClientLink}
                className="shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                title="Copiar link de aprovação do cliente"
              >
                {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copiado" : "Copiar link"}
              </button>
            </div>
          )}
        </div>
      </Link>

      <div className="absolute top-3 right-3" onClick={stop}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              disabled={busy}
              onClick={stop}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={stop}>
            {clientUrl && (
              <>
                <DropdownMenuItem onSelect={() => copyClientLink()}>
                  <Link2 className="h-4 w-4 mr-2" /> Copiar link do cliente
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setBaselineOpen(true); }}>
              <Upload className="h-4 w-4 mr-2" /> Enviar prints da baseline
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {isDraftReady && (
              <>
                <DropdownMenuItem
                  onSelect={() => approveCampaign()}
                  className={cn(!!c.baseline_captured_at && "text-primary focus:text-primary focus:bg-primary/10")}
                >
                  <CheckCircle2 className={cn("h-4 w-4 mr-2", !!c.baseline_captured_at ? "text-primary" : "text-primary")} />
                  {!!c.baseline_captured_at && (
                    <span className="relative inline-flex h-1.5 w-1.5 mr-1.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                    </span>
                  )}
                  Aprovar e disparar
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {c.status === "paused" ? (
              <DropdownMenuItem onSelect={() => doUpdateStatus("active", "Campanha retomada")}>
                <Play className="h-4 w-4 mr-2" /> Retomar
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={c.status === "completed" || c.status === "cancelled" || c.status === "draft"}
                onSelect={() => doUpdateStatus("paused", "Campanha pausada")}
              >
                <Pause className="h-4 w-4 mr-2" /> Pausar
              </DropdownMenuItem>
            )}
            {c.status === "cancelled" ? (
              <DropdownMenuItem onSelect={() => doUpdateStatus("draft", "Campanha desarquivada")}>
                <ArchiveRestore className="h-4 w-4 mr-2" /> Desarquivar
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={() => doUpdateStatus("cancelled", "Campanha arquivada")}
              >
                <Archive className="h-4 w-4 mr-2" /> Arquivar
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={baselineOpen} onOpenChange={(open) => !baselineSaving && setBaselineOpen(open)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Enviar prints da baseline</DialogTitle>
            <DialogDescription>
              Envie os prints do Spotify for Artists para registrar a baseline manualmente nesta campanha.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center hover:bg-muted/30 transition-colors">
              <ImagePlus className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium">Selecionar prints</span>
              <span className="text-xs text-muted-foreground">PNG ou JPG · até {MAX_MANUAL_BASELINE_FILES} arquivos</span>
              <Input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={baselineSaving}
                onChange={(e) => addBaselineFiles(e.target.files)}
              />
            </label>

            {baselineFiles.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {baselineFiles.map((item, index) => (
                  <div key={`${item.file.name}-${index}`} className="relative aspect-video overflow-hidden rounded-lg border border-border bg-muted">
                    <img src={item.url} alt={`Print ${index + 1}`} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      disabled={baselineSaving}
                      onClick={() => removeBaselineFile(index)}
                      className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-foreground hover:bg-background"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={baselineSaving} onClick={() => setBaselineOpen(false)}>Cancelar</Button>
            <Button disabled={baselineSaving || baselineFiles.length === 0} onClick={submitManualBaseline}>
              {baselineSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Registrar baseline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          {(() => {
            const blocked = c.status === "active" || (c.total_delivered ?? 0) > 0;
            return blocked ? (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>Não é possível excluir</AlertDialogTitle>
                  <AlertDialogDescription>
                    Campanhas ativas ou com entrega registrada não podem ser excluídas. Use <strong>Arquivar</strong> para encerrar a campanha sem perder o histórico.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>Fechar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => { e.preventDefault(); setConfirmDelete(false); doUpdateStatus("cancelled", "Campanha arquivada"); }}
                    disabled={busy || c.status === "cancelled"}
                  >
                    Arquivar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            ) : (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir campanha "{c.track_name}"?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2">
                      <p>Esta ação apagará permanentemente:</p>
                      <ul className="list-disc pl-5 text-[13px] space-y-1">
                        <li>O deal vinculado a esta campanha</li>
                        <li>Todas as playlists do curador deste deal</li>
                        <li>Prints coletados e snapshots</li>
                        <li>Provas de entrega</li>
                        <li>Pagamentos registrados</li>
                      </ul>
                      <p className="font-medium text-destructive pt-1">Esta ação não pode ser desfeita.</p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={doDelete}
                    disabled={busy}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Excluir tudo
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
