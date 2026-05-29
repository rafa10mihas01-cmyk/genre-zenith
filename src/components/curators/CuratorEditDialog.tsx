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
  onAddPurchase?: (curatorId: string, input: { plays_purchased: number; amount: number; note?: string | null }) => Promise<void>;
}

type DealType = "avulso" | "mensal";

export function CuratorEditDialog({ curator, open, onOpenChange, onSave, onAddPurchase }: Props) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [dealType, setDealType] = useState<DealType>("avulso");
  const [purchaseAmount, setPurchaseAmount] = useState<string>("");
  const [purchasePlays, setPurchasePlays] = useState<string>("");
  const [purchaseNote, setPurchaseNote] = useState<string>("");
  const [monthlyAmount, setMonthlyAmount] = useState<string>("");
  const [billingDay, setBillingDay] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (curator) {
      setName(curator.name ?? "");
      setContact(curator.contact ?? "");
      setNotes(curator.notes ?? "");
      setDealType((curator.deal_type as DealType) ?? "avulso");
      setPurchaseAmount("");
      setPurchasePlays("");
      setPurchaseNote("");
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
      : cleaned.replace(/\.(?=\d{3}(\D|$))/g, "");
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
    const purchaseAmountNumber = parseNum(purchaseAmount) ?? 0;
    const purchasePlaysNumber = Math.round(parseNum(purchasePlays) ?? 0);
    const hasPurchase = purchaseAmountNumber > 0 || purchasePlaysNumber > 0;
    if (dealType === "mensal" && day != null && (day < 1 || day > 31)) {
      toast.error("Dia da cobrança deve ser entre 1 e 31");
      return;
    }
    if (hasPurchase && !onAddPurchase) {
      toast.error("Registro de compra indisponível nesta tela");
      return;
    }
    setSaving(true);
    try {
      await onSave(curator.id, {
        name: name.trim(),
        contact: contact.trim() || null,
        notes: notes.trim() || null,
        deal_type: dealType,
        monthly_amount: dealType === "mensal" ? parseNum(monthlyAmount) : null,
        billing_day: dealType === "mensal" ? day : null,
      });
      if (hasPurchase && onAddPurchase) {
        await onAddPurchase(curator.id, {
          plays_purchased: purchasePlaysNumber,
          amount: purchaseAmountNumber,
          note: purchaseNote.trim() || null,
        });
      }
      toast.success(hasPurchase ? "Cadastro salvo e compra registrada" : "Curador atualizado");
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
      <DialogContent className="max-w-md bg-card border border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="text-foreground">Editar curador</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="cur-name" className="text-foreground">Nome</Label>
            <Input id="cur-name" value={name} onChange={(e) => setName(e.target.value)} className="bg-background border-border" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cur-contact" className="text-foreground">Contato</Label>
            <Input
              id="cur-contact"
              placeholder="WhatsApp, email…"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              className="bg-background border-border"
            />
          </div>

          <div className="pt-2 border-t border-border" />

          <div className="space-y-1.5">
            <Label className="text-foreground">Tipo do acerto</Label>
            <Select value={dealType} onValueChange={(v) => setDealType(v as DealType)}>
              <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="avulso">Avulso (por pacote)</SelectItem>
                <SelectItem value="mensal">Mensal (recorrente)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cur-amount" className="text-foreground">Valor desta compra (R$)</Label>
              <Input
                id="cur-amount"
                inputMode="decimal"
                placeholder="0,00"
                value={purchaseAmount}
                onChange={handleBRLChange(setPurchaseAmount)}
                onBlur={() => setPurchaseAmount(formatBRL(purchaseAmount))}
                className="bg-background border-border font-mono"
              />
              {parseNum(purchaseAmount) != null && (
                <p className="text-xs text-muted-foreground">
                  R$ {parseNum(purchaseAmount)!.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cur-plays" className="text-foreground">Plays desta compra</Label>
              <Input
                id="cur-plays"
                inputMode="numeric"
                placeholder="0"
                value={purchasePlays}
                onChange={handleIntChange(setPurchasePlays)}
                onBlur={() => setPurchasePlays(formatInt(purchasePlays))}
                className="bg-background border-border font-mono"
              />
              {parseNum(purchasePlays) != null && (
                <p className="text-xs text-muted-foreground">
                  {Math.round(parseNum(purchasePlays)!).toLocaleString("pt-BR")} plays
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cur-purchase-note" className="text-foreground">Nota da compra</Label>
            <Input
              id="cur-purchase-note"
              value={purchaseNote}
              onChange={(e) => setPurchaseNote(e.target.value)}
              placeholder="Ex.: Carnívora Mc Jacaré"
              className="bg-background border-border"
            />
          </div>

          {dealType === "mensal" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cur-monthly" className="text-foreground">Valor mensal (R$)</Label>
                <Input
                  id="cur-monthly"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={monthlyAmount}
                  onChange={handleBRLChange(setMonthlyAmount)}
                  onBlur={() => setMonthlyAmount(formatBRL(monthlyAmount))}
                  className="bg-background border-border font-mono"
                />
                {parseNum(monthlyAmount) != null && (
                  <p className="text-xs text-muted-foreground">
                    R$ {parseNum(monthlyAmount)!.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mês
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cur-day" className="text-foreground">Dia da cobrança</Label>
                <Input
                  id="cur-day"
                  inputMode="numeric"
                  placeholder="1–31"
                  value={billingDay}
                  onChange={(e) => setBillingDay(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  className="bg-background border-border font-mono"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5 pt-1">
            <Label htmlFor="cur-notes" className="text-foreground">Notas do cadastro</Label>
            <Textarea
              id="cur-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-background border-border"
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
