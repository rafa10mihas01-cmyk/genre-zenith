import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { NewCuratorInput } from "@/hooks/useCuratorDeals";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: NewCuratorInput) => Promise<unknown>;
}

const parseNum = (v: string): number | null => {
  const cleaned = v.replace(/[^\d,.-]/g, "").trim();
  if (!cleaned) return null;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned.replace(/\.(?=\d{3}(\D|$))/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

export function NewCuratorDialog({ open, onOpenChange, onCreate }: Props) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [plays, setPlays] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName(""); setContact(""); setPlays(""); setAmount("");
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    setSaving(true);
    try {
      await onCreate({
        name: name.trim(),
        contact: contact.trim() || null,
        purchased_plays: Math.round(parseNum(plays) ?? 0),
        total_cost: parseNum(amount) ?? null,
      });
      toast.success("Curador criado");
      reset();
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error("Erro ao criar curador");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md bg-card border border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="text-foreground">Novo curador</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Cadastre o curador agora. Compras e deals podem ser registrados depois.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-cur-name" className="text-foreground">Nome</Label>
            <Input
              id="new-cur-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Manolo"
              className="bg-background border-border"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-cur-contact" className="text-foreground">Contato</Label>
            <Input
              id="new-cur-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="WhatsApp, email…"
              className="bg-background border-border"
            />
          </div>

          <div className="pt-2 border-t border-border" />
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
            Primeira compra (opcional)
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-cur-plays" className="text-foreground">Plays comprados</Label>
              <Input
                id="new-cur-plays"
                inputMode="numeric"
                placeholder="0"
                value={plays}
                onChange={(e) => setPlays(e.target.value.replace(/[^\d.,]/g, ""))}
                className="bg-background border-border font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-cur-amount" className="text-foreground">Valor pago (R$)</Label>
              <Input
                id="new-cur-amount"
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.,-]/g, ""))}
                className="bg-background border-border font-mono"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Criando…" : "Criar curador"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
