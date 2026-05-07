import { useMemo, useState } from "react";
import { ClipboardPaste, Loader2, AlertTriangle, CheckCircle2, Copy } from "lucide-react";
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
  // aceita separadores: quebra de linha, vírgula, espaço, tab
  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: LineState[] = [];
  for (const t of tokens) {
    const m = t.match(SPOTIFY_PLAYLIST_RE);
    if (!m) {
      // tenta detectar tipo conhecido para mensagem melhor
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

  const lines = useMemo(() => parseLines(text), [text]);
  const counts = useMemo(() => {
    let valid = 0,
      invalid = 0,
      duplicate = 0;
    for (const l of lines) {
      if (l.status === "valid") valid++;
      else if (l.status === "duplicate") duplicate++;
      else invalid++;
    }
    return { valid, invalid, duplicate, total: lines.length };
  }, [lines]);

  const overLimit = counts.valid > MAX_LINES;
  const canSubmit =
    !submitting &&
    writable &&
    !songRequired &&
    counts.valid > 0 &&
    !overLimit;

  const reset = () => {
    setText("");
  };

  const handleClose = () => {
    if (submitting) return;
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
      const items = Array.isArray(data.items) ? data.items : [];
      const s = data.summary ?? {};
      const added =
        s.inserted ??
        items.filter((i: { status?: string }) => i.status === "ok").length;
      const dupExisting = s.duplicate ?? 0;
      const dupPayload = s.duplicate_in_payload ?? 0;
      const alreadyInPlaylist =
        s.track_already_present ??
        items.filter((i: { track_presence?: { found?: boolean } }) =>
          i.track_presence?.found,
        ).length;
      const invalid = s.invalid ?? 0;
      const notFound = s.not_found ?? 0;
      const tmout = s.timeout ?? 0;
      const errs =
        s.error ??
        items.filter((i: { error?: string }) => i.error).length;
      const parts: string[] = [`${added} adicionadas`];
      if (dupExisting) parts.push(`${dupExisting} já no deal`);
      if (dupPayload) parts.push(`${dupPayload} repetidas`);
      if (alreadyInPlaylist) parts.push(`${alreadyInPlaylist} já com a música`);
      if (invalid) parts.push(`${invalid} inválidas`);
      if (notFound) parts.push(`${notFound} não encontradas`);
      if (tmout) parts.push(`${tmout} expiraram`);
      if (errs) parts.push(`${errs} com erro`);
      const hasIssue = errs + tmout + notFound + invalid > 0;
      const notify = hasIssue || alreadyInPlaylist ? toast.warning : toast.success;
      notify("Importação concluída", { description: parts.join(" · ") });
      onImported?.();
      reset();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

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

          {/* Resumo ao vivo */}
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

          {/* Lista de problemas (apenas inválidas/duplicadas) */}
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
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="gap-2"
          >
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
