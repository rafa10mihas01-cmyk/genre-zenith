/* eslint-disable react-refresh/only-export-components -- co-located helpers/variants/hooks; split would force a large refactor with no runtime benefit (HMR only) */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Mail, Send, Eye, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import nexengineLogo from "@/assets/nexengine-logo-email.png";

type Target = {
  externalCuratorId: string;
  recipientEmail: string;
  curatorName: string;
  playlistName?: string | null;
  /** Quando definido, envia como follow-up (#1 ou #2) e atualiza followup_count. */
  followupNumber?: 1 | 2;
};

const DEFAULT_SIGNATURE_NAME = "Equipe NexEngine";
const DEFAULT_SIGNATURE_ROLE = "Parcerias & Curadoria";

function buildDefaultMessage(curatorName: string, playlistName?: string | null) {
  const ref = playlistName ? ` com a playlist "${playlistName}"` : "";
  return `Sou da NexEngine, plataforma que conecta artistas, gravadoras e curadores em campanhas de distribuição estratégica de catálogo.

Conhecemos seu trabalho${ref} e gostaríamos de entender como você opera curadoria: como recebe novas faixas, critérios de seleção, e se trabalha com parcerias estruturadas para inclusão de catálogo.

Trabalhamos com lançamentos contínuos em diversos gêneros e selecionamos curadores com perfil editorial sólido para colaborações de médio e longo prazo.

Caso faça sentido, podemos agendar uma conversa de 15 minutos.`;
}

function buildFollowupMessage(curatorName: string, playlistName?: string | null, n: 1 | 2 = 1) {
  const ref = playlistName ? ` sobre uma possível parceria envolvendo "${playlistName}"` : "";
  if (n === 1) {
    return `Te escrevi há alguns dias${ref} e queria garantir que a mensagem chegou.

Sem pressa — só quero entender se faz sentido conversar sobre curadoria e parcerias estruturadas com a NexEngine.

Se preferir outro canal (Instagram, WhatsApp), me avisa que reorganizo.`;
  }
  return `Último toque por aqui${ref}.

Se fizer sentido, sigo à disposição. Caso prefira não receber novas mensagens, é só responder e tiro do nosso fluxo.

Obrigado pelo tempo.`;
}

