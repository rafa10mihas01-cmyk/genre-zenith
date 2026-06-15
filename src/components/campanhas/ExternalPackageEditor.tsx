import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import {
  ensureExternalPackageDraft,
  confirmExternalPackage,
  reopenExternalPackage,
  updatePackageItem,
  removePackageItem,
  addPackageItem,
  repairExternalPackageLinks,
  fetchCuratorCandidates,
  type CuratorCandidate,
} from "@/lib/externalPackage";
import { Link } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { Loader2, Trash2, Users, AlertTriangle, CheckCircle2, Plus, BarChart3, CalendarClock, DollarSign, Target, ExternalLink, Pencil, History, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HistoricoPrevioBadge, HistoricoPrevioRecommendation } from "@/components/campanhas/HistoricoPrevio";

export type CuratorDelivery = { total: number; clean: number; prior: number };
import { KpiBig } from "@/components/KpiBig";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function formatStreamsWord(n: number): string {
  if (!n || n <= 0) return "—";
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2).replace(/\.?0+$/, "")} milhão`.replace("1 milhão", "1 milhão").replace(/^(?!1 )(\S+) milhão/, "$1 milhões");
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "")} mil`;
  }
  return formatInt(n);
}

type PackageRow = {
  id: string;
  status: string;
  target_streams: number;
  target_cost: number;
  confirmed_at: string | null;
};

type ItemRow = {
  id: string;
  curator_id: string;
  assigned_streams: number;
  assigned_cost: number;
  cost_per_stream: number;
  curator_deal_id: string | null;
  curators: { name: string; contact: string | null } | null;
  curator_deals: {
    state: string | null;
    reconciled_total_plays: number | null;
    ends_at: string | null;
    closed_status: string | null;
  } | null;
};

