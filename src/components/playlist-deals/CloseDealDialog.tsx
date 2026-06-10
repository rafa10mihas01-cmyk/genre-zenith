import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, FileDown } from "lucide-react";
import { toast } from "sonner";

import { FormModal } from "@/components/ui/form-modal";
import { Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { useFormDraft } from "@/hooks/useFormDraft";
import { DraftBanner, DraftIndicator } from "@/components/forms/DraftBanner";

import {
  computeCuratorStats,
  type CuratorDeal,
  type CuratorDealLog,
  type CuratorDealSong,
  type CuratorPlaylist,
  type CuratorDealProgress,
} from "@/lib/curatorDealsUtils";
import { buildDealClosurePdf, uploadClosurePdf } from "@/lib/dealClosurePdf";

export interface CloseDealDialogProps {
  open: boolean;
  deal: CuratorDeal | null;
  songs: CuratorDealSong[];
  logs: CuratorDealLog[];
  playlists: CuratorPlaylist[];
  progress?: CuratorDealProgress | null;
  onClose: () => void;
  onConfirm: (
    dealId: string,
    opts: { status: "completed" | "cancelled"; reason?: string | null; report_url?: string | null },
  ) => Promise<void>;
}

export function CloseDealDialog({
  open, deal, songs, logs, playlists, progress, onClose, onConfirm,
}: CloseDealDialogProps) {
  const [status, setStatus] = useState<"completed" | "cancelled">("completed");
  const [reason, setReason] = useState("");
  const [genReport, setGenReport] = useState(true);
  const [busy, setBusy] = useState(false);

  const draftKey = deal ? `close-deal:${deal.id}` : "close-deal:none";
  const isDraftEmpty = !reason.trim() && status === "completed" && genReport === true;
  const draft = useFormDraft(
    draftKey,
    { enabled: open && !!deal && !busy, isEmpty: isDraftEmpty },
    { status, reason, genReport },
  );

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStatus("completed");
      setReason("");
      setGenReport(true);
    }
  }, [open]);

  if (!deal) return null;
  const stats = computeCuratorStats(deal, logs, playlists, progress ?? null);
  const target = Number(deal.target_plays ?? 0);
  const hitTarget = target > 0 && stats.earned >= target;

  const handleSubmit = async () => {
    if (!deal) return;
    setBusy(true);
    try {
      let reportUrl: string | null = null;
      if (genReport) {
        const blob = buildDealClosurePdf({
          deal,
          songs,
          logs,
          playlists,
          progress: progress ?? null,
          closeStatus: status,
          closeReason: reason.trim() || null,
        });
        try {
          reportUrl = await uploadClosurePdf(blob, deal.id);
        } catch (err) {
          console.error("[CloseDealDialog] upload pdf falhou", err);
          // download local como fallback
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `fechamento-${deal.id}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
          toast.warning("Não foi possível salvar o PDF na nuvem; baixado localmente");
        }
      }
      await onConfirm(deal.id, {
        status,
        reason: reason.trim() || null,
        report_url: reportUrl,
      });
      draft.clearDraft();
      toast.success(status === "completed" ? "Deal concluído" : "Deal encerrado");
      onClose();
    } catch (e) {
      console.error("[CloseDealDialog] confirm error", e);
      toast.error("Erro ao encerrar deal");
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreDraft = () => {
    const d = draft.restoreDraft();
    if (!d) return;
    setStatus(d.status);
    setReason(d.reason);
    setGenReport(d.genReport);
  };

  return (
    <FormModal
      open={open}
      onOpenChange={(o) => { if (!o && !busy) onClose(); }}
      title="Encerrar deal"
      description={
        <span className="flex items-center justify-between gap-2">
          <span>{deal.curator_name} · {deal.song_name}</span>
          <DraftIndicator lastSavedAt={draft.lastSavedAt} />
        </span>
      }
      icon={<Handshake className="h-4 w-4" />}
      iconTone="deals"
      size="md"
      preventClose={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={busy || (status === "cancelled" && !reason.trim())}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            {busy ? "Encerrando..." : "Encerrar deal"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
          {draft.hasDraft && (
            <DraftBanner onRestore={handleRestoreDraft} onDiscard={draft.clearDraft} />
          )}
          {/* Snapshot final */}
          <div className="rounded-lg bg-muted/40 border border-border p-3 space-y-1.5">
            <div className="flex justify-between text-[12px]">
              <span className="text-muted-foreground">Plays entregues</span>
              <span className="font-medium tabular-nums">
                {stats.earned.toLocaleString("pt-BR")} / {target.toLocaleString("pt-BR")} ({stats.pct}%)
              </span>
            </div>
            <div className="flex justify-between text-[12px]">
              <span className="text-muted-foreground">Qualidade do tráfego</span>
              <span className="font-medium tabular-nums">
                {Math.round(stats.legitShare * 100)}% legítimo
              </span>
            </div>
            <div className="flex justify-between text-[12px]">
              <span className="text-muted-foreground">Score</span>
              <span className="font-semibold tabular-nums text-primary">{stats.score}/100</span>
            </div>
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Resultado
            </Label>
            <RadioGroup value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <label
                htmlFor="completed"
                className="flex items-start gap-2 rounded-md border border-border p-2.5 cursor-pointer hover:border-foreground/30"
              >
                <RadioGroupItem id="completed" value="completed" className="mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    Concluído
                    {hitTarget && (
                      <span className="text-[10px] uppercase font-bold tracking-wider text-success">
                        meta batida
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    O curador entregou conforme o combinado
                  </div>
                </div>
              </label>
              <label
                htmlFor="cancelled"
                className="flex items-start gap-2 rounded-md border border-border p-2.5 cursor-pointer hover:border-foreground/30"
              >
                <RadioGroupItem id="cancelled" value="cancelled" className="mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    <XCircle className="h-3.5 w-3.5 text-destructive" />
                    Encerrado sem entrega completa
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Cancelado, descumprido ou parcial
                  </div>
                </div>
              </label>
            </RadioGroup>
          </div>

          {/* Motivo */}
          <div className="space-y-2">
            <Label htmlFor="reason" className="text-xs uppercase tracking-wider text-muted-foreground">
              Motivo / observações {status === "cancelled" && <span className="text-destructive">*</span>}
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={status === "completed"
                ? "Opcional — ex: bateu meta antes do prazo"
                : "Obrigatório — ex: curador não respondeu, tráfego suspeito"}
              rows={3}
              className="text-sm resize-none"
            />
          </div>

          {/* Gerar PDF */}
          <label
            htmlFor="genReport"
            className="flex items-start gap-2 rounded-md border border-border p-2.5 cursor-pointer hover:border-foreground/30"
          >
            <Checkbox
              id="genReport"
              checked={genReport}
              onCheckedChange={(v) => setGenReport(v === true)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <FileDown className="h-3.5 w-3.5" />
                Gerar relatório PDF de fechamento
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Inclui músicas, evolução, playlists e score
              </div>
            </div>
          </label>
      </div>
    </FormModal>
  );
}