export function EmailPreviewDialog({
  open, onOpenChange, target, onSent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: Target | null;
  onSent?: () => void;
}) {
  const [mode, setMode] = useState<"preview" | "editar">("preview");
  const [sending, setSending] = useState(false);

  const isFollowup = !!target?.followupNumber;
  const followupN = (target?.followupNumber ?? 1) as 1 | 2;

  const defaultMsg = useMemo(
    () => {
      if (!target) return "";
      return isFollowup
        ? buildFollowupMessage(target.curatorName, target.playlistName, followupN)
        : buildDefaultMessage(target.curatorName, target.playlistName);
    },
    [target, isFollowup, followupN],
  );
  const defaultSubject = useMemo(
    () => {
      if (!target) return "";
      if (isFollowup) {
        return target.playlistName
          ? `Re: parceria NexEngine — ${target.playlistName}`
          : `Re: parceria NexEngine — follow-up`;
      }
      return target.playlistName
        ? `Parceria de curadoria — ${target.playlistName}`
        : "Parceria de curadoria — NexEngine";
    },
    [target, isFollowup],
  );

  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMsg);
  const [signatureName, setSignatureName] = useState(DEFAULT_SIGNATURE_NAME);

  useEffect(() => {
    if (open) {
      setSubject(defaultSubject);
      setMessage(defaultMsg);
      setMode("preview");
    }
  }, [open, defaultSubject, defaultMsg]);

  if (!target) return null;

  const handleSend = async () => {
    setSending(true);
    try {
      const tag = isFollowup ? `followup-${followupN}` : "outreach";
      const idempotencyKey = `curator-${tag}-${target.externalCuratorId}-${Date.now()}`;
      const { data, error } = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "curator-outreach",
          recipientEmail: target.recipientEmail,
          idempotencyKey,
          templateData: {
            curator_name: target.curatorName,
            playlist_name: target.playlistName ?? undefined,
            message,
            signature_name: signatureName,
            signature_role: DEFAULT_SIGNATURE_ROLE,
          },
        },
      });
      if (error) throw error;
      const payload = data as { success?: boolean; reason?: string } | null;
      if (payload?.success === false) {
        toast.warning(`Não enviado: ${payload?.reason ?? "bloqueado"}`);
      } else {
        toast.success(
          isFollowup
            ? `Follow-up #${followupN} enviado para ${target.recipientEmail}`
            : `Apresentação enviada para ${target.recipientEmail}`,
        );
      }

      // Log local
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const eventType = isFollowup ? (followupN === 1 ? "followup_1" : "followup_2") : "sent";
        await supabase.from("curator_outreach_log").insert({
          user_id: user.id,
          external_curator_id: target.externalCuratorId,
          channel: "email",
          event_type: eventType,
          template_name: "curator-outreach",
          recipient_email: target.recipientEmail,
          subject,
          body_snippet: message.slice(0, 280),
          status: payload?.success === false ? "blocked" : "sent",
        });
        const update: Record<string, unknown> = {
          last_outreach_at: new Date().toISOString(),
          last_outreach_channel: "email",
        };
        if (isFollowup) {
          update.followup_count = followupN;
        }
        // pipeline_status -> contatado se ainda for "novo"
        if (!isFollowup) {
          const { data: cur } = await supabase
            .from("external_curators")
            .select("pipeline_status")
            .eq("id", target.externalCuratorId)
            .maybeSingle();
          if (cur?.pipeline_status === "novo") {
            update.pipeline_status = "contatado";
          }
        }
        await supabase
          .from("external_curators")
          .update(update as never)
          .eq("id", target.externalCuratorId);
      }
      onSent?.();
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Falha ao enviar");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-primary" />
            {isFollowup ? `Follow-up #${followupN}` : "Apresentação para curador"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Enviado por <span className="text-foreground font-medium">parcerias@notify.engine.nexcreatorx.com</span> em nome da NexEngine
          </DialogDescription>
        </DialogHeader>

        {/* Metadata */}
        <div className="px-6 py-4 space-y-3 border-b border-border bg-elevated/30">
          <div className="grid grid-cols-[80px_1fr] items-center gap-3 text-xs">
            <span className="text-muted-foreground uppercase tracking-wide font-medium">Para</span>
            <span className="text-foreground tabular-nums">{target.recipientEmail}</span>
          </div>
          <div className="grid grid-cols-[80px_1fr] items-center gap-3 text-xs">
            <span className="text-muted-foreground uppercase tracking-wide font-medium">Assunto</span>
            {mode === "editar" ? (
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="h-8 text-xs"
              />
            ) : (
              <span className="text-foreground font-medium">{subject}</span>
            )}
          </div>
        </div>

        {/* Tabs preview/editar */}
        <div className="px-6 pt-3 flex items-center gap-1">
          <button
            onClick={() => setMode("preview")}
            className={cn(
              "h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors",
              mode === "preview" ? "bg-elevated text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Eye className="h-3.5 w-3.5" /> Preview
          </button>
          <button
            onClick={() => setMode("editar")}
            className={cn(
              "h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors",
              mode === "editar" ? "bg-elevated text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Pencil className="h-3.5 w-3.5" /> Editar
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 max-h-[420px] overflow-y-auto">
          {mode === "preview" ? (
            <EmailPreviewRender
              curatorName={target.curatorName}
              message={message}
              signatureName={signatureName}
            />
          ) : (
            <div className="space-y-3">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={14}
                className="text-sm font-normal leading-relaxed resize-none"
              />
              <div className="grid grid-cols-[100px_1fr] items-center gap-3">
                <span className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Assinatura</span>
                <Input
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border bg-elevated/20">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={sending} className="gap-2">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar apresentação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmailPreviewRender({
  curatorName, message, signatureName,
}: { curatorName: string; message: string; signatureName: string }) {
  const greeting = `Olá, ${curatorName}.`;
  const paragraphs = message.split("\n\n");
  return (
    <div className="bg-[#0a0a0a] text-white rounded-xl border border-[#1f1f1f] overflow-hidden">
      {/* Brand */}
      <div className="text-center pt-10 pb-8 px-6 bg-[#0a0a0a]">
        <img
          src={nexengineLogo}
          alt="NexEngine"
          className="mx-auto block w-auto object-contain"
          style={{ height: 64, maxWidth: 280 }}
        />
      </div>
      {/* Card */}
      <div className="mx-6 mb-6 bg-[#141414] border border-[#262626] rounded-2xl p-8">
        <h3 className="text-[18px] font-semibold text-white mb-5">{greeting}</h3>
        {paragraphs.map((p, i) => (
          <p key={i} className="text-[14px] text-[#d4d4d8] leading-[1.65] mb-4 whitespace-pre-wrap">
            {p}
          </p>
        ))}
        <div className="mt-2 mb-2 text-center">
          <a
            href="https://wa.me/5511930910013"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-[#25D366] text-[#0a0a0a] text-[13px] font-semibold px-5 py-3 rounded-[10px] no-underline"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12.014 2c-5.514 0-9.989 4.475-9.989 9.989 0 1.762.462 3.482 1.337 4.992L2 22l5.144-1.349a9.94 9.94 0 0 0 4.87 1.244h.004c5.514 0 9.989-4.475 9.989-9.989S17.528 2 12.014 2z"/>
            </svg>
            Falar no WhatsApp
          </a>
        </div>
        <hr className="border-t border-[#262626] my-6" />
        <div className="text-[14px] font-semibold text-white">{signatureName}</div>
        <div className="text-[12px] text-[#9ca3af]">Parcerias & Curadoria · NexEngine</div>
      </div>
      <div className="text-center text-[10px] text-[#6b7280] tracking-wider pb-4 bg-[#0a0a0a]">
        NexEngine · engine.nexcreatorx.com
      </div>
    </div>
  );
}

/* ============================================================
   Helper: Instagram com mensagem copiada
   ============================================================ */
export function buildInstagramMessage(curatorName: string, playlistName?: string | null) {
  const ref = playlistName ? ` da playlist "${playlistName}"` : "";
  return `Olá${curatorName ? `, ${curatorName}` : ""}! Sou da NexEngine — plataforma de distribuição e curadoria musical. Conhecemos seu trabalho${ref} e gostaríamos de entender como você opera curadoria e se trabalha com parcerias estruturadas. Podemos trocar uma ideia?`;
}

export async function openInstagramWithMessage(
  handle: string,
  curatorName: string,
  playlistName?: string | null,
) {
  const cleanHandle = handle.replace(/^@/, "");
  const msg = buildInstagramMessage(curatorName, playlistName);
  try {
    await navigator.clipboard.writeText(msg);
    toast.success("Mensagem copiada — cole na DM do Instagram", { duration: 4000 });
  } catch {
    toast.info("Abra a DM e cole a mensagem manualmente");
  }
  window.open(`https://instagram.com/${cleanHandle}`, "_blank", "noopener");
}