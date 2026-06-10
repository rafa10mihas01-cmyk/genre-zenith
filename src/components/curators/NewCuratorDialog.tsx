import { useState } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

type PixType = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria" | "";

export function NewCuratorDialog({ open, onOpenChange, onCreate }: Props) {
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
  // Primeira compra
  const [plays, setPlays] = useState("");
  const [amount, setAmount] = useState("");
  // Notas
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName(""); setFullName(""); setDocument("");
    setPhone(""); setEmail(""); setContact("");
    setPixType(""); setPixKey("");
    setPlays(""); setAmount("");
    setNotes("");
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Nome / apelido é obrigatório");
      return;
    }
    setSaving(true);
    try {
      await onCreate({
        name: name.trim(),
        full_name: fullName.trim() || null,
        document: document.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        contact: contact.trim() || null,
        pix_type: pixType || null,
        pix_key: pixKey.trim() || null,
        notes: notes.trim() || null,
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
    <FormModal
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Novo curador"
      description="Cadastro completo. Só o nome é obrigatório — o resto pode ser preenchido depois."
      icon={<UserPlus className="h-4 w-4" />}
      iconTone="curadores"
      size="md"
      preventClose={saving}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Criando…" : "Criar curador"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">

          {/* Identificação */}
          <section className="space-y-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
              Identificação
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-cur-name" className="text-foreground">Nome / apelido <span className="text-destructive">*</span></Label>
              <Input
                id="new-cur-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Manolo"
                className="bg-background border-border"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-cur-fullname" className="text-foreground">Nome completo</Label>
                <Input
                  id="new-cur-fullname"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nome do titular"
                  className="bg-background border-border"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-cur-doc" className="text-foreground">CPF / CNPJ</Label>
                <Input
                  id="new-cur-doc"
                  value={document}
                  onChange={(e) => setDocument(e.target.value)}
                  placeholder="000.000.000-00"
                  className="bg-background border-border font-mono"
                />
              </div>
            </div>
          </section>

          {/* Contato */}
          <section className="space-y-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
              Contato
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-cur-phone" className="text-foreground">Telefone / WhatsApp</Label>
                <Input
                  id="new-cur-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(11) 99999-9999"
                  className="bg-background border-border font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-cur-email" className="text-foreground">E-mail</Label>
                <Input
                  id="new-cur-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="curador@exemplo.com"
                  className="bg-background border-border"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-cur-contact" className="text-foreground">Outros canais</Label>
              <Input
                id="new-cur-contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Instagram, Telegram, etc."
                className="bg-background border-border"
              />
            </div>
          </section>

          {/* Pagamento */}
          <section className="space-y-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
              Pagamento (PIX)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3">
              <div className="space-y-1.5">
                <Label className="text-foreground">Tipo de chave</Label>
                <Select value={pixType} onValueChange={(v) => setPixType(v as PixType)}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
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
                <Label htmlFor="new-cur-pix" className="text-foreground">Chave PIX</Label>
                <Input
                  id="new-cur-pix"
                  value={pixKey}
                  onChange={(e) => setPixKey(e.target.value)}
                  placeholder="Cole a chave aqui"
                  className="bg-background border-border font-mono"
                />
              </div>
            </div>
          </section>

          {/* Primeira compra */}
          <section className="space-y-3">
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
          </section>

          {/* Notas */}
          <section className="space-y-1.5">
            <Label htmlFor="new-cur-notes" className="text-foreground">Notas internas</Label>
            <Textarea
              id="new-cur-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Histórico, observações, combinados…"
              className="bg-background border-border"
            />
          </section>
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
