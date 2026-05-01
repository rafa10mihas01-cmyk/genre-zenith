import { useRef, useState } from "react";
import { ImagePlus, Loader2, Sparkles, CheckCircle2, AlertCircle, X, Info } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

import {
  computeCuratorStats,
  type CuratorDeal,
  type CuratorDealLog,
  type CuratorPlaylist,
} from "@/lib/curatorDealsUtils";
import type {
  NewCuratorLogInput,
  BaselinePlaylistInput,
} from "@/hooks/useCuratorDeals";

type Step = "upload" | "analyzing" | "review" | "playlists" | "confirm";

export interface LogPrintDialogProps {
  open: boolean;
  deal: CuratorDeal | null;
  allLogs: CuratorDealLog[];
  allPlaylists: CuratorPlaylist[];
  onClose: () => void;
  addLog: (input: NewCuratorLogInput) => Promise<CuratorDealLog>;
  addBaseline: (
    dealId: string,
    plays: number,
    baselinePlaylists: BaselinePlaylistInput[],
  ) => Promise<void>;
  addNewPlaylist?: (
    dealId: string,
    spotifyUrl: string,
    playlistName: string,
  ) => Promise<void>;
}

function formatPlays(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("pt-BR");
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function parsePlaylistNames(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function LogPrintDialog({
  open,
  deal,
  allLogs,
  allPlaylists,
  onClose,
  addLog,
  addBaseline,
}: LogPrintDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<number | null>(null);
  const [manualValue, setManualValue] = useState<string>("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Playlists step (baseline OR new playlists in update mode)
  const [playlistsRaw, setPlaylistsRaw] = useState<string>("");
  const [hasNewPlaylists, setHasNewPlaylists] = useState(false);

  const stats = deal ? computeCuratorStats(deal, allLogs, allPlaylists) : null;
  const isBaseline = stats ? !stats.hasBaseline : false;

  const finalValue = extracted ?? (manualValue ? parseInt(manualValue.replace(/\D/g, ""), 10) : NaN);
  const hasFinal = Number.isFinite(finalValue) && finalValue > 0;
  const delta = hasFinal && stats ? finalValue - stats.latestPlays : 0;

  const reset = () => {
    setStep("upload");
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setExtracted(null);
    setManualValue("");
    setAiError(null);
    setNote("");
    setSaving(false);
    setPlaylistsRaw("");
    setHasNewPlaylists(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handlePickFile = (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error("Envie um arquivo de imagem");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error("Imagem muito grande", { description: "Tamanho máximo: 10MB" });
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setExtracted(null);
    setAiError(null);
    setManualValue("");
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setStep("analyzing");
    setAiError(null);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("analyze-deal-print", {
        body: { image_base64: base64, mime_type: file.type },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) {
        setAiError(data?.error ?? "Falha ao analisar imagem");
        setStep("review");
        return;
      }
      setExtracted(Number(data.count));
      setStep("review");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiError(msg);
      setStep("review");
    }
  };

  // Em baseline mode, "Confirmar" leva à etapa de playlists.
  // Em update mode, "Confirmar" leva ao toggle/lista de playlists novas.
  const handleConfirmCount = () => setStep("playlists");

  const handleCorrect = () => {
    setManualValue(extracted != null ? String(extracted) : "");
    setExtracted(null);
  };

  const handleSave = async () => {
    if (!deal || !hasFinal) return;
    setSaving(true);
    try {
      if (isBaseline) {
        const names = parsePlaylistNames(playlistsRaw);
        const baselinePlaylists: BaselinePlaylistInput[] = names.map((name) => ({
          spotify_url: "",
          playlist_name: name,
          followers: null,
        }));
        await addBaseline(deal.id, finalValue as number, baselinePlaylists);
        toast.success("Baseline registrada", {
          description: `${formatPlays(finalValue as number)} plays · ${names.length} playlist(s) iniciais`,
        });
      } else {
        await addLog({
          deal_id: deal.id,
          total_plays: finalValue as number,
          note: note.trim() || null,
        });

        if (hasNewPlaylists) {
          const names = parsePlaylistNames(playlistsRaw);
          if (names.length > 0) {
            const rows = names.map((name) => ({
              deal_id: deal.id,
              spotify_url: "",
              playlist_name: name,
              followers: null,
              is_baseline: false,
            }));
            const { error: plErr } = await supabase
              .from("curator_playlists")
              .insert(rows);
            if (plErr) throw plErr;
          }
        }

        toast.success("Registro salvo", {
          description: stats
            ? `+${formatPlays(Math.max(0, delta))} plays desde o último registro`
            : undefined,
        });
      }
      handleClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Não foi possível salvar", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  if (!deal) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">{deal.song_name}</DialogTitle>
          <DialogDescription className="truncate">
            {deal.song_artist ?? deal.curator_name}
          </DialogDescription>
        </DialogHeader>

        {/* Banner Baseline */}
        {isBaseline && (
          <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 flex gap-3">
            <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              <div className="text-sm font-medium text-foreground">
                Primeiro passo: envie o print inicial
              </div>
              <div className="text-xs text-muted-foreground leading-snug">
                Este print define os plays e playlists existentes antes do deal começar.
                Obrigatório antes de qualquer atualização.
              </div>
            </div>
          </div>
        )}

        {/* Resumo (somente em update mode) */}
        {!isBaseline && stats && (
          <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Último registro</div>
              <div className="text-base font-semibold tabular-nums">{formatPlays(stats.latestPlays)}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Progresso</div>
              <div className="text-base font-semibold tabular-nums text-primary">{stats.pct}%</div>
            </div>
          </div>
        )}

        <div className="animate-tab-in space-y-4">
          {/* STEP UPLOAD */}
          {step === "upload" && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handlePickFile(e.target.files?.[0] ?? null)}
              />
              {!previewUrl ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "w-full rounded-xl border-2 border-dashed border-border",
                    "bg-elevated/40 hover:bg-elevated transition-colors",
                    "py-10 px-4 flex flex-col items-center gap-2 text-center",
                  )}
                >
                  <div className="h-10 w-10 rounded-full bg-elevated border border-border flex items-center justify-center">
                    <ImagePlus className="h-5 w-5 text-primary" />
                  </div>
                  <div className="text-sm font-medium text-foreground">Toque para enviar o print</div>
                  <div className="text-xs text-muted-foreground">Screenshot do Spotify for Artists</div>
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="relative">
                    <img
                      src={previewUrl}
                      alt="Preview do print"
                      className="w-full max-h-40 object-cover rounded-lg border border-border"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (previewUrl) URL.revokeObjectURL(previewUrl);
                        setPreviewUrl(null);
                        setFile(null);
                      }}
                      className="absolute top-2 right-2 h-7 w-7 rounded-full bg-background/80 border border-border flex items-center justify-center hover:bg-background"
                      aria-label="Remover imagem"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Button className="w-full gap-1.5" onClick={handleAnalyze}>
                    <Sparkles className="h-4 w-4" /> Analisar com IA
                  </Button>
                </div>
              )}
            </>
          )}

          {/* STEP ANALYZING */}
          {step === "analyzing" && (
            <div className="py-8 flex flex-col items-center gap-3 text-center">
              <Loader2 className="h-6 w-6 text-primary animate-spin" />
              <div className="text-sm font-medium">Lendo o print com IA...</div>
              <div className="text-xs text-muted-foreground">Isso costuma levar alguns segundos</div>
            </div>
          )}

          {/* STEP REVIEW */}
          {step === "review" && (
            <div className="space-y-3">
              {extracted != null ? (
                <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2 text-xs text-success font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Número detectado
                  </div>
                  <div className="text-2xl font-semibold tabular-nums text-foreground">
                    {formatPlays(extracted)}
                  </div>
                  {!isBaseline && stats && (
                    <div className={cn("text-xs tabular-nums", delta > 0 ? "text-success" : "text-muted-foreground")}>
                      {delta > 0 ? `+${formatPlays(delta)} plays desde o último registro` : "Sem variação desde o último registro"}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-destructive font-medium">
                    <AlertCircle className="h-3.5 w-3.5" /> {aiError ?? "Não foi possível ler o número"}
                  </div>
                  <div className="text-xs text-muted-foreground">Digite o valor manualmente:</div>
                </div>
              )}

              {extracted == null && (
                <div className="space-y-1.5">
                  <Label htmlFor="manual-count">Valor manual</Label>
                  <Input
                    id="manual-count"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="ex: 152340"
                    value={manualValue}
                    onChange={(e) => setManualValue(e.target.value)}
                  />
                </div>
              )}

              <div className="flex items-center gap-2">
                {extracted != null ? (
                  <>
                    <Button className="flex-1" onClick={handleConfirmCount}>Confirmar</Button>
                    <Button variant="outline" className="flex-1" onClick={handleCorrect}>Corrigir</Button>
                  </>
                ) : (
                  <Button className="flex-1" onClick={handleConfirmCount} disabled={!hasFinal}>
                    Continuar
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* STEP PLAYLISTS — baseline OR new playlists toggle */}
          {step === "playlists" && (
            <div className="space-y-3">
              {isBaseline ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="baseline-playlists" className="text-sm font-medium">
                      Playlists existentes agora
                    </Label>
                    <Textarea
                      id="baseline-playlists"
                      placeholder="Cole os nomes das playlists que aparecem no print"
                      value={playlistsRaw}
                      onChange={(e) => setPlaylistsRaw(e.target.value)}
                      rows={5}
                    />
                    <p className="text-xs text-muted-foreground leading-snug">
                      Essas são as playlists "baseline" — novas que aparecerem depois serão
                      marcadas automaticamente. Uma por linha ou separadas por vírgula.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setStep("review")}>
                      Voltar
                    </Button>
                    <Button className="flex-1" onClick={() => setStep("confirm")}>
                      Continuar
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">
                        Apareceu alguma playlist nova neste print?
                      </div>
                      <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                        Compare com as playlists já registradas no deal
                      </div>
                    </div>
                    <Switch
                      checked={hasNewPlaylists}
                      onCheckedChange={setHasNewPlaylists}
                    />
                  </div>

                  {hasNewPlaylists && (
                    <div className="space-y-1.5">
                      <Label htmlFor="new-playlists" className="text-sm font-medium">
                        Nomes das playlists novas
                      </Label>
                      <Textarea
                        id="new-playlists"
                        placeholder="Uma por linha ou separadas por vírgula"
                        value={playlistsRaw}
                        onChange={(e) => setPlaylistsRaw(e.target.value)}
                        rows={4}
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setStep("review")}>
                      Voltar
                    </Button>
                    <Button className="flex-1" onClick={() => setStep("confirm")}>
                      Continuar
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP CONFIRM */}
          {step === "confirm" && (
            <div className="space-y-3">
              <div className="rounded-lg bg-muted/40 border border-border px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {isBaseline ? "Plays iniciais" : "Plays a registrar"}
                </div>
                <div className="text-2xl font-semibold tabular-nums text-foreground">
                  {hasFinal ? formatPlays(finalValue as number) : "—"}
                </div>
                {!isBaseline && stats && hasFinal && (
                  <div className={cn("text-xs tabular-nums mt-0.5", delta > 0 ? "text-success" : "text-muted-foreground")}>
                    {delta > 0 ? `+${formatPlays(delta)} plays desde o último registro` : "Sem variação desde o último registro"}
                  </div>
                )}
                {(isBaseline || hasNewPlaylists) && parsePlaylistNames(playlistsRaw).length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {parsePlaylistNames(playlistsRaw).length} playlist(s){" "}
                    {isBaseline ? "iniciais" : "novas"}
                  </div>
                )}
              </div>

              {!isBaseline && (
                <div className="space-y-1.5">
                  <Label htmlFor="note">Observação (opcional)</Label>
                  <Input
                    id="note"
                    placeholder="Observação opcional"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={300}
                  />
                </div>
              )}

              <Button
                className="w-full"
                onClick={handleSave}
                disabled={saving || !hasFinal}
              >
                {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                {isBaseline ? "Salvar baseline" : "Salvar registro"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
