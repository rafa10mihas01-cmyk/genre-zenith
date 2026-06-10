// SpreadsheetUploadCard — card do portal público pro cliente subir a planilha
// (XLSX da distribuidora OU CSV do Spotify) quando o deal NÃO tem Spotify
// conectado. Mostra última atualização, preview com matches e histórico curto.
import { useEffect, useRef, useState } from "react";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, Download, Lock, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Upload = {
  id: string;
  created_at: string;
  rows_imported: number;
  total_streams: number;
  status: string;
  file_name: string | null;
  file_path?: string | null;
};

type Preview = {
  rows: number;
  total_streams: number;
  unique_isrcs: string[];
  format?: string;
  playlists_recognized?: number;
  curators_recognized?: number;
  internal_count?: number;
  organic_count?: number;
  best_position?: number | null;
  top_playlists?: Array<{ name: string; streams: number; owner: string | null; is_internal?: boolean }>;
  playlists: Array<{ name: string; streams: number; owner: string | null }>;
  warnings: string[];
  auto_fixes?: Record<string, number>;
  auto_fixes_total?: number;
};

const FIX_LABELS: Record<string, string> = {
  empty_rows: "linhas vazias removidas",
  junk_rows: "linhas de total ignoradas",
  duplicates: "duplicatas removidas",
  url_cleaned: "URLs limpas",
  number_normalized: "números normalizados",
  negative_clamped: "valores negativos zerados",
  invalid_position: "posições inválidas ignoradas",
};

