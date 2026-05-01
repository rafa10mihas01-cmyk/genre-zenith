import { useRef, useState } from "react";
import { ImagePlus, Loader2, Sparkles, CheckCircle2, AlertCircle, X, Info, FileText, FileImage, ClipboardPaste } from "lucide-react";
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
import { buildDealPdf, uploadDealPdf, type ParsedDealData } from "@/lib/dealPdf";

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

const MAX_FILES = 40;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

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
    printUrls?: string[],
  ) => Promise<void>;
  addNewPlaylist?: (
    dealId: string,
    spotifyUrl: string,
    playlistName: string,
  ) => Promise<void>;
}

type PrintItem = {
  file: File;
  url: string;
};

type Match = {
  playlist_name: string;
  plays: number | null;
  found: boolean;
  source_index: number | null;
};

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

function extractSpotifyPlaylistIdLocal(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/playlist[/:]([a-zA-Z0-9]{16,})/);
  return m ? m[1] : null;
}

function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
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
  const [mode, setMode] = useState<"image" | "paste">("image");
  const [step, setStep] = useState<Step>("upload");
  const [items, setItems] = useState<PrintItem[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [extracted, setExtracted] = useState<number | null>(null);
  const [manualValue, setManualValue] = useState<string>("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Paste mode
  const [pasteText, setPasteText] = useState<string>("");
  const [parsedPaste, setParsedPaste] = useState<ParsedDealData | null>(null);

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
    items.forEach((it) => URL.revokeObjectURL(it.url));
    setItems([]);
    setMatches([]);
    setExtracted(null);
    setManualValue("");
    setAiError(null);
    setNote("");
    setSaving(false);
    setPlaylistsRaw("");
    setHasNewPlaylists(false);
    setMode("image");
    setPasteText("");
    setParsedPaste(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handlePickFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const incoming = Array.from(files);
    const remaining = MAX_FILES - items.length;
    if (remaining <= 0) {
      toast.error(`Máximo de ${MAX_FILES} prints por envio`);
      return;
    }
    const accepted: PrintItem[] = [];
    let rejectedType = 0;
    let rejectedSize = 0;
    for (const f of incoming.slice(0, remaining)) {
      if (!f.type.startsWith("image/")) { rejectedType++; continue; }
      if (f.size > MAX_FILE_BYTES) { rejectedSize++; continue; }
      accepted.push({ file: f, url: URL.createObjectURL(f) });
    }
    if (accepted.length > 0) {
      setItems((prev) => [...prev, ...accepted]);
    }
    if (rejectedType > 0) toast.error(`${rejectedType} arquivo(s) ignorado(s) — não é imagem`);
    if (rejectedSize > 0) toast.error(`${rejectedSize} arquivo(s) acima de 10MB`);
    if (incoming.length > remaining) {
      toast.message(`Limite de ${MAX_FILES} prints atingido`, {
        description: `${incoming.length - remaining} arquivo(s) não foram adicionados`,
      });
    }
    setExtracted(null);
    setMatches([]);
    setAiError(null);
    setManualValue("");
  };

  const removeItem = (idx: number) => {
    setItems((prev) => {
      const it = prev[idx];
      if (it) URL.revokeObjectURL(it.url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleAnalyze = async () => {
    if (!deal || items.length === 0) return;
    setStep("analyzing");
    setAiError(null);
    try {
      const images = await Promise.all(
        items.map(async (it) => ({
          base64: await fileToBase64(it.file),
          mime_type: it.file.type,
        })),
      );

      const dealPlaylists = allPlaylists.filter((p) => p.deal_id === deal.id);
      const playlistNames = dealPlaylists.map((p) => p.playlist_name);

      const { data, error } = await supabase.functions.invoke("analyze-deal-prints", {
        body: {
          images,
          playlists: playlistNames,
          mode: isBaseline ? "baseline" : "update",
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) {
        setAiError(data?.error ?? "Falha ao analisar imagens");
        setStep("review");
        return;
      }
      const m: Match[] = Array.isArray(data.matches) ? data.matches : [];
      setMatches(m);
      const total = Number(data.total_plays ?? 0);
      setExtracted(Number.isFinite(total) && total > 0 ? total : null);
      setStep("review");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiError(msg);
      setStep("review");
    }
  };

  const handleConfirmCount = () => setStep("playlists");

  const handleCorrect = () => {
    setManualValue(extracted != null ? String(extracted) : "");
    setExtracted(null);
  };

  const handleAnalyzePaste = async () => {
    if (!deal || pasteText.trim().length < 5) {
      toast.error("Cole o texto antes de analisar");
      return;
    }
    setStep("analyzing");
    setAiError(null);
    try {
      const { data, error } = await supabase.functions.invoke("parse-deal-paste", {
        body: { text: pasteText },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) {
        setAiError(data?.error ?? "Falha ao processar texto");
        setStep("review");
        return;
      }
      const parsed: ParsedDealData = {
        song_name: data.song_name ?? null,
        song_artist: data.song_artist ?? null,
        total_plays: data.total_plays ?? null,
        playlists: Array.isArray(data.playlists) ? data.playlists : [],
      };
      setParsedPaste(parsed);
      // Alimenta os mesmos campos usados no review/save
      const m: Match[] = parsed.playlists.map((p, i) => ({
        playlist_name: p.name,
        plays: p.plays,
        found: p.plays !== null,
        source_index: i,
      }));
      setMatches(m);
      const total = parsed.total_plays;
      setExtracted(Number.isFinite(total ?? NaN) && (total ?? 0) > 0 ? (total as number) : null);
      setStep("review");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiError(msg);
      setStep("review");
    }
  };

  const uploadPrintsToStorage = async (): Promise<string[]> => {
    if (!deal) return [];
    const urls: string[] = [];

    // Modo paste: gera PDF a partir do texto estruturado
    if (mode === "paste" && parsedPaste) {
      const blob = buildDealPdf(parsedPaste, {
        dealId: deal.id,
        curatorName: deal.curator_name,
        songFallbackName: deal.song_name,
        isBaseline,
      });
      const url = await uploadDealPdf(blob, deal.id);
      urls.push(url);
      return urls;
    }

    // Modo image: upload das imagens
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const ext = (it.file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${deal.id}/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("deal-prints")
        .upload(path, it.file, {
          contentType: it.file.type || "image/jpeg",
          upsert: false,
        });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("deal-prints").getPublicUrl(path);
      urls.push(pub.publicUrl);
    }
    return urls;
  };

  const handleSave = async () => {
    if (!deal || !hasFinal) return;
    setSaving(true);
    try {
      const printUrls = await uploadPrintsToStorage();

      if (isBaseline) {
        const names = parsePlaylistNames(playlistsRaw);
        // Modo paste: usa playlists vindas da IA com link do Spotify (chave de identidade)
        const fromPaste: BaselinePlaylistInput[] = (parsedPaste?.playlists ?? [])
          .filter((p) => p.name)
          .map((p) => ({
            spotify_url: p.spotify_url ?? "",
            playlist_name: p.name,
            followers: null,
          }));
        const fromAi: BaselinePlaylistInput[] = matches
          .filter((m) => m.playlist_name)
          .map((m) => ({
            spotify_url: "",
            playlist_name: m.playlist_name,
            followers: null,
          }));
        const fromManual: BaselinePlaylistInput[] = names.map((name) => ({
          spotify_url: "",
          playlist_name: name,
          followers: null,
        }));
        const baselinePlaylists =
          fromPaste.length > 0 ? fromPaste : fromAi.length > 0 ? fromAi : fromManual;
        await addBaseline(deal.id, finalValue as number, baselinePlaylists, printUrls);
        toast.success("Baseline registrada", {
          description: `${formatPlays(finalValue as number)} plays · ${baselinePlaylists.length} playlist(s) iniciais · ${printUrls.length} print(s)`,
        });
      } else {
        await addLog({
          deal_id: deal.id,
          total_plays: finalValue as number,
          note: note.trim() || null,
          print_urls: printUrls,
        });

        // Detecta playlists NOVAS pelo link do Spotify (chave de identidade).
        // Em modo paste: cruza spotify_id contra as playlists já cadastradas do deal.
        const dealPlaylists = allPlaylists.filter((p) => p.deal_id === deal.id);
        const knownIds = new Set(
          dealPlaylists
            .map((p) => extractSpotifyPlaylistIdLocal(p.spotify_url))
            .filter((x): x is string => !!x),
        );
        const knownNames = new Set(
          dealPlaylists.map((p) => normalizeName(p.playlist_name)),
        );

        const autoNewFromPaste = (parsedPaste?.playlists ?? []).filter((p) => {
          const id = extractSpotifyPlaylistIdLocal(p.spotify_url);
          if (id) return !knownIds.has(id);
          // sem link: cai no nome normalizado
          return !knownNames.has(normalizeName(p.name));
        });

        if (autoNewFromPaste.length > 0) {
          const rows = autoNewFromPaste.map((p) => ({
            deal_id: deal.id,
            spotify_url: p.spotify_url ?? "",
            playlist_name: p.name,
            followers: null,
            is_baseline: false,
          }));
          const { error: plErr } = await supabase
            .from("curator_playlists")
            .insert(rows);
          if (plErr) throw plErr;
        } else if (hasNewPlaylists) {
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
            ? `+${formatPlays(Math.max(0, delta))} plays · ${printUrls.length} print(s) anexado(s)`
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

  const foundCount = matches.filter((m) => m.found).length;
  const notFound = matches.filter((m) => !m.found);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
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
                Primeiro passo: envie os prints iniciais
              </div>
              <div className="text-xs text-muted-foreground leading-snug">
                Esses prints definem o estado inicial — playlists existentes e plays atuais — antes do deal começar.
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
              {/* Seletor de modo */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-muted/30 rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setMode("image")}
                  className={cn(
                    "h-9 rounded-md text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors",
                    mode === "image"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <FileImage className="h-3.5 w-3.5" /> Print
                </button>
                <button
                  type="button"
                  onClick={() => setMode("paste")}
                  className={cn(
                    "h-9 rounded-md text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors",
                    mode === "paste"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <ClipboardPaste className="h-3.5 w-3.5" /> Colar texto
                </button>
              </div>

              {/* MODO IMAGEM */}
              {mode === "image" && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      handlePickFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  {items.length === 0 ? (
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
                      <div className="text-sm font-medium text-foreground">Toque para enviar os prints</div>
                      <div className="text-xs text-muted-foreground">
                        Até {MAX_FILES} imagens · Spotify for Artists
                      </div>
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-2">
                        {items.map((it, idx) => (
                          <div key={idx} className="relative">
                            <img
                              src={it.url}
                              alt={`Print ${idx + 1}`}
                              className="w-full aspect-square object-cover rounded-md border border-border"
                            />
                            <button
                              type="button"
                              onClick={() => removeItem(idx)}
                              className="absolute top-1 right-1 h-6 w-6 rounded-full bg-background/90 border border-border flex items-center justify-center hover:bg-background"
                              aria-label="Remover imagem"
                            >
                              <X className="h-3 w-3" />
                            </button>
                            <div className="absolute bottom-1 left-1 h-5 px-1.5 rounded bg-background/80 border border-border text-[10px] tabular-nums flex items-center">
                              {idx + 1}
                            </div>
                          </div>
                        ))}
                        {items.length < MAX_FILES && (
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="aspect-square rounded-md border-2 border-dashed border-border bg-elevated/40 hover:bg-elevated flex flex-col items-center justify-center gap-1 text-muted-foreground"
                          >
                            <ImagePlus className="h-4 w-4" />
                            <span className="text-[10px]">Adicionar</span>
                          </button>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground text-center">
                        {items.length} / {MAX_FILES} prints
                      </div>
                      <Button className="w-full gap-1.5" onClick={handleAnalyze}>
                        <Sparkles className="h-4 w-4" />
                        {isBaseline
                          ? "Analisar prints iniciais"
                          : "Analisar e casar com playlists"}
                      </Button>
                    </div>
                  )}
                </>
              )}

              {/* MODO PASTE */}
              {mode === "paste" && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex gap-2">
                    <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="text-[11px] text-muted-foreground leading-snug">
                      Cole o conteúdo direto do Spotify for Artists (playlists, plays, total). A IA limpa o lixo, organiza os números e gera um PDF que fica anexado ao registro.
                    </div>
                  </div>
                  <Textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="Cole aqui o texto bruto — pode estar bagunçado, com cabeçalhos, emojis, etc."
                    className="min-h-[180px] font-mono text-xs"
                  />
                  <div className="text-[11px] text-muted-foreground text-right">
                    {pasteText.length.toLocaleString("pt-BR")} caracteres
                  </div>
                  <Button
                    className="w-full gap-1.5"
                    onClick={handleAnalyzePaste}
                    disabled={pasteText.trim().length < 5}
                  >
                    <Sparkles className="h-4 w-4" />
                    Estruturar com IA e gerar PDF
                  </Button>
                </div>
              )}
            </>
          )}

          {/* STEP ANALYZING */}
          {step === "analyzing" && (
            <div className="py-8 flex flex-col items-center gap-3 text-center">
              <Loader2 className="h-6 w-6 text-primary animate-spin" />
              <div className="text-sm font-medium">
                {mode === "paste"
                  ? "Estruturando texto com IA..."
                  : `Lendo ${items.length} print${items.length === 1 ? "" : "s"} com IA...`}
              </div>
              <div className="text-xs text-muted-foreground">
                {mode === "paste"
                  ? "Limpando lixo, identificando playlists e plays"
                  : isBaseline
                  ? "Identificando playlists e plays iniciais"
                  : "Casando cada playlist do deal com os prints"}
              </div>
            </div>
          )}

          {/* STEP REVIEW */}
          {step === "review" && (
            <div className="space-y-3">
              {extracted != null ? (
                <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2 text-xs text-success font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Total detectado
                  </div>
                  <div className="text-2xl font-semibold tabular-nums text-foreground">
                    {formatPlays(extracted)}
                  </div>
                  {matches.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Soma de {foundCount} playlist{foundCount === 1 ? "" : "s"} encontrada{foundCount === 1 ? "" : "s"}
                      {notFound.length > 0 && ` · ${notFound.length} não encontrada(s)`}
                    </div>
                  )}
                  {!isBaseline && stats && (
                    <div className={cn("text-xs tabular-nums", delta > 0 ? "text-success" : "text-muted-foreground")}>
                      {delta > 0 ? `+${formatPlays(delta)} plays desde o último registro` : "Sem variação desde o último registro"}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-destructive font-medium">
                    <AlertCircle className="h-3.5 w-3.5" /> {aiError ?? "Não foi possível ler os prints"}
                  </div>
                  <div className="text-xs text-muted-foreground">Digite o total manualmente:</div>
                </div>
              )}

              {/* Detalhes por playlist */}
              {matches.length > 0 && (
                <div className="rounded-lg border border-border bg-muted/30 max-h-56 overflow-y-auto divide-y divide-border">
                  {matches.map((m, i) => (
                    <div key={i} className="px-3 py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{m.playlist_name}</div>
                        {!m.found && (
                          <div className="text-[10px] text-muted-foreground">
                            Não encontrada nos prints
                          </div>
                        )}
                      </div>
                      <div className={cn(
                        "text-sm font-semibold tabular-nums shrink-0",
                        m.found ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {m.found && m.plays != null ? formatPlays(m.plays) : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {extracted == null && (
                <div className="space-y-1.5">
                  <Label htmlFor="manual-count">Valor total manual</Label>
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
                  {matches.length > 0 ? (
                    <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3">
                      <div className="text-xs text-success font-medium mb-1">
                        Playlists detectadas pela IA
                      </div>
                      <div className="text-xs text-muted-foreground leading-snug">
                        {matches.length} playlist(s) serão registradas como baseline.
                        Você pode adicionar outras manualmente abaixo se faltou alguma.
                      </div>
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="baseline-playlists" className="text-sm font-medium">
                      Playlists adicionais (opcional)
                    </Label>
                    <Textarea
                      id="baseline-playlists"
                      placeholder="Cole nomes de playlists que a IA não pegou"
                      value={playlistsRaw}
                      onChange={(e) => setPlaylistsRaw(e.target.value)}
                      rows={4}
                    />
                    <p className="text-xs text-muted-foreground leading-snug">
                      Uma por linha ou separadas por vírgula.
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
                        Apareceu alguma playlist nova nestes prints?
                      </div>
                      <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                        Que ainda não está cadastrada no deal
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
                  {isBaseline ? "Plays iniciais (total)" : "Plays a registrar (total)"}
                </div>
                <div className="text-2xl font-semibold tabular-nums text-foreground">
                  {hasFinal ? formatPlays(finalValue as number) : "—"}
                </div>
                {!isBaseline && stats && hasFinal && (
                  <div className={cn("text-xs tabular-nums mt-0.5", delta > 0 ? "text-success" : "text-muted-foreground")}>
                    {delta > 0 ? `+${formatPlays(delta)} plays desde o último registro` : "Sem variação desde o último registro"}
                  </div>
                )}
                {isBaseline && matches.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {matches.length} playlist(s) detectada(s) pela IA
                    {parsePlaylistNames(playlistsRaw).length > 0 &&
                      ` · +${parsePlaylistNames(playlistsRaw).length} manual(is)`}
                  </div>
                )}
                {!isBaseline && hasNewPlaylists && parsePlaylistNames(playlistsRaw).length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {parsePlaylistNames(playlistsRaw).length} playlist(s) novas
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
