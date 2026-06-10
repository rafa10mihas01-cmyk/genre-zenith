// Bloco compacto pra mostrar histórico de planilhas dentro do Monitoramento.
// Mostra resumo + lista das últimas atualizações com botão de download (admin) +
// CTA pra abrir o modal de upload.
import { useState } from "react";
import { FileSpreadsheet, Download, Upload as UploadIcon, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";

type Upload = {
  id: string;
  created_at: string;
  rows_imported: number;
  total_streams: number;
  status: string;
  file_name: string | null;
  file_path?: string | null;
  is_baseline?: boolean | null;
};

type Props = {
  recentUploads: Upload[];
  onOpenUpload?: () => void;
};

function fmtNumber(n: number) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 60) return `há ${m}min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.round(h / 24);
  return `há ${d}d`;
}

export function SpreadsheetUploadsCompactCard({ recentUploads, onOpenUpload }: Props) {
  const { isAdmin } = useUserRole();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownload = async (u: Upload) => {
    if (!u.file_path) {
      toast.error("Arquivo original não disponível pra esse upload");
      return;
    }
    setDownloadingId(u.id);
    try {
      const { data, error } = await supabase.storage
        .from("label-spreadsheets")
        .createSignedUrl(u.file_path, 60);
      if (error || !data?.signedUrl) throw error ?? new Error("Falha ao gerar link");
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = u.file_name ?? "planilha.xlsx";
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao baixar planilha");
    } finally {
      setDownloadingId(null);
    }
  };

  const lastAt = recentUploads[0]?.created_at ?? null;
  const baselineCount = recentUploads.filter((u) => u.is_baseline).length;
  const followups = recentUploads.length - baselineCount;

  return (
    <Card className="!p-0">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FileSpreadsheet className="h-4 w-4 text-domain-campaigns shrink-0" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-foreground leading-tight">
                Planilhas da gravadora
              </div>
              <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                {recentUploads.length === 0
                  ? "Nenhuma planilha enviada ainda"
                  : `${recentUploads.length} enviada${recentUploads.length > 1 ? "s" : ""}${
                      baselineCount ? ` · ${baselineCount} baseline` : ""
                    }${followups ? ` · ${followups} acompanhamento${followups > 1 ? "s" : ""}` : ""} · última ${fmtAgo(lastAt)}`}
              </div>
            </div>
          </div>
          {/* Botão "Subir nova planilha" removido — função já existe no cabeçalho da página (botão de upload). */}

        </div>

        {recentUploads.length > 0 && (
          <div className="pt-2 border-t border-border/40">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1.5">
              Últimas atualizações
            </div>
            <ul className="space-y-1">
              {recentUploads.slice(0, 5).map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground"
                >
                  <span className="tabular-nums shrink-0 w-[120px]">
                    {new Date(u.created_at).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {u.is_baseline && (
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border border-primary/40 text-primary leading-none shrink-0">
                      baseline
                    </span>
                  )}
                  <span className="flex-1 text-right tabular-nums truncate">
                    {u.rows_imported} playlists · {fmtNumber(u.total_streams)} streams
                  </span>
                  {isAdmin && u.file_path && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-muted-foreground hover:text-foreground shrink-0"
                      onClick={() => handleDownload(u)}
                      disabled={downloadingId === u.id}
                      title={u.file_name ?? "Baixar planilha original"}
                    >
                      {downloadingId === u.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Download className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
