import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Curator, NewCuratorInput } from "@/hooks/useCuratorDeals";

interface Props {
  curator: Curator | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (curatorId: string, input: Partial<NewCuratorInput>) => Promise<void>;
}

type DealType = "avulso" | "mensal";

export function CuratorEditDialog({ curator, open, onOpenChange, onSave }: Props) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [dealType, setDealType] = useState<DealType>("avulso");
  const [defaultAmount, setDefaultAmount] = useState<string>("");
  const [defaultPlays, setDefaultPlays] = useState<string>("");
  const [monthlyAmount, setMonthlyAmount] = useState<string>("");
  const [billingDay, setBillingDay] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (curator) {
      setName(curator.name ?? "");
      setContact(curator.contact ?? "");
      setNotes(curator.notes ?? "");
      setDealType((curator.deal_type as DealType) ?? "avulso");
      setDefaultAmount(curator.default_amount != null ? String(curator.default_amount) : "");
      setDefaultPlays(curator.default_plays != null ? String(curator.default_plays) : "");
      setMonthlyAmount(curator.monthly_amount != null ? String(curator.monthly_amount) : "");
      setBillingDay(curator.billing_day != null ? String(curator.billing_day) : "");
    }
  }, [curator]);

  // Aceita "R$ 11.700,50", "11.700,50", "11700.50", etc.
  const parseNum = (v: string): number | null => {
    const cleaned = v.replace(/[^\d,.-]/g, "").trim();
    if (!cleaned) return null;
    // Se tem vírgula, assume pt-BR: pontos = milhar, vírgula = decimal
    const normalized = cleaned.includes(",")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  };

  const formatBRL = (v: string): string => {
    const n = parseNum(v);
    if (n == null) return v;
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatInt = (v: string): string => {
    const n = parseNum(v);
    if (n == null) return v;
    return Math.round(n).toLocaleString("pt-BR");
  };

  const handleBRLChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    // Permite digitar livremente; só limita caracteres válidos
    setter(e.target.value.replace(/[^\d,.-]/g, ""));
  };
  const handleIntChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value.replace(/[^\d.]/g, ""));
  };

  const handleSave = async () => {
    if (!curator) return;
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    const day = parseNum(billingDay);
    if (dealType === "mensal" && day != null && (day < 1 || day > 31)) {
      toast.error("Dia da cobrança deve ser entre 1 e 31");
      return;
    }
    setSaving(true);
    try {
      await onSave(curator.id, {
        name: name.trim(),
        contact: contact.trim() || null,
        notes: notes.trim() || null,
        deal_type: dealType,
        default_amount: parseNum(defaultAmount),
        default_plays: parseNum(defaultPlays),
        monthly_amount: dealType === "mensal" ? parseNum(monthlyAmount) : null,
        billing_day: dealType === "mensal" ? day : null,
      });
      toast.success("Curador atualizado");
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error("Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar curador</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="cur-name">Nome</Label>
            <Input id="cur-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cur-contact">Contato</Label>
            <Input
              id="cur-contact"
              placeholder="WhatsApp, email…"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </div>

          <div className="pt-2 border-t border-border/60" />

          <div className="space-y-1.5">
            <Label>Tipo do acerto</Label>
            <Select value={dealType} onValueChange={(v) => setDealType(v as DealType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="avulso">Avulso (por pacote)</SelectItem>
                <SelectItem value="mensal">Mensal (recorrente)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cur-amount">Valor pago (R$)</Label>
              <Input
                id="cur-amount"
                inputMode="decimal"
                placeholder="0,00"
                value={defaultAmount}
                onChange={(e) => setDefaultAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cur-plays">Plays comprados</Label>
              <Input
                id="cur-plays"
                inputMode="numeric"
                placeholder="0"
                value={defaultPlays}
                onChange={(e) => setDefaultPlays(e.target.value)}
              />
            </div>
          </div>

          {dealType === "mensal" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cur-monthly">Valor mensal (R$)</Label>
                <Input
                  id="cur-monthly"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={monthlyAmount}
                  onChange={(e) => setMonthlyAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cur-day">Dia da cobrança</Label>
                <Input
                  id="cur-day"
                  inputMode="numeric"
                  placeholder="1–31"
                  value={billingDay}
                  onChange={(e) => setBillingDay(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5 pt-1">
            <Label htmlFor="cur-notes">Notas</Label>
            <Textarea
              id="cur-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
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
