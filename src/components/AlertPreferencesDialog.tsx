import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAlertPrefs, setAlertPrefs } from "@/lib/alertPrefs";
import type { NotificationDomain, NotificationType } from "@/hooks/useNotifications";
import { toast } from "sonner";

const DOMAINS: { id: NotificationDomain; label: string; hint: string }[] = [
  { id: "bot", label: "Robô", hint: "Heartbeat, sessões, falhas do worker" },
  { id: "ocr", label: "OCR", hint: "Leitura de prints e parsing de plays" },
  { id: "queue", label: "Fila", hint: "Backlog, deadletter, reprocessamentos" },
  { id: "curator", label: "Curadoria", hint: "Deals, entregas, pendências de curadores" },
  { id: "financeiro", label: "Financeiro", hint: "Pagamentos, repasses, recibos" },
  { id: "system", label: "Sistema", hint: "Saúde geral, jobs, integrações" },
  { id: "security", label: "Segurança", hint: "Autenticação, acesso, fraude" },
  { id: "ai", label: "IA", hint: "Cérebro, autopilot, replicação" },
  { id: "geral", label: "Geral", hint: "Notificações sem domínio específico" },
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function AlertPreferencesDialog({ open, onOpenChange }: Props) {
  const [muted, setMuted] = useState<NotificationDomain[]>([]);
  const [minSev, setMinSev] = useState<NotificationType>("warning");

  useEffect(() => {
    if (!open) return;
    const p = getAlertPrefs();
    setMuted(p.mutedDomains);
    setMinSev(p.minSeverity);
  }, [open]);

  const toggleDomain = (id: NotificationDomain, on: boolean) => {
    setMuted((prev) => (on ? prev.filter((d) => d !== id) : Array.from(new Set([...prev, id]))));
  };

  const save = () => {
    setAlertPrefs({ mutedDomains: muted, minSeverity: minSev });
    toast.success("Preferências de alerta salvas");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Alertas</DialogTitle>
          <DialogDescription>Toast e push. Críticos sempre passam.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Severidade mínima
            </label>
            <Select value={minSev} onValueChange={(v) => setMinSev(v as NotificationType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Tudo (info, alerta, crítico)</SelectItem>
                <SelectItem value="warning">Alertas e críticos</SelectItem>
                <SelectItem value="critical">Apenas críticos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Domínios ativos
            </label>
            <div className="rounded-xl border border-border divide-y divide-border">
              {DOMAINS.map((d) => {
                const on = !muted.includes(d.id);
                return (
                  <div key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{d.label}</div>
                      <div className="text-xs text-muted-foreground truncate">{d.hint}</div>
                    </div>
                    <Switch checked={on} onCheckedChange={(v) => toggleDomain(d.id, v)} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save}>Salvar preferências</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
