// SpreadsheetUploadCard — card do portal público pro cliente subir a planilha
// (XLSX da distribuidora OU CSV do Spotify) quando o deal NÃO tem Spotify
// conectado. Mostra última atualização, preview com matches e histórico curto.
import { useEffect, useRef, useState } from "react";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Upload = {
  id: string;
  created_at: string;
  rows_imported: number;
  total_streams: number;
  status: string;
  file_name: string | null;
};

type Preview = {
  rows: number;
  total_streams: number;
  unique_isrcs: string[];
  playlists: Array<{ name: string; streams: number; owner: string | null }>;
  warnings: string[];
};

interface Props {
  clientToken: string;
  lastUploadAt: string | null;
  recentUploads: Upload[];
  onUploaded?: () => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const b64 = result.split(",")[1] ?? result;
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function fmtNumber(n: number) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

export function SpreadsheetUploadCard({
  clientToken,
  lastUploadAt,
  recentUploads,
  onUploaded,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phase, setPhase] = useState<"idle" | "previewing" | "previewed" | "done">("idle");
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const days = daysAgo(lastUploadAt);
  const stale = days != null && days >= 2;
  const never = !lastUploadAt;

  const reset = () => {
    setFile(null);
    setPreview(null);
    setError(null);
    setPhase("idle");
    setCommitting(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (f: File) => {
    setError(null);
    if (!f.name.toLowerCase().endsWith(".xlsx") && !f.name.toLowerCase().endsWith(".xls")) {
      setError("Envie um arquivo .xlsx");
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      setError("Arquivo grande demais (máx 8MB)");
      return;
    }
    setFile(f);
    setPhase("previewing");
    try {
      const b64 = await fileToBase64(f);
      const { data, error: fnErr } = await supabase.functions.invoke("import-label-spreadsheet", {
        body: {
          client_token: clientToken,
          file_base64: b64,
          file_name: f.name,
          mode: "preview",
        },
      });
      if (fnErr || !data?.ok) {
        setError(data?.error || fnErr?.message || "Falha ao processar planilha");
        setPhase("idle");
        return;
      }
      setPreview(data.summary as Preview);
      setPhase("previewed"); setCommitting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  };

  const handleCommit = async () => {
    if (!file) return;
    setCommitting(true);
    setError(null);
    try {
      const b64 = await fileToBase64(file);
      const { data, error: fnErr } = await supabase.functions.invoke("import-label-spreadsheet", {
        body: {
          client_token: clientToken,
          file_base64: b64,
          file_name: file.name,
          mode: "commit",
        },
      });
      if (fnErr || !data?.ok) {
        setError(data?.error || fnErr?.message || "Falha ao gravar");
        setPhase("previewed"); setCommitting(false);
        return;
      }
      setPhase("done");
      setTimeout(() => {
        reset();
        onUploaded?.();
      }, 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("previewed"); setCommitting(false);
    }
  };

  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                Atualizar dados da campanha
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              Suba a planilha mais recente fornecida pela gravadora (.xlsx).
              O sistema reconhece automaticamente as colunas padrão e atualiza
              streams, playlists e progresso.
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Última atualização
            </div>
            <div
              className={cn(
                "text-sm font-medium mt-0.5",
                never
                  ? "text-muted-foreground"
                  : stale
                  ? "text-amber-500"
                  : "text-foreground",
              )}
            >
              {never
                ? "Nunca"
                : days === 0
                ? "Hoje"
                : days === 1
                ? "Ontem"
                : `Há ${days} dias`}
            </div>
          </div>
        </div>

        {stale && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-600 dark:text-amber-400 flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              A última planilha foi enviada há {days} dias. Atualize para manter
              os dados em dia.
            </span>
          </div>
        )}

        {phase === "done" ? (
          <div className="rounded-lg border border-success/30 bg-success/5 p-6 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-success mx-auto" />
            <div className="text-sm font-medium text-foreground">
              Planilha importada com sucesso
            </div>
            <div className="text-xs text-muted-foreground">
              Os números já estão atualizados no painel.
            </div>
          </div>
        ) : phase === "previewed" && preview ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Pré-visualização
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] text-muted-foreground">Playlists</div>
                  <div className="text-xl font-semibold text-foreground">
                    {preview.rows}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Total de streams</div>
                  <div className="text-xl font-semibold text-foreground">
                    {fmtNumber(preview.total_streams)}
                  </div>
                </div>
              </div>
              {preview.warnings.length > 0 && (
                <div className="text-[11px] text-amber-500">
                  {preview.warnings.join(" · ")}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCommit} disabled={committing} className="flex-1">
                {committing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importando...
                  </>
                ) : (
                  "Confirmar importação"
                )}
              </Button>
              <Button variant="outline" onClick={reset} disabled={committing}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "rounded-lg border-2 border-dashed transition-colors cursor-pointer p-6 text-center",
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/30",
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {phase === "previewing" ? (
              <>
                <Loader2 className="h-6 w-6 text-muted-foreground mx-auto mb-2 animate-spin" />
                <div className="text-sm text-muted-foreground">Lendo planilha...</div>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                <div className="text-sm text-foreground">
                  Arraste a planilha aqui ou <span className="text-primary">clique para selecionar</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Formato .xlsx · máx 8MB
                </div>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {recentUploads.length > 0 && (
          <div className="pt-3 border-t border-border/60">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              Últimas atualizações
            </div>
            <ul className="space-y-1.5">
              {recentUploads.slice(0, 5).map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between text-[12px] text-muted-foreground"
                >
                  <span className="truncate">
                    {new Date(u.created_at).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span>
                    {u.rows_imported} playlists · {fmtNumber(u.total_streams)} streams
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
