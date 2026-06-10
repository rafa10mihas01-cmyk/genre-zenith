import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { FormModal } from "@/components/ui/form-modal";
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
type PixType = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria" | "";

export function CuratorEditDialog({ curator, open, onOpenChange, onSave, onAddPurchase }: Props) {
  // Identificação
  const [name, setName] = useState("");
  const [fullName, setFullName] = useState("");
  const [document, setDocument] = useState("");
  // Contato
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [contact, setContact] = useState("");
  // Pagamento
  const [pixType, setPixType] = useState<PixType>("");
  const [pixKey, setPixKey] = useState("");
  // Notas + acerto
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
      setFullName(curator.full_name ?? "");
      setDocument(curator.document ?? "");
      setPhone(curator.phone ?? "");
      setEmail(curator.email ?? "");
      setContact(curator.contact ?? "");
      setPixType((curator.pix_type as PixType) ?? "");
      setPixKey(curator.pix_key ?? "");
      setNotes(curator.notes ?? "");
      setDealType((curator.deal_type as DealType) ?? "avulso");
      setPurchaseAmount("");
      setPurchasePlays("");
      setPurchaseNote("");
      setMonthlyAmount(curator.monthly_amount != null ? String(curator.monthly_amount) : "");
      setBillingDay(curator.billing_day != null ? String(curator.billing_day) : "");
    }
  }, [curator]);

  const parseNum = (v: string): number | null => {
    const cleaned = v.replace(/[^\d,.-]/g, "").trim();
    if (!cleaned) return null;
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
        full_name: fullName.trim() || null,
        document: document.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        contact: contact.trim() || null,
        pix_type: pixType || null,
        pix_key: pixKey.trim() || null,
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

  const hasPendingPurchase = (parseNum(purchaseAmount) ?? 0) > 0 || (parseNum(purchasePlays) ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border border-border text-foreground max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">Editar curador</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 py-2">
          {/* Identificação */}
          <section className="space-y-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Identificação</div>
            <div className="space-y-1.5">
              <Label htmlFor="cur-name" className="text-foreground">Nome / apelido</Label>
              <Input id="cur-name" value={name} onChange={(e) => setName(e.target.value)} className="bg-background border-border" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cur-fullname" className="text-foreground">Nome completo</Label>
                <Input id="cur-fullname" value={fullName} onChange={(e) => setFullName(e.target.value)} className="bg-background border-border" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cur-doc" className="text-foreground">CPF / CNPJ</Label>
                <Input id="cur-doc" value={document} onChange={(e) => setDocument(e.target.value)} className="bg-background border-border font-mono" />
              </div>
            </div>
          </section>

          {/* Contato */}
          <section className="space-y-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Contato</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cur-phone" className="text-foreground">Telefone / WhatsApp</Label>
                <Input id="cur-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" className="bg-background border-border font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cur-email" className="text-foreground">E-mail</Label>
                <Input id="cur-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="bg-background border-border" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cur-contact" className="text-foreground">Outros canais</Label>
              <Input id="cur-contact" placeholder="Instagram, Telegram, etc." value={contact} onChange={(e) => setContact(e.target.value)} className="bg-background border-border" />
            </div>
          </section>

          {/* Pagamento */}
          <section className="space-y-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Pagamento (PIX)</div>
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3">
              <div className="space-y-1.5">
                <Label className="text-foreground">Tipo de chave</Label>
                <Select value={pixType} onValueChange={(v) => setPixType(v as PixType)}>
                  <SelectTrigger className="bg-background border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cpf">CPF</SelectItem>
                    <SelectItem value="cnpj">CNPJ</SelectItem>
                    <SelectItem value="email">E-mail</SelectItem>
                    <SelectItem value="telefone">Telefone</SelectItem>
                    <SelectItem value="aleatoria">Aleatória</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cur-pix" className="text-foreground">Chave PIX</Label>
                <Input id="cur-pix" value={pixKey} onChange={(e) => setPixKey(e.target.value)} className="bg-background border-border font-mono" />
              </div>
            </div>
          </section>

          {/* Acerto */}
          <section className="space-y-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Tipo de acerto</div>
            <Select value={dealType} onValueChange={(v) => setDealType(v as DealType)}>
              <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="avulso">Avulso (por pacote)</SelectItem>
                <SelectItem value="mensal">Mensal (recorrente)</SelectItem>
              </SelectContent>
            </Select>
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
          </section>

          {/* Registrar compra */}
          <section className="space-y-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Registrar compra (opcional)</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cur-amount" className="text-foreground">Valor (R$)</Label>
                <Input
                  id="cur-amount"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={purchaseAmount}
                  onChange={handleBRLChange(setPurchaseAmount)}
                  onBlur={() => setPurchaseAmount(formatBRL(purchaseAmount))}
                  className="bg-background border-border font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cur-plays" className="text-foreground">Plays</Label>
                <Input
                  id="cur-plays"
                  inputMode="numeric"
                  placeholder="0"
                  value={purchasePlays}
                  onChange={handleIntChange(setPurchasePlays)}
                  onBlur={() => setPurchasePlays(formatInt(purchasePlays))}
                  className="bg-background border-border font-mono"
                />
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
          </section>

          {/* Notas */}
          <section className="space-y-1.5">
            <Label htmlFor="cur-notes" className="text-foreground">Notas internas</Label>
            <Textarea id="cur-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-background border-border" />
          </section>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando…" : hasPendingPurchase ? "Salvar e registrar" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
