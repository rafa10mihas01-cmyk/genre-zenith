import { useMemo, useState } from "react";
import {
  ClipboardPaste,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const SPOTIFY_PLAYLIST_RE =
  /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/([A-Za-z0-9]{22})(?:[/?#].*)?$/i;

const MAX_LINES = 50;

type LineState =
  | { status: "valid"; url: string; id: string }
  | { status: "duplicate"; url: string; id: string }
  | { status: "invalid"; url: string; reason: string };

function parseLines(raw: string): LineState[] {
  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: LineState[] = [];
  for (const t of tokens) {
    const m = t.match(SPOTIFY_PLAYLIST_RE);
    if (!m) {
      let reason = "link inválido";
      if (/open\.spotify\.com\/(track|album|artist|episode|show)/i.test(t)) {
        reason = "não é uma playlist";
      } else if (/spotify\.com/i.test(t)) {
        reason = "link malformado";
      } else if (/^https?:\/\//i.test(t)) {
        reason = "não é link do Spotify";
      } else {
        reason = "não é uma URL";
      }
      out.push({ status: "invalid", url: t, reason });
      continue;
    }
    const id = m[1];
    if (seen.has(id)) {
      out.push({ status: "duplicate", url: t, id });
      continue;
    }
    seen.add(id);
    out.push({ status: "valid", url: t, id });
  }
  return out;
}

// ---------- Resultado do servidor ----------
type ServerStatus =
  | "ok"
  | "blocked"
  | "duplicate"
  | "duplicate_in_payload"
  | "baseline_blocked"
  | "campaign_baseline_blocked"
  | "baseline_conflict"
  | "awaiting_baseline"
  | "track_already_present"
  | "invalid_url"
  | "not_found"
  | "error"
  | "timeout";

type ServerItem = {
  url: string;
  playlist_id?: string | null;
  status: ServerStatus;
  error?: string;
  track_presence?: { found?: boolean; position?: number | null };
};

const STATUS_LABEL: Record<ServerStatus, string> = {
  ok: "adicionada",
  blocked: "bloqueada",
  duplicate: "já existia no deal",
  duplicate_in_payload: "repetida na lista",
  baseline_blocked: "já estava na baseline (antes do deal)",
  campaign_baseline_blocked: "já fazia parte da baseline oficial da campanha",
  baseline_conflict: "música já existia antes da campanha",
  awaiting_baseline: "campanha aguardando baseline",
  track_already_present: "já contém a música",
  invalid_url: "link inválido",
  not_found: "playlist não encontrada",
  error: "erro",
  timeout: "tempo esgotado",
};

function isProblem(s: ServerStatus): boolean {
  return s === "invalid_url" || s === "not_found" || s === "error" || s === "timeout";
}
function isSoftIssue(s: ServerStatus): boolean {
  return (
    s === "duplicate" ||
    s === "duplicate_in_payload" ||
    s === "baseline_blocked" ||
    s === "campaign_baseline_blocked" ||
    s === "baseline_conflict" ||
    s === "awaiting_baseline" ||
    s === "track_already_present" ||
    s === "blocked"
  );
}


export interface PasteUrlsDialogProps {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
  publicToken: string;
  songId?: string | null;
  songRequired?: boolean;
  writable?: boolean;
}

export function PasteUrlsDialog({
  open,
  onClose,
  onImported,
  publicToken,
  songId,
  songRequired,
  writable = true,
}: PasteUrlsDialogProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    items: ServerItem[];
    added: number;
    soft: number;
    failed: number;
  } | null>(null);

  const lines = useMemo(() => parseLines(text), [text]);
  const counts = useMemo(() => {
    let valid = 0, invalid = 0, duplicate = 0;
    for (const l of lines) {
      if (l.status === "valid") valid++;
      else if (l.status === "duplicate") duplicate++;
      else invalid++;
    }
    return { valid, invalid, duplicate, total: lines.length };
  }, [lines]);

  const overLimit = counts.valid > MAX_LINES;
  const canSubmit = !submitting && writable && !songRequired && counts.valid > 0 && !overLimit;

  const reset = () => {
    setText("");
    setResult(null);
  };

  const handleClose = () => {
    if (submitting) return;
    if (result) {
      onImported?.();
      reset();
    }
    onClose();
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (songRequired) {
      toast.error("Selecione a música antes de importar");
      return;
    }
    const urls = lines
      .filter((l): l is Extract<LineState, { status: "valid" }> => l.status === "valid")
      .map((l) => l.url);
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "register-curator-playlist",
        { body: { public_token: publicToken, urls, song_id: songId ?? null } },
      );
      if (error || !data?.ok) {
        toast.error(data?.error || error?.message || "Erro ao importar playlists");
        return;
      }
      const items: ServerItem[] = Array.isArray(data.items) ? data.items : [];
      const added = items.filter((i) => i.status === "ok").length;
      const failed = items.filter((i) => isProblem(i.status)).length;
      const soft = items.filter((i) => isSoftIssue(i.status)).length;
      setResult({ items, added, soft, failed });
      // Toast curto — o detalhe vai na tela de resultado.
      if (failed > 0) {
        toast.warning(`${added} adicionadas · ${failed} com problema`);
      } else if (soft > 0) {
        toast.success(`${added} adicionadas`, { description: `${soft} ignoradas` });
      } else {
        toast.success(`${added} adicionada${added === 1 ? "" : "s"}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- copiar URLs problemáticas ----------
  const copyProblemUrls = async () => {
    if (!result) return;
    const problemUrls = result.items
      .filter((i) => isProblem(i.status))
      .map((i) => i.url)
      .join("\n");
    if (!problemUrls) return;
    try {
      await navigator.clipboard.writeText(problemUrls);
      toast.success("URLs com problema copiadas");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  // ===== TELA DE RESULTADO =====
  if (result) {
    const problems = result.items.filter((i) => isProblem(i.status));
    const softs = result.items.filter((i) => isSoftIssue(i.status));
    return (
      <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-semibold text-base inline-flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Importação concluída
            </DialogTitle>
            <DialogDescription className="text-[13px] text-muted-foreground">
              {result.added} adicionada{result.added === 1 ? "" : "s"} ·{" "}
              {result.failed} com problema · {result.soft} ignorada{result.soft === 1 ? "" : "s"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
            {problems.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] uppercase tracking-wider text-destructive font-semibold">
                    Não adicionadas — revise e tente de novo
                  </h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px] gap-1.5"
                    onClick={copyProblemUrls}
                  >
                    <Copy className="h-3 w-3" /> Copiar URLs
                  </Button>
                </div>
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 divide-y divide-border/40 max-h-[300px] overflow-y-auto">
                  {problems.map((it, idx) => (
                    <div key={idx} className="flex items-start gap-2 px-3 py-2 text-[12px]">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <a
                          href={it.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[11.5px] truncate block hover:text-primary inline-flex items-center gap-1"
                          title={it.url}
                        >
                          <span className="truncate">{it.url}</span>
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                        </a>
                        <div className="text-[11px] text-destructive/90">
                          {STATUS_LABEL[it.status]}
                          {it.error ? ` — ${it.error}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Dica: "não encontrada" geralmente acontece com playlists privadas, deletadas ou
                  com link incompleto. Abra cada uma no Spotify e copie o link de novo pelo botão
                  "Compartilhar → Copiar link da playlist".
                </p>
              </section>
            )}

            {softs.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-[11px] uppercase tracking-wider text-warning font-semibold">
                  Ignoradas
                </h3>
                <div className="rounded-xl border border-border/60 bg-[hsl(var(--elevated))] divide-y divide-border/40 max-h-[200px] overflow-y-auto">
                  {softs.map((it, idx) => (
                    <div key={idx} className="flex items-start gap-2 px-3 py-2 text-[12px]">
                      <Copy className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[11.5px] truncate text-muted-foreground" title={it.url}>
                          {it.url}
                        </div>
                        <div className="text-[11px] text-warning">{STATUS_LABEL[it.status]}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {problems.length === 0 && softs.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Tudo certo — todas as playlists foram adicionadas.
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2">
            {problems.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => {
                  // pré-preenche o textarea com as URLs problemáticas pra tentar de novo
                  setText(problems.map((p) => p.url).join("\n"));
                  setResult(null);
                }}
              >
                Tentar de novo
              </Button>
            )}
            <Button onClick={handleClose}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ===== TELA DE INPUT =====
  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-semibold text-base inline-flex items-center gap-2">
            <ClipboardPaste className="h-4 w-4 text-primary" />
            Colar várias playlists
          </DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground">
            Cole até {MAX_LINES} links de playlists do Spotify, um por linha.
            Aceita também separados por vírgula ou espaço.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`https://open.spotify.com/playlist/...\nhttps://open.spotify.com/playlist/...\nhttps://open.spotify.com/playlist/...`}
            className="min-h-[180px] max-h-[260px] font-mono text-[12px] leading-relaxed bg-[hsl(var(--elevated))] border-border/60"
            disabled={submitting}
            spellCheck={false}
          />

          <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2 py-1 rounded-full font-medium tabular-nums",
                counts.valid > 0 && !overLimit
                  ? "bg-success/15 text-success ring-1 ring-success/30"
                  : "bg-muted/40 text-muted-foreground ring-1 ring-border",
              )}
            >
              <CheckCircle2 className="h-3 w-3" />
              {counts.valid} válida{counts.valid === 1 ? "" : "s"}
            </span>
            {counts.duplicate > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full font-medium tabular-nums bg-warning/10 text-warning ring-1 ring-warning/30">
                <Copy className="h-3 w-3" />
                {counts.duplicate} duplicada{counts.duplicate === 1 ? "" : "s"}
              </span>
            )}
            {counts.invalid > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full font-medium tabular-nums bg-destructive/10 text-destructive ring-1 ring-destructive/30">
                <AlertTriangle className="h-3 w-3" />
                {counts.invalid} inválida{counts.invalid === 1 ? "" : "s"}
              </span>
            )}
            {overLimit && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full font-medium tabular-nums bg-destructive/15 text-destructive ring-1 ring-destructive/40">
                Acima do limite ({MAX_LINES})
              </span>
            )}
          </div>

          {(counts.invalid > 0 || counts.duplicate > 0) && (
            <div className="rounded-xl border border-border/60 bg-[hsl(var(--elevated))] max-h-[160px] overflow-y-auto p-2 space-y-1">
              {lines
                .map((l, i) => ({ l, i }))
                .filter(({ l }) => l.status !== "valid")
                .slice(0, 30)
                .map(({ l, i }) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-[11.5px] px-2 py-1 rounded-md"
                  >
                    {l.status === "duplicate" ? (
                      <Copy className="h-3 w-3 mt-0.5 shrink-0 text-warning" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-destructive" />
                    )}
                    <span className="font-mono truncate flex-1 text-muted-foreground">
                      {l.url || "(linha vazia)"}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[10.5px] uppercase tracking-wider",
                        l.status === "duplicate" ? "text-warning" : "text-destructive",
                      )}
                    >
                      {l.status === "duplicate"
                        ? "duplicada"
                        : l.status === "invalid"
                          ? l.reason
                          : ""}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="ghost" onClick={handleClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} className="gap-2">
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ClipboardPaste className="h-4 w-4" />
            )}
            Adicionar {counts.valid > 0 ? `(${counts.valid})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
