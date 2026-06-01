import { FileSpreadsheet, CheckCircle2, Clock, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

type Upload = {
  id: string;
  created_at: string;
  is_baseline: boolean;
  file_name?: string | null;
  total_rows?: number | null;
};

type Props = {
  lastUploadAt: string | null;
  recentUploads: Upload[];
  onOpenUpload?: () => void;
};

function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `há ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.round(h / 24);
  return `há ${d}d`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function SpreadsheetCollectionStatus({ lastUploadAt, recentUploads, onOpenUpload }: Props) {
  const baseline = recentUploads.find((u) => u.is_baseline);
  const followups = recentUploads.filter((u) => !u.is_baseline);
  const hasBaseline = !!baseline;

  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4 space-y-3">
      <div className="flex items-start gap-4">
        <div className="shrink-0 mt-0.5">
          {hasBaseline ? (
            <CheckCircle2 className="h-5 w-5 text-primary" />
          ) : (
            <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground flex items-center gap-2 flex-wrap">
            Coleta via planilha
            <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border border-domain-campaigns/40 text-domain-campaigns leading-none">
              <FileSpreadsheet className="inline h-3 w-3 mr-1 -mt-0.5" />
              Excel
            </span>
            <span
              className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border leading-none ${
                hasBaseline ? "border-primary/50 text-primary" : "border-border text-muted-foreground"
              }`}
            >
              {hasBaseline ? "Baseline capturada" : "Aguardando 1º upload"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {hasBaseline
              ? `${recentUploads.length} planilha${recentUploads.length > 1 ? "s" : ""} importada${recentUploads.length > 1 ? "s" : ""} · última ${fmtAgo(lastUploadAt)}`
              : "A gravadora ainda não subiu a primeira planilha"}
          </div>
        </div>
        {onOpenUpload && (
          <div className="shrink-0">
            <Button variant="outline" size="sm" onClick={onOpenUpload}>
              <Upload className="h-3.5 w-3.5 mr-2" />
              Subir nova planilha
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px] pt-2 border-t border-border/40">
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Baseline</div>
          <div className="text-foreground font-medium tabular-nums">{fmtDate(baseline?.created_at ?? null)}</div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Acompanhamentos</div>
          <div className="text-foreground font-medium tabular-nums">{followups.length}</div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Último upload</div>
          <div className="text-foreground font-medium tabular-nums">{fmtAgo(lastUploadAt)}</div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Fonte de verdade</div>
          <div className="text-foreground font-medium">Planilha da gravadora</div>
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
        <Clock className="h-3 w-3 mt-0.5 shrink-0" />
        <span>
          Nessa campanha o robô não coleta — cada novo XLSX gera um snapshot completo e recalcula deltas automaticamente.
        </span>
      </div>
    </div>
  );
}
