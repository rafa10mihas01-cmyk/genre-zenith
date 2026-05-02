import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CuratorDeal } from "@/lib/curatorDealsUtils";

type Props = {
  deal: CuratorDeal | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
};

const toDateInput = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "yyyy-MM-dd") : "";

const formatBRLInput = (raw: string) => {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const n = Number(digits) / 100;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(n);
};
const parseBRL = (s: string): number => {
  const digits = s.replace(/\D/g, "");
  if (!digits) return 0;
  return Number(digits) / 100;
};

export function EditDealDialog({ deal, open, onOpenChange, onSaved }: Props) {
  const [curatorName, setCuratorName] = useState("");
  const [costStr, setCostStr] = useState("");
  const [target, setTarget] = useState("");
  const [dailyGoal, setDailyGoal] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [rampUp, setRampUp] = useState("5");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!deal) return;
    setCuratorName(deal.curator_name ?? "");
    const c = Number(deal.cost ?? 0);
    setCostStr(
      c > 0
        ? new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL",
            minimumFractionDigits: 2,
          }).format(c)
        : "",
    );
    setTarget(String(Number(deal.target_plays ?? 0) || ""));
    setDailyGoal(String(Number(deal.daily_goal ?? 0) || ""));
    setStartedAt(toDateInput(deal.started_at));
    setEndsAt(toDateInput(deal.ends_at));
    const r = (deal as unknown as { ramp_up_days?: number }).ramp_up_days;
    setRampUp(String(r ?? 5));
  }, [deal]);

  const handleSave = async () => {
    if (!deal) return;
    if (!curatorName.trim()) {
      toast.error("Nome do curador é obrigatório");
      return;
    }
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        curator_name: curatorName.trim(),
        cost: parseBRL(costStr) || null,
        target_plays: Number(target) || 0,
        daily_goal: Number(dailyGoal) || 0,
        started_at: startedAt
          ? new Date(startedAt).toISOString()
          : deal.started_at,
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        ramp_up_days: Number(rampUp) || 0,
      };
      const { error } = await supabase
        .from("curator_deals")
        .update(updates)
        .eq("id", deal.id);
      if (error) throw error;
      toast.success("Deal atualizado");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      console.error("[EditDealDialog]", e);
      toast.error("Não foi possível salvar", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar deal</DialogTitle>
          <DialogDescription>
            Atualize informações do curador, custo, meta e datas.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ed-curator">Curador</Label>
            <Input
              id="ed-curator"
              value={curatorName}
              onChange={(e) => setCuratorName(e.target.value)}
              placeholder="Nome do curador"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ed-cost">Valor de compra</Label>
            <Input
              id="ed-cost"
              inputMode="numeric"
              value={costStr}
              onChange={(e) => setCostStr(formatBRLInput(e.target.value))}
              placeholder="R$ 0,00"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ed-target">Meta total (plays)</Label>
              <Input
                id="ed-target"
                inputMode="numeric"
                value={target}
                onChange={(e) =>
                  setTarget(e.target.value.replace(/\D/g, ""))
                }
                placeholder="0"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ed-daily">Meta diária</Label>
              <Input
                id="ed-daily"
                inputMode="numeric"
                value={dailyGoal}
                onChange={(e) =>
                  setDailyGoal(e.target.value.replace(/\D/g, ""))
                }
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ed-start">Início</Label>
              <Input
                id="ed-start"
                type="date"
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ed-end">Fim</Label>
              <Input
                id="ed-end"
                type="date"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ed-ramp">Aquecimento (dias)</Label>
            <Input
              id="ed-ramp"
              inputMode="numeric"
              value={rampUp}
              onChange={(e) => setRampUp(e.target.value.replace(/\D/g, ""))}
              placeholder="5"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
