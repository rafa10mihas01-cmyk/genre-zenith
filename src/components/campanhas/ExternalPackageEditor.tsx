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
  updatePackageItem,
  removePackageItem,
  addPackageItem,
  fetchCuratorCandidates,
  type CuratorCandidate,
} from "@/lib/externalPackage";
import { Link } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { Loader2, Trash2, Users, AlertTriangle, CheckCircle2, Plus, Search, BarChart3, CalendarClock, DollarSign, Target } from "lucide-react";
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
import { cn } from "@/lib/utils";

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
};

export function ExternalPackageEditor({
  campaignId,
  snapshot,
  onChanged,
  renderTabsRow,
}: {
  campaignId: string;
  snapshot: CampaignSnapshot;
  onChanged?: () => void;
  renderTabsRow?: (extra?: React.ReactNode) => React.ReactNode;
}) {
  const [pkg, setPkg] = useState<PackageRow | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  const [candidates, setCandidates] = useState<CuratorCandidate[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ItemRow | null>(null);
  const [totalDrafts, setTotalDrafts] = useState<Record<string, string>>({});
  const [perDayDrafts, setPerDayDrafts] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try {
      const { packageId } = await ensureExternalPackageDraft(campaignId, snapshot);
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
      setPkg(p as any);
      setItems((its ?? []) as any);
      setCandidates(cand);
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
      await addPackageItem({
        packageId: pkg.id,
        curatorId: curator.id,
        assignedStreams: 0,
        costPerStream: curator.cost_per_stream,
      });
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
      toast({ title: "Pacote confirmado", description: `${dealsCreated} deals criados em status proposto.` });
      load();
      onChanged?.();
    } catch (e: any) {
      toast({ title: "Erro ao confirmar", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setConfirming(false);
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
                  .map(c => (
                    <CommandItem key={c.id} value={c.name} onSelect={() => handleAdd(c)}>
                      <div className="flex flex-col">
                        <span className="text-sm">{c.name}</span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          cap. {formatInt(c.purchased_plays)} · R$ {c.cost_per_stream.toFixed(3)}/stream
                        </span>
                      </div>
                    </CommandItem>
                  ))}
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
  ) : null;

  return (
    <>
    <section className="space-y-6">
      {/* KPIs — padrão Curadores (KpiBig) */}
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
          value={formatInt(Math.round((snapshot.streamsExt || 0) / Math.max(1, snapshot.days || 1)))}
          hint={`pacote atual: ${formatInt(Math.round(totalStreams / Math.max(1, snapshot.days || 1)))}/dia em ${snapshot.days || 1}d`}
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

      {renderTabsRow?.(actionButtons)}

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
            <div className="flex items-center justify-between gap-3 flex-wrap text-[11px]">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-3.5 w-3.5 text-primary" />
                <span>
                  Distribuição sobre <strong className="text-foreground">{snapshot.days} dias</strong> ·
                  Alvo <strong className="text-foreground tabular-nums">{formatInt(snapshot.streamsExt)}</strong> streams ·
                  <strong className="text-foreground"> {formatBRL(snapshot.custoExt)}</strong>
                  {isDispatched && pkg?.confirmed_at && (
                    <> · Confirmado em {new Date(pkg.confirmed_at).toLocaleString("pt-BR")}</>
                  )}
                </span>
              </div>
            </div>
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
                    const days = Math.max(1, snapshot.days || 1);
                    const perDay = Math.round(it.assigned_streams / days);
                    const perMonth = Math.round(perDay * 30);
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
                        <td className="py-2.5 px-3 text-center tabular-nums border-b border-r border-border/40">
                          <span className="font-medium">{formatInt(perMonth)}</span>
                          <span className="text-[10px] text-muted-foreground ml-1">/mês</span>
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
                      {formatInt(Math.round(totalStreams / Math.max(1, snapshot.days || 1)))}
                      <span className="text-[10px] text-muted-foreground ml-1">/dia</span>
                    </td>
                    <td className="py-2.5 px-3 text-center tabular-nums font-semibold text-foreground border-r border-border">
                      {formatInt(Math.round((totalStreams / Math.max(1, snapshot.days || 1)) * 30))}
                      <span className="text-[10px] text-muted-foreground ml-1">/mês</span>
                    </td>
                    <td className="py-2.5 px-3 border-r border-border" />
                    <td className="py-2.5 px-3 text-center tabular-nums font-semibold text-foreground border-r border-border">{formatBRL(totalCost)}</td>
                    <td className="py-2.5 px-3" />
                    {!isDispatched && <td className="border-l border-border" />}
                  </tr>
                </tfoot>
              </table>
            </div>
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
    </>
  );
}


