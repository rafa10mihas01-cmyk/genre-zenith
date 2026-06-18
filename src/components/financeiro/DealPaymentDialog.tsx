// DealPaymentDialog — registra uma compra de curadoria vinculada ao deal.
// Insere em curator_purchases (fonte única de custo desde 2026-05).
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dealId: string;
  curatorId: string | null;
  dealLabel: string;
  remainingHint?: number | null;
  remainingPlaysHint?: number | null;
  onSubmit: (input: {
    deal_id: string;
    curator_id: string;
    amount: number;
    plays_purchased: number;
    payment_date?: string;
    method?: string;
    notes?: string;
  }) => Promise<void>;
}

const METHODS = ["PIX", "Transferência", "Boleto", "Dinheiro", "Outro"];

export function DealPaymentDialog({
  open,
  onOpenChange,
  dealId,
  curatorId,
  dealLabel,
  remainingHint,
  remainingPlaysHint,
  onSubmit,
}: Props) {
  const [amount, setAmount] = useState("");
  const [plays, setPlays] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("PIX");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!curatorId) {
      toast({ title: "Curador desconhecido", description: "Esse deal não tem curador vinculado.", variant: "destructive" });
      return;
    }
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      toast({ title: "Valor inválido", description: "Informe um valor maior que zero.", variant: "destructive" });
      return;
    }
    const playsNum = Number(plays.replace(/\D/g, ""));
    if (!Number.isFinite(playsNum) || playsNum < 0) {
      toast({ title: "Plays inválidos", description: "Informe a quantidade de plays comprados.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        deal_id: dealId,
        curator_id: curatorId,
        amount: value,
        plays_purchased: playsNum,
        payment_date: date,
        method,
        notes: notes.trim() || undefined,
      });
      toast({ title: "Compra registrada", description: `R$ ${value.toFixed(2)} — ${dealLabel}` });
      setAmount("");
      setPlays("");
      setNotes("");
      onOpenChange(false);
    } catch (e: unknown) {
      toast({ title: "Erro", description: getErrorMessage(e) , variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar compra de curadoria</DialogTitle>
          <p className="text-xs text-muted-foreground">{dealLabel}</p>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="amt">Valor (R$)</Label>
              <Input
                id="amt"
                inputMode="decimal"
                placeholder={remainingHint != null ? `Restante: ${remainingHint.toFixed(2)}` : "0,00"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plays">Plays comprados</Label>
              <Input
                id="plays"
                inputMode="numeric"
                placeholder={remainingPlaysHint != null ? `Restante: ${remainingPlaysHint.toLocaleString("pt-BR")}` : "0"}
                value={plays}
                onChange={(e) => setPlays(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="date">Data</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="method">Método</Label>
              <select
                id="method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Observação</Label>
            <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button variant="solid" onClick={handleSubmit} disabled={saving || !curatorId}>
            {saving ? "Salvando…" : "Confirmar compra"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
