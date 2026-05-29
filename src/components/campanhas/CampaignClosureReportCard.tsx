import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FileText, Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateAndStoreCampaignReport } from "@/lib/campaignClosurePdf";
import { toast } from "@/hooks/use-toast";

type Props = {
  campaignId: string;
  status: string;
  finalReportUrl: string | null;
  finalReportRequestedAt: string | null;
  onGenerated?: (url: string) => void;
};

export function CampaignClosureReportCard({
  campaignId,
  status,
  finalReportUrl,
  finalReportRequestedAt,
  onGenerated,
}: Props) {
  const [url, setUrl] = useState<string | null>(finalReportUrl);
  const [busy, setBusy] = useState(false);
  const isCompleted = status === "completed";
  const autoTriggered = isCompleted && !!finalReportRequestedAt && !url && !busy;

  useEffect(() => {
    setUrl(finalReportUrl);
  }, [finalReportUrl]);

  // Auto-gera 1x quando operador abre campanha completed sem relatório
  useEffect(() => {
    if (!autoTriggered) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const generated = await generateAndStoreCampaignReport(campaignId);
        if (cancelled) return;
        setUrl(generated);
        onGenerated?.(generated);
      } catch (e) {
        if (!cancelled) {
          console.error("[campaign-closure-report] auto-generate failed", e);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTriggered, campaignId]);

  async function manualGenerate() {
    setBusy(true);
    try {
      const generated = await generateAndStoreCampaignReport(campaignId);
      setUrl(generated);
      onGenerated?.(generated);
      toast({ title: "Relatório gerado" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Falha ao gerar relatório", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (!isCompleted) return null;

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-muted/50 p-2">
            <FileText className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Relatório de fechamento</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {url
                ? "PDF disponível para download."
                : busy
                  ? "Gerando relatório completo…"
                  : "Gere o PDF consolidado da campanha."}
            </p>
          </div>
        </div>
        <div className="shrink-0">
          {url ? (
            <Button asChild variant="outline" size="sm">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4 mr-2" /> Baixar PDF
              </a>
            </Button>
          ) : (
            <Button onClick={manualGenerate} disabled={busy} size="sm">
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Gerando…
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" /> Gerar agora
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
