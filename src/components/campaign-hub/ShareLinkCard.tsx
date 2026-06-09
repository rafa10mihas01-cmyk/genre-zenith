import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, ExternalLink, Check, MessageCircle, Share2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { PUBLIC_DOMAIN } from "@/lib/curatorPublicUrl";
import { openAdminPortal } from "@/lib/openAdminPortal";

type Props = {
  token: string;
  trackName: string;
  artist: string | null;
  approved: boolean;
};

export function ShareLinkCard({ token, trackName, artist, approved }: Props) {
  const [copied, setCopied] = useState(false);
  const url = `${PUBLIC_DOMAIN}/p/plano/${token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ title: "Link copiado", description: "Cole no WhatsApp ou e-mail pro cliente." });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: "Não consegui copiar", description: url, variant: "destructive" });
    }
  }

  const whatsappMsg = approved
    ? `Acompanhe a campanha de *${trackName}*${artist ? ` (${artist})` : ""} ao vivo:\n${url}`
    : `Segue o orçamento da campanha de *${trackName}*${artist ? ` (${artist})` : ""}. Quando aprovar, esta mesma página vira o acompanhamento ao vivo:\n${url}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(whatsappMsg)}`;

  return (
    <Card className="border-primary/20 bg-primary/[0.03]">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-primary/15 grid place-items-center shrink-0">
            <Share2 className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold leading-tight">Link do cliente</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {approved
                ? "Mesmo link de antes — agora mostra a campanha ao vivo."
                : "Mande pro cliente. Ele aprova o orçamento e a mesma página vira o acompanhamento."}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Input value={url} readOnly className="text-xs font-mono h-9" onFocus={(e) => e.currentTarget.select()} />
          <Button size="sm" variant="outline" onClick={copy} className="shrink-0 h-9 px-3">
            {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>

        <div className="flex gap-2">
          <a href={whatsappUrl} target="_blank" rel="noreferrer" className="flex-1">
            <Button size="sm" variant="default" className="w-full h-8 text-xs">
              <MessageCircle className="h-3.5 w-3.5 mr-1.5" /> Enviar por WhatsApp
            </Button>
          </a>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => openAdminPortal(token)}>
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Abrir portal
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