export function ExternalPackageEditor({
  campaignId,
  snapshot,
  onChanged,
  renderTabsRow,
  headerExtra,
}: {
  campaignId: string;
  snapshot: CampaignSnapshot;
  onChanged?: () => void;
  renderTabsRow?: (extra?: React.ReactNode, ctx?: { isDispatched: boolean }) => React.ReactNode;
  headerExtra?: React.ReactNode;
}) {
  const [pkg, setPkg] = useState<PackageRow | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [deliveryByCurator, setDeliveryByCurator] = useState<Record<string, CuratorDelivery>>({});
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopening, setReopening] = useState(false);

  const [candidates, setCandidates] = useState<CuratorCandidate[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ItemRow | null>(null);
  const [editTarget, setEditTarget] = useState<ItemRow | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [totalDrafts, setTotalDrafts] = useState<Record<string, string>>({});
  const [perDayDrafts, setPerDayDrafts] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try {
      const { packageId } = await ensureExternalPackageDraft(campaignId, snapshot);
      await repairExternalPackageLinks(packageId);
      const [{ data: p }, { data: its }, cand] = await Promise.all([
        supabase
          .from("campaign_external_packages")
          .select("id, status, target_streams, target_cost, confirmed_at")
          .eq("id", packageId)
          .single(),
        supabase
          .from("campaign_external_package_items")
          .select("id, curator_id, assigned_streams, assigned_cost, cost_per_stream, curator_deal_id, curators(name, contact)")
          .eq("package_id", packageId)
          .order("assigned_streams", { ascending: false }),
        fetchCuratorCandidates(),
      ]);
      const dealIds = ((its ?? []) as any[]).map((it) => it.curator_deal_id).filter(Boolean);
      const dealById = new Map<string, ItemRow["curator_deals"]>();
      if (dealIds.length > 0) {
        const { data: dealsData } = await supabase
          .from("curator_deals")
          .select("id, state, reconciled_total_plays, ends_at, closed_status")
          .in("id", dealIds);
        for (const d of (dealsData ?? []) as any[]) {
          dealById.set(d.id, d);
        }
      }
      setPkg(p as any);
      setItems(((its ?? []) as any[]).map((it) => ({
        ...it,
        curator_deals: it.curator_deal_id ? dealById.get(it.curator_deal_id) ?? null : null,
      })) as any);
      setCandidates(cand);

      // Entregas reais por curador na campanha — soma deltas da view de crescimento.
      // Fallback pra reconciled_total_plays quando o cron de deals ainda não rodou
      // ou quando a fonte de verdade vem de campaign_playlist_collections (Plug/Manolo).
      try {
        // Growth Engine: `attributed_to` é texto ('curator:<uuid>' | 'ecosystem' | 'organic').
        const { data: rows } = await (supabase as any)
          .from("vw_campaign_playlist_growth")
          .select("attributed_to, delta, baseline_plays")
          .eq("campaign_id", campaignId)
          .like("attributed_to", "curator:%");
        const map: Record<string, CuratorDelivery> = {};
        for (const r of (rows ?? []) as Array<{ attributed_to: string; delta: number | null; baseline_plays: number | null }>) {
          const curatorId = (r.attributed_to ?? "").startsWith("curator:")
            ? r.attributed_to.slice("curator:".length)
            : null;
          if (!curatorId) continue;
          const v = Math.max(0, Number(r.delta ?? 0));
          if (v === 0) continue;
          const cur = map[curatorId] ?? { total: 0, clean: 0, prior: 0 };
          cur.total += v;
          if (Number(r.baseline_plays ?? 0) > 0) cur.prior += v;
          else cur.clean += v;
          map[curatorId] = cur;
        }
        setDeliveryByCurator(map);
      } catch (e) {
        console.warn("[ExternalPackageEditor] growth view fetch failed", e);
      }

      onChanged?.();
    } catch (e: any) {
      toast({ title: "Erro ao carregar pacote", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [campaignId]);

  async function handleAdd(curator: CuratorCandidate) {
    if (!pkg) return;
    setAddOpen(false);
    try {
      // Pré-preenche com a próxima compra disponível (FIFO).
      // Se não houver compra registrada, entra zerado e o user ajusta manualmente.
      const next = curator.next_purchase;
      await addPackageItem({
        packageId: pkg.id,
        curatorId: curator.id,
        assignedStreams: next?.plays ?? 0,
        costPerStream: next?.cpp ?? curator.cost_per_stream,
        purchaseId: next?.id,
      });
      // Se o pacote já está travado (dispatched), materializa o deal do novo
      // curador sem mexer nos deals existentes — confirmExternalPackage é
      // idempotente: reaproveita itens já vinculados e cria só o que falta.
      if (pkg.status !== "draft") {
        await confirmExternalPackage({ packageId: pkg.id, campaignId, snapshot });
        toast({ title: "Curador adicionado", description: `${curator.name} entrou no pacote e o deal foi criado.` });
      }
      await load();
    } catch (e: any) {
      toast({ title: "Erro ao adicionar curador", description: e.message, variant: "destructive" });
    }
  }

  async function handleStreamsChange(item: ItemRow, value: number) {
    setItems(prev => prev.map(i => i.id === item.id
      ? { ...i, assigned_streams: value, assigned_cost: +(value * i.cost_per_stream).toFixed(2) }
      : i));
    try {
      await updatePackageItem(item.id, { assigned_streams: value, cost_per_stream: item.cost_per_stream });
      onChanged?.();
    } catch (e: any) {
      toast({ title: "Erro ao atualizar", description: e.message, variant: "destructive" });
    }
  }

  async function handleRemove(item: ItemRow) {
    setItems(prev => prev.filter(i => i.id !== item.id));
    try { await removePackageItem(item.id); onChanged?.(); }
    catch (e: any) { toast({ title: "Erro ao remover", description: e.message, variant: "destructive" }); load(); }
  }

  async function handleConfirm() {
    if (!pkg) return;
    setConfirming(true);
    try {
      const { dealsCreated } = await confirmExternalPackage({ packageId: pkg.id, campaignId, snapshot });
      toast({ title: "Pacote confirmado", description: `${dealsCreated} deals criados; itens existentes foram vinculados ao financeiro.` });
      load();
      onChanged?.();
    } catch (e: any) {
      toast({ title: "Erro ao confirmar", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setConfirming(false);
    }
  }
  async function handleReopen() {
    if (!pkg) return;
    setReopening(true);
    try {
      const { dealsRemoved } = await reopenExternalPackage(pkg.id);
      toast({ title: "Pacote reaberto", description: `${dealsRemoved} deals propostos removidos. Edite e confirme novamente.` });
      setReopenOpen(false);
      await load();
      onChanged?.();
    } catch (e: any) {
      toast({ title: "Erro ao reabrir", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setReopening(false);
    }
  }


  if (loading) {
    return <Skeleton className="h-64" />;
  }

  const totalStreams = items.reduce((s, i) => s + i.assigned_streams, 0);
  const totalCost = items.reduce((s, i) => s + i.assigned_cost, 0);
  const deltaStreams = totalStreams - snapshot.streamsExt;
  const deltaCost = totalCost - snapshot.custoExt;
  const coverage = snapshot.streamsExt > 0 ? (totalStreams / snapshot.streamsExt) * 100 : 0;
  const isDispatched = pkg?.status !== "draft";
  const noCapacity = items.length === 0;
  const underCovered = coverage < 95;
  // Janela REAL do plano (rampa + platô + saída) — fallback p/ snapshots antigos.
  const effDays = Math.max(1, snapshot.effectiveDays || snapshot.days || 1);
  const dealsCount = items.filter(i => !!i.curator_deal_id).length;

  const actionButtons = !isDispatched ? (
    <>
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1.5" /> Adicionar curador
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="end">
          <Command>
            <CommandInput placeholder="Buscar curador..." />
            <CommandList>
              <CommandEmpty>Nenhum curador disponível.</CommandEmpty>
              <CommandGroup>
                {candidates
                  .filter(c => !items.some(it => it.curator_id === c.id))
                  .map(c => {
                    const next = c.next_purchase;
                    return (
                      <CommandItem key={c.id} value={c.name} onSelect={() => handleAdd(c)}>
                        <div className="flex flex-col">
                          <span className="text-sm">{c.name}</span>
                          {next ? (
                            <span className="text-[10px] text-primary tabular-nums">
                              {formatInt(next.plays)} disponíveis · R$ {next.cpp.toFixed(3)}/stream{next.note ? ` · ${next.note}` : ""}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              sem compra registrada · R$ {c.cost_per_stream.toFixed(3)}/stream (taxa média)
                            </span>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Button size="sm" variant="solid" onClick={handleConfirm} disabled={confirming || items.length === 0}>
        {confirming ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
        Confirmar pacote
      </Button>
    </>
  ) : (
    <Button size="sm" variant="outline" onClick={() => setReopenOpen(true)}>
      <Pencil className="h-4 w-4 mr-1.5" /> Pacote
    </Button>
  );

  return (
    <>
    <section className="space-y-6">
      {isDispatched ? (
        <header className="bg-card border border-border rounded-2xl overflow-hidden">
          {/* Top: contexto + ações */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 border-b border-border">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-foreground text-xl font-semibold tracking-tight">Pacote confirmado</h2>
                <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider border border-primary/20">
                  Travado
                </span>
              </div>
              {pkg?.confirmed_at && (
                <p className="text-muted-foreground text-sm">
                  Em {new Date(pkg.confirmed_at).toLocaleDateString("pt-BR")}
                  <span className="mx-1.5 opacity-30">•</span>
                  {dealsCount} {dealsCount === 1 ? "deal criado" : "deals criados"}
                </p>
              )}
              {headerExtra && (
                <div className="pt-1 [&_button]:!h-7 [&_button]:!px-2 [&_button]:!text-[11px] [&_button]:!rounded-full opacity-90">
                  {headerExtra}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Popover open={addOpen} onOpenChange={setAddOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="h-10 px-4 gap-2">
                    <Plus className="h-4 w-4 text-muted-foreground" />
                    Adicionar curador
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <Command>
                    <CommandInput placeholder="Buscar curador..." />
                    <CommandList>
                      <CommandEmpty>Nenhum curador disponível.</CommandEmpty>
                      <CommandGroup>
                        {candidates
                          .filter(c => !items.some(it => it.curator_id === c.id))
                          .map(c => {
                            const next = c.next_purchase;
                            return (
                              <CommandItem key={c.id} value={c.name} onSelect={() => handleAdd(c)}>
                                <div className="flex flex-col">
                                  <span className="text-sm">{c.name}</span>
                                  {next ? (
                                    <span className="text-[10px] text-primary tabular-nums">
                                      {formatInt(next.plays)} disponíveis · R$ {next.cpp.toFixed(3)}/stream{next.note ? ` · ${next.note}` : ""}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground tabular-nums">
                                      sem compra registrada · R$ {c.cost_per_stream.toFixed(3)}/stream (taxa média)
                                    </span>
                                  )}
                                </div>
                              </CommandItem>
                            );
                          })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setReopenOpen(true)}
                className="h-10 px-4 gap-2"
              >
                <Pencil className="h-4 w-4 text-muted-foreground" />
                Pacote
              </Button>
              <Button asChild size="sm" variant="outline" className="h-10 px-4 gap-2">
                <Link to={`/deals?campaign=${campaignId}`}>
                  Ver deals
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </Link>
              </Button>
            </div>
          </div>

          {/* Bottom: baseline KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border bg-background/40">
            <div className="px-6 py-5 flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.05em]">Curadores</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground tabular-nums">{items.length}</span>
                <span className="text-[11px] text-muted-foreground font-medium">no pacote</span>
              </div>
            </div>
            <div className="px-6 py-5 flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.05em]">Total Streams</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground tabular-nums">{formatInt(totalStreams)}</span>
                <span className="text-[11px] text-muted-foreground font-medium">projetados</span>
              </div>
            </div>
            <div className="px-6 py-5 flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.05em]">Investimento</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground tabular-nums">{formatBRL(totalCost)}</span>
                <span className="text-[11px] text-muted-foreground font-medium">valor total</span>
              </div>
            </div>
          </div>
        </header>
      ) : (
        <section className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <KpiBig
            tier="hero"
            icon={BarChart3}
            label="Streams totais"
            value={formatInt(totalStreams)}
            hint={Math.abs(deltaStreams) > 1 ? `${deltaStreams > 0 ? "+" : ""}${formatInt(deltaStreams)} vs snapshot` : "alinhado ao snapshot"}
            domain="campaigns"
          />
          <KpiBig
            icon={CalendarClock}
            label="Diário necessário"
            value={formatInt(Math.round((snapshot.streamsExt || 0) / effDays))}
            hint={`pacote atual: ${formatInt(Math.round(totalStreams / effDays))}/dia em ${effDays}d`}
            domain="deals"
          />
          <KpiBig
            icon={DollarSign}
            label="Custo"
            value={formatBRL(totalCost)}
            hint={Math.abs(deltaCost) > 0.5 ? `${deltaCost > 0 ? "+" : ""}${formatBRL(deltaCost)} vs snapshot` : "alinhado ao snapshot"}
            domain="clients"
          />
          <KpiBig
            icon={Target}
            label="Cobertura"
            value={`${coverage.toFixed(0)}%`}
            hint="do alvo externo"
            domain="curators"
          />
          <KpiBig
            tier="quiet"
            icon={Users}
            label="Curadores"
            value={String(items.length)}
            hint="no pacote"
            domain="community"
          />
        </section>
      )}

      {renderTabsRow?.(isDispatched ? null : actionButtons, { isDispatched })}

      <div className="border-t border-border" />

      <div className="space-y-4">





        {noCapacity && !isDispatched && (
          <div className="flex items-start gap-2 rounded-md border border-dashed border-border p-4">
            <Users className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-xs">
              <div className="font-medium text-foreground">Nenhum curador adicionado ainda</div>
              <p className="text-muted-foreground mt-0.5">
                Clique em <strong>Adicionar curador</strong> acima pra escolher quem vai entregar os {formatInt(snapshot.streamsExt)} streams externos.
                Você pode colocar um único curador no volume total ou dividir entre vários.
              </p>
            </div>
          </div>
        )}

        {!noCapacity && underCovered && !isDispatched && (
          <div className="flex items-start gap-2 rounded-md bg-warning/10 border border-warning/30 p-3">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="text-xs">
              <div className="font-medium text-warning">Capacidade abaixo do alvo</div>
              <p className="text-muted-foreground mt-0.5">
                Os curadores adicionados cobrem {coverage.toFixed(0)}% dos {formatInt(snapshot.streamsExt)} streams previstos.
                Aumente o volume por curador ou adicione mais.
              </p>
            </div>
          </div>
        )}


        {items.length > 0 && (
          <>
            {!isDispatched && (
              <div className="flex items-center justify-between gap-3 flex-wrap text-[11px]">
                <div className="flex items-start gap-2 text-muted-foreground min-w-0">
                  <Users className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    Distribuição em <strong className="text-foreground">{effDays} dias</strong> ·
                    alvo <strong className="text-foreground tabular-nums">{formatInt(snapshot.streamsExt)}</strong> streams ·
                    <strong className="text-foreground"> {formatBRL(snapshot.custoExt)}</strong>
                  </span>
                </div>
              </div>
            )}

            {isDispatched ? (
              <>
                <DeliveryTransparencyBanner deliveryByCurator={deliveryByCurator} />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {items.map((it) => (
                    <CuratorCard
                      key={it.id}
                      item={it}
                      delivery={deliveryByCurator[it.curator_id]}
                      onEdit={() => {
                        setEditTarget(it);
                        setEditValue(String(it.assigned_streams ?? 0));
                      }}
                    />
                  ))}
                </div>
              </>
            ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs border-collapse">
                <thead className="text-muted-foreground bg-elevated/40">
                  <tr>
                    <th className="text-center font-medium py-2.5 px-3 border-b border-r border-border w-[24%]">Curador</th>
                    <th className="text-center font-medium py-2.5 px-3 border-b border-r border-border w-[18%]">Total streams</th>
                    <th className="text-center font-medium py-2.5 px-3 border-b border-r border-border w-[14%]">Por dia</th>
                    <th className="text-center font-medium py-2.5 px-3 border-b border-r border-border w-[12%]">R$/stream</th>
                    <th className="text-center font-medium py-2.5 px-3 border-b border-r border-border w-[16%]">Custo total</th>
                    <th className="text-center font-medium py-2.5 px-3 border-b border-border w-[14%]">Status</th>
                    {!isDispatched && <th className="w-10 border-b border-l border-border" />}
                  </tr>

                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const days = effDays;
                    const perDay = Math.round(it.assigned_streams / days);
                    const totalStr = totalDrafts[it.id] ?? (it.assigned_streams > 0 ? String(it.assigned_streams) : "");
                    const perDayStr = perDayDrafts[it.id] ?? (perDay > 0 ? String(perDay) : "");

                    return (
                      <tr key={it.id} className={cn("hover:bg-elevated/60 transition-colors", i % 2 === 1 && "bg-elevated/20")}>
                        <td className="py-2.5 px-3 text-center border-b border-r border-border/40">
                          <div className="font-medium">{it.curators?.name ?? "—"}</div>
                          {it.curators?.contact && <div className="text-[10px] text-muted-foreground">{it.curators.contact}</div>}
                        </td>
                        <td className="py-2.5 px-3 text-center border-b border-r border-border/40">
                          {isDispatched ? (
                            <span className="tabular-nums font-semibold">{formatInt(it.assigned_streams)}</span>
                          ) : (
                            <Input
                              type="number"
                              inputMode="numeric"
                              placeholder="0"
                              value={totalStr}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => {
                                const raw = e.target.value;
                                setTotalDrafts((p) => ({ ...p, [it.id]: raw }));
                                setPerDayDrafts((p) => { const n = { ...p }; delete n[it.id]; return n; });
                                const v = Math.max(0, parseInt(raw || "0", 10) || 0);
                                handleStreamsChange(it, v);
                              }}
                              onBlur={() => setTotalDrafts((p) => { const n = { ...p }; delete n[it.id]; return n; })}
                              className="h-7 text-center tabular-nums w-28 mx-auto"
                            />
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center border-b border-r border-border/40">
                          {isDispatched ? (
                            <>
                              <span className="font-medium tabular-nums">{formatInt(perDay)}</span>
                              <span className="text-[10px] text-muted-foreground ml-1">/dia</span>
                            </>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <Input
                                type="number"
                                inputMode="numeric"
                                placeholder="0"
                                value={perDayStr}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  setPerDayDrafts((p) => ({ ...p, [it.id]: raw }));
                                  setTotalDrafts((p) => { const n = { ...p }; delete n[it.id]; return n; });
                                  const pd = Math.max(0, parseInt(raw || "0", 10) || 0);
                                  handleStreamsChange(it, pd * days);
                                }}
                                onBlur={() => setPerDayDrafts((p) => { const n = { ...p }; delete n[it.id]; return n; })}
                                className="h-7 text-center tabular-nums w-20"
                              />
                              <span className="text-[10px] text-muted-foreground">/dia</span>
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center tabular-nums text-muted-foreground border-b border-r border-border/40">
                          {it.cost_per_stream.toFixed(3)}
                        </td>


                        <td className="py-2.5 px-3 text-center tabular-nums font-semibold border-b border-r border-border/40">
                          {formatBRL(it.assigned_cost)}
                        </td>
                        <td className="py-2.5 px-3 text-center border-b border-border/40">
                          {it.curator_deal_id ? (
                            <Link to={`/deals/${it.curator_deal_id}`} className="text-primary text-[10px] underline">
                              Deal aberto
                            </Link>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">Rascunho</span>
                          )}
                        </td>
                        {!isDispatched && (
                          <td className="py-2.5 px-2 text-center border-b border-l border-border/40">
                            <button onClick={() => setRemoveTarget(it)} className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="text-muted-foreground bg-elevated/30">
                  <tr>
                    <td className="py-2.5 px-3 text-center text-[10px] uppercase tracking-wider border-r border-border">Total externo</td>
                    <td className="py-2.5 px-3 text-center tabular-nums font-semibold text-foreground border-r border-border">{formatInt(totalStreams)}</td>
                    <td className="py-2.5 px-3 text-center tabular-nums font-semibold text-foreground border-r border-border">
                      {formatInt(Math.round(totalStreams / effDays))}
                      <span className="text-[10px] text-muted-foreground ml-1">/dia</span>
                    </td>
                    <td className="py-2.5 px-3 border-r border-border" />

                    <td className="py-2.5 px-3 border-r border-border" />
                    <td className="py-2.5 px-3 text-center tabular-nums font-semibold text-foreground border-r border-border">{formatBRL(totalCost)}</td>
                    <td className="py-2.5 px-3" />
                    {!isDispatched && <td className="border-l border-border" />}
                  </tr>
                </tfoot>
              </table>
            </div>
            )}
          </>
        )}
      </div>
    </section>
    <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover {removeTarget?.curators?.name ?? "curador"} do pacote?</AlertDialogTitle>
          <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (removeTarget) {
                const target = removeTarget;
                setRemoveTarget(null);
                handleRemove(target);
              }
            }}
          >
            Remover
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={!!editTarget} onOpenChange={(open) => !open && !savingEdit && setEditTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ajustar volume de {editTarget?.curators?.name ?? "curador"}</AlertDialogTitle>
          <AlertDialogDescription>
            Defina quantos streams esse curador vai realmente entregar nessa música.
            O custo total é recalculado automaticamente ({editTarget ? `R$ ${editTarget.cost_per_stream.toFixed(3)}/stream` : ""})
            e o deal vinculado é atualizado na mesma hora.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Streams planejados</label>
          <Input
            type="number"
            inputMode="numeric"
            value={editValue}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setEditValue(e.target.value)}
            className="h-10 text-base tabular-nums"
            disabled={savingEdit}
          />
          {editTarget && (
            <p className="text-[11px] text-muted-foreground tabular-nums">
              Novo custo total: <span className="text-foreground font-medium">
                {formatBRL(Math.max(0, parseInt(editValue || "0", 10) || 0) * editTarget.cost_per_stream)}
              </span>
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={savingEdit}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={savingEdit}
            onClick={async (e) => {
              e.preventDefault();
              if (!editTarget) return;
              const v = Math.max(0, parseInt(editValue || "0", 10) || 0);
              setSavingEdit(true);
              try {
                await updatePackageItem(editTarget.id, {
                  assigned_streams: v,
                  cost_per_stream: editTarget.cost_per_stream,
                });
                toast({ title: "Volume ajustado", description: `${editTarget.curators?.name ?? "Curador"}: ${formatInt(v)} streams.` });
                setEditTarget(null);
                await load();
              } catch (err: any) {
                toast({ title: "Erro ao ajustar", description: err.message ?? String(err), variant: "destructive" });
              } finally {
                setSavingEdit(false);
              }
            }}
          >
            {savingEdit ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            Salvar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={reopenOpen} onOpenChange={setReopenOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reabrir pacote para edição?</AlertDialogTitle>
          <AlertDialogDescription>
            Isso vai apagar os {dealsCount} {dealsCount === 1 ? "deal proposto" : "deals propostos"} gerados a partir deste pacote
            e devolver o pacote para rascunho. Você poderá editar curadores, volumes e custos e confirmar novamente.
            Deals que já foram aceitos pelo curador não serão removidos. Continuar?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={reopening}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleReopen} disabled={reopening}>
            {reopening ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            Reabrir pacote
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function CuratorCard({ item, delivery, onEdit }: { item: ItemRow; delivery?: CuratorDelivery; onEdit?: () => void }) {
  const name = item.curators?.name ?? "—";
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "—";

  const deal = item.curator_deals;
  const reconciled = Number(deal?.reconciled_total_plays ?? 0);
  // Prioriza a entrega vinda da view de crescimento da campanha (fonte de verdade
  // pós-backfill A+B). Cai pro reconciled_total_plays só quando a view está vazia.
  const delivered = (delivery && delivery.total > 0) ? delivery.total : reconciled;
  const cleanDelivered = delivery?.clean ?? 0;
  const priorDelivered = delivery?.prior ?? 0;
  const hasPrior = priorDelivered > 0;
  const planned = Math.max(0, Number(item.assigned_streams ?? 0));
  const pct = planned > 0 ? Math.min(100, Math.round((delivered / planned) * 100)) : 0;

  let statusLabel = "Travado";
  let statusClass = "border border-primary/60 text-primary";
  if (!item.curator_deal_id) {
    statusLabel = "Rascunho";
    statusClass = "border border-border text-muted-foreground";
  } else if (deal?.closed_status === "completed") {
    statusLabel = "Concluído";
    statusClass = "border border-primary/60 text-primary";
  } else if (deal?.closed_status === "paused" || deal?.state === "paused") {
    statusLabel = "Pausado";
    statusClass = "border border-border text-muted-foreground";
  } else if (deal?.state === "active" || deal?.state === "in_progress") {
    statusLabel = "Ativo";
    statusClass = "bg-primary text-primary-foreground";
  }

  let restanteLabel: string = "—";
  let restanteClass = "text-muted-foreground";
  if (deal?.ends_at) {
    const ms = new Date(deal.ends_at).getTime() - Date.now();
    const days = Math.ceil(ms / 86400000);
    if (days > 0) {
      restanteLabel = `${days} ${days === 1 ? "dia" : "dias"}`;
      restanteClass = "text-primary";
    } else if (days === 0) {
      restanteLabel = "hoje";
      restanteClass = "text-warning";
    } else {
      restanteLabel = "vencido";
      restanteClass = "text-destructive";
    }
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-5 hover:bg-elevated transition-colors flex flex-col">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-muted to-elevated flex items-center justify-center border border-border shrink-0">
          <span className="text-sm font-semibold text-muted-foreground tabular-nums">{initials}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground truncate text-[15px] leading-tight">{name}</h3>
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide mt-1.5", statusClass)}>
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-y-3 gap-x-3 mb-5">
        <div>
          <p className="text-[10px] uppercase text-muted-foreground tracking-wider mb-0.5">R$/Stream</p>
          <p className="text-[13px] font-semibold tabular-nums text-foreground">R$ {item.cost_per_stream.toFixed(3)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground tracking-wider mb-0.5">Custo total</p>
          <p className="text-[13px] font-semibold tabular-nums text-foreground">{formatBRL(item.assigned_cost)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground tracking-wider mb-0.5">Planejado</p>
          <p className="text-[13px] font-semibold tabular-nums text-foreground">{formatInt(planned)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground tracking-wider mb-0.5">Restante</p>
          <p className={cn("text-[13px] font-semibold tabular-nums", restanteClass)}>{restanteLabel}</p>
        </div>
      </div>

      <div className="space-y-1.5 mb-5">
        <div className="flex justify-between text-[11px] font-medium">
          <span className="text-muted-foreground">Entregues</span>
          <span className="text-foreground tabular-nums">{formatInt(delivered)} <span className="text-muted-foreground">({pct}%)</span></span>
        </div>
        <div className="w-full h-1.5 bg-elevated rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        {delivery && delivery.total > 0 && (
          <div className="flex items-center justify-between gap-2 text-[10px] pt-1">
            <span className="text-muted-foreground tabular-nums">
              <span className="text-foreground">{formatInt(cleanDelivered)}</span> limpos
              {hasPrior && <> · <span className="text-foreground">{formatInt(priorDelivered)}</span> hist.</>}
            </span>
            {hasPrior && <HistoricoPrevioBadge />}
          </div>
        )}
        {hasPrior && (
          <HistoricoPrevioRecommendation variant="long" className="pt-1" />
        )}
      </div>

      <div className="flex gap-2 mt-auto">
        {onEdit && (
          <Button variant="outline" size="sm" className="flex-1" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Ajustar volume
          </Button>
        )}
        {item.curator_deal_id ? (
          <Button asChild variant="outline" size="sm" className="flex-1">
            <Link to={`/deals/${item.curator_deal_id}`}>Ver deal</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="flex-1" disabled>
            Sem deal
          </Button>
        )}
      </div>
    </div>
  );
}


function DeliveryTransparencyBanner({ deliveryByCurator }: { deliveryByCurator: Record<string, CuratorDelivery> }) {
  const totals = Object.values(deliveryByCurator).reduce(
    (acc, d) => {
      acc.total += d.total;
      acc.clean += d.clean;
      acc.prior += d.prior;
      return acc;
    },
    { total: 0, clean: 0, prior: 0 },
  );

  if (totals.total === 0) return null;

  const pctClean = totals.total > 0 ? Math.round((totals.clean / totals.total) * 100) : 0;
  const pctPrior = 100 - pctClean;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Entrega total
            </h4>
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[300px] text-[11px] leading-relaxed">
                  Camada de transparência. Não altera KPI, faturamento, atribuição
                  ou o total entregue da campanha. Apenas separa visualmente playlists
                  que já possuíam atividade da música antes do início da campanha.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="text-2xl font-semibold tabular-nums text-foreground leading-tight mt-0.5">
            {formatInt(totals.total)}
          </p>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 justify-end">
              <CheckCircle2 className="h-3 w-3 text-primary" /> Limpa
            </p>
            <p className="text-base font-semibold tabular-nums text-foreground">{formatInt(totals.clean)}</p>
            <p className="text-[10px] text-muted-foreground tabular-nums">{pctClean}%</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 justify-end">
              <History className="h-3 w-3" /> Histórico prévio
            </p>
            <p className="text-base font-semibold tabular-nums text-foreground">{formatInt(totals.prior)}</p>
            <p className="text-[10px] text-muted-foreground tabular-nums">{pctPrior}%</p>
          </div>
        </div>
      </div>

      <div className="flex h-1.5 rounded-full overflow-hidden bg-elevated">
        <div className="h-full bg-primary transition-all" style={{ width: `${pctClean}%` }} />
        <div className="h-full bg-muted-foreground/40 transition-all" style={{ width: `${pctPrior}%` }} />
      </div>

      <p className="text-[10.5px] text-muted-foreground leading-relaxed">
        "Histórico prévio" identifica playlists com <span className="text-foreground">baseline_plays &gt; 0</span> — já possuíam
        atividade da música antes da campanha. O crescimento (delta) continua sendo contabilizado normalmente na entrega total.
      </p>
    </div>
  );
}