interface Props {
  clientToken: string;
  lastUploadAt: string | null;
  recentUploads: Upload[];
  onUploaded?: () => void;
  /** Quando false, o card é bloqueado até a equipe aprovar a campanha. Default: true. */
  approved?: boolean;
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
  approved = true,
}: Props) {
  const { isAdmin } = useUserRole();
  const inputRef = useRef<HTMLInputElement>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownloadUpload = async (u: Upload) => {
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
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phase, setPhase] = useState<"idle" | "previewing" | "previewed" | "done">("idle");
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const days = daysAgo(lastUploadAt);
  const stale = days != null && days >= 2;
  const never = !lastUploadAt;
  const isFirstUpload = recentUploads.length === 0;


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
    const lower = f.name.toLowerCase();
    const isXlsx = lower.endsWith(".xlsx") || lower.endsWith(".xls");
    const isCsv = lower.endsWith(".csv");
    if (!isXlsx && !isCsv) {
      setError("Envie .xlsx, .xls ou .csv");
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

  const [downloadingTpl, setDownloadingTpl] = useState(false);
  const handleDownloadTemplate = async () => {
    setDownloadingTpl(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("placement-template-download", {
        body: { client_token: clientToken },
      });
      if (fnErr || !data?.ok) {
        setError(data?.error || fnErr?.message || "Falha ao gerar modelo");
        return;
      }
      const b64 = data.file_base64 as string;
      const name = data.file_name as string;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingTpl(false);
    }
  };

  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-foreground leading-tight">
                Atualizar dados da campanha
              </h3>
              <p className="text-[12px] text-muted-foreground mt-1 leading-snug">
                Suba a planilha mais recente (.xlsx da distribuidora ou .csv do Spotify for Artists).
              </p>
            </div>
          </div>
          <div className="shrink-0 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-right min-w-[120px]">
            <div className="text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
              Última atualização
            </div>
            <div
              className={cn(
                "text-[14px] font-semibold tabular-nums leading-tight mt-0.5",
                never ? "text-muted-foreground" : stale ? "text-amber-500" : "text-success",
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
            {lastUploadAt && (
              <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                {new Date(lastUploadAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </div>
        </div>

        {isFirstUpload && phase === "idle" && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-start gap-3">
            <Target className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              <div className="text-sm font-medium text-foreground">
                Esta será a baseline
              </div>
              <div className="text-[12px] text-muted-foreground leading-relaxed">
                A primeira planilha registra o estado atual antes da campanha começar. As próximas (a cada 2 dias) serão usadas para calcular a entrega real.
              </div>
            </div>
          </div>
        )}

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
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Pré-visualização
                </div>
                {preview.format && (
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border/60 rounded px-1.5 py-0.5">
                    {preview.format}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <div className="text-[11px] text-muted-foreground">Playlists</div>
                  <div className="text-xl font-semibold text-foreground">{preview.rows}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Streams</div>
                  <div className="text-xl font-semibold text-foreground">{fmtNumber(preview.total_streams)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Nossas</div>
                  <div className="text-xl font-semibold text-primary">{preview.internal_count ?? 0}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Orgânicas</div>
                  <div className="text-xl font-semibold text-foreground">{preview.organic_count ?? preview.rows}</div>
                </div>
              </div>
              {(preview.playlists_recognized || preview.curators_recognized || preview.best_position) && (
                <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                  {preview.playlists_recognized ? <span>{preview.playlists_recognized} playlists reconhecidas</span> : null}
                  {preview.curators_recognized ? <span>· {preview.curators_recognized} curador(es) identificado(s)</span> : null}
                  {preview.best_position ? <span>· melhor posição #{preview.best_position}</span> : null}
                </div>
              )}
              {preview.top_playlists && preview.top_playlists.length > 0 && (
                <div className="pt-2 border-t border-border/60">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Top playlists</div>
                  <ul className="space-y-1">
                    {preview.top_playlists.slice(0, 3).map((p, i) => (
                      <li key={i} className="flex items-center justify-between text-[12px]">
                        <span className="truncate flex items-center gap-1.5">
                          {p.is_internal && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                          <span className="truncate">{p.name}</span>
                        </span>
                        <span className="text-muted-foreground tabular-nums shrink-0 ml-2">{fmtNumber(p.streams)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.auto_fixes_total && preview.auto_fixes_total > 0 ? (
                <div className="pt-2 border-t border-border/60 flex items-start gap-2 text-[11px] text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                  <span>
                    <span className="text-foreground font-medium">{preview.auto_fixes_total} ajuste{preview.auto_fixes_total > 1 ? "s" : ""} automático{preview.auto_fixes_total > 1 ? "s" : ""}</span>
                    {" — "}
                    {Object.entries(preview.auto_fixes ?? {})
                      .filter(([, n]) => n > 0)
                      .map(([k, n]) => `${n} ${FIX_LABELS[k] ?? k}`)
                      .join(" · ")}
                  </span>
                </div>
              ) : null}
              {preview.warnings.length > 0 && (
                <div className="text-[11px] text-amber-500">{preview.warnings.join(" · ")}</div>
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
          <>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
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
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30",
              )}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
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
                    .xlsx, .xls ou .csv · máx 8MB
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDownloadTemplate}
                disabled={downloadingTpl}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {downloadingTpl ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                )}
                Baixar planilha modelo
              </Button>
            </div>
          </>
        )}


        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {recentUploads.length > 0 && (
          <div className="rounded-lg border border-border/60 bg-muted/10 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-muted/20">
              <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                Histórico de importações
              </div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground tabular-nums">
                {recentUploads.length} registros
              </div>
            </div>
            <ul className="divide-y divide-border/40">
              {recentUploads.slice(0, 5).map((u, idx) => {
                const d = new Date(u.created_at);
                const dateStr = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
                const timeStr = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                const isLatest = idx === 0;
                return (
                  <li
                    key={u.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {isLatest ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-foreground tabular-nums leading-tight">
                          {dateStr}
                        </div>
                        <div className="text-[10.5px] text-muted-foreground tabular-nums leading-tight">
                          {timeStr}
                          {isLatest && <span className="ml-1.5 text-success font-medium uppercase tracking-wide text-[9.5px]">· atual</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 hidden sm:block">
                      <div className="text-[12.5px] font-semibold text-foreground tabular-nums leading-tight">
                        {fmtNumber(u.total_streams)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">streams</div>
                    </div>
                    <div className="text-right shrink-0 min-w-[80px]">
                      <div className="text-[12.5px] font-semibold text-foreground tabular-nums leading-tight">
                        {u.rows_imported}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">playlists</div>
                    </div>
                    {isAdmin && u.file_path && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
                        onClick={() => handleDownloadUpload(u)}
                        disabled={downloadingId === u.id}
                        title={u.file_name ?? "Baixar planilha original"}
                      >
                        {downloadingId === u.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
