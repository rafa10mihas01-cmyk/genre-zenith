// Wave 3 — Dialog de "Pedir remoção ao curador"
// Gera mensagem template com botão copiar. Sem execução.
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Copy, Check } from "lucide-react";

export interface PedirRemocaoDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  curatorName?: string | null;
  trackName?: string | null;
  trackArtist?: string | null;
  playlistName?: string | null;
  reason?: string;
  onConfirm: () => void | Promise<void>;
}

export function PedirRemocaoDialog(props: PedirRemocaoDialogProps) {
  const { open, onOpenChange, curatorName, trackName, trackArtist, playlistName, reason, onConfirm } = props;
  const [copied, setCopied] = useState(false);

  const greeting = curatorName ? `Olá, ${curatorName}!` : "Olá!";
  const trackLine = trackName
    ? `"${trackName}"${trackArtist ? ` — ${trackArtist}` : ""}`
    : "a faixa";
  const playlistLine = playlistName ? ` da playlist "${playlistName}"` : "";
  const reasonLine = reason ? `\n\nMotivo: ${reason}` : "";
  const message = `${greeting}\n\nPodemos remover ${trackLine}${playlistLine}? A faixa não está mais performando bem nesse contexto e abrir esse slot ajuda a manter a saúde da playlist.${reasonLine}\n\nObrigado!`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pedir remoção</DialogTitle>
          <DialogDescription>Copie e envie no canal habitual.</DialogDescription>
        </DialogHeader>
        <Textarea
          value={message}
          readOnly
          className="min-h-[180px] font-mono text-xs"
        />
        <DialogFooter className="flex sm:justify-between gap-2">
          <Button variant="outline" onClick={handleCopy}>
            {copied ? <Check className="h-3.5 w-3.5 mr-2" /> : <Copy className="h-3.5 w-3.5 mr-2" />}
            {copied ? "Copiado" : "Copiar mensagem"}
          </Button>
          <Button onClick={async () => { await onConfirm(); onOpenChange(false); }}>
            Marcar como pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
