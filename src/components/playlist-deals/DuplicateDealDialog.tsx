import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, Music2, Copy as CopyIcon } from "lucide-react";

import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";
import type { CuratorDeal, CuratorDealSong } from "@/lib/curatorDealsUtils";
import { formatNumber } from "@/lib/format";

export interface DuplicateDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceDeal: CuratorDeal | null;
  sourceSongs: CuratorDealSong[];
  onSaved?: () => void | Promise<void>;
}

function parseTitle(raw: string): { title: string; artist: string | null } {
  const parts = raw.split(" - ");
  if (parts.length >= 2) {
    return { title: parts[0].trim(), artist: parts.slice(1).join(" - ").trim() };
  }
  return { title: raw.trim(), artist: null };
}

function extractTrackId(url: string): string | null {
  const m = url.match(/track[/:]([a-zA-Z0-9]{10,})/);
  return m ? m[1] : null;
}

function digitsOnly(v: string) {
  return v.replace(/\D/g, "");
}
function formatBRL(rawDigits: string) {
  if (!rawDigits) return "";
  const cents = parseInt(rawDigits, 10);
  if (Number.isNaN(cents)) return "";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function brlDigitsToNumber(d: string): number | undefined {
  if (!d) return undefined;
  const cents = parseInt(d, 10);
  return Number.isNaN(cents) ? undefined : cents / 100;
}

export function DuplicateDealDialog({
  open,
  onOpenChange,
  sourceDeal,
  sourceSongs,
  onSaved,
}: DuplicateDealDialogProps) {
  const { addDeal } = useCuratorDeals();
  const primary = useMemo(
    () => sourceSongs.find((s) => s.position === 0) ?? sourceSongs[0] ?? null,
    [sourceSongs],
  );

  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<{
    title: string;
    artist: string | null;
    artist_candidates: string[];
    thumbnail_url: string | null;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | undefined>();

  const [dailyGoal, setDailyGoal] = useState("");
  const [durationDays, setDurationDays] = useState("30");
  const [rampUpDays, setRampUpDays] = useState("5");
  const [costDigits, setCostDigits] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset/prefill quando abre
  useEffect(() => {
    if (!open) return;
    setUrl("");
    setMeta(null);
    setSearching(false);
    setSearchError(undefined);
    if (primary) {
      const p = primary as any;
      setDailyGoal(p.daily_goal ? String(p.daily_goal) : "");
      setDurationDays(p.duration_days ? String(p.duration_days) : "30");
      setRampUpDays(p.ramp_up_days != null ? String(p.ramp_up_days) : "5");
    } else {
      setDailyGoal("");
      setDurationDays("30");
      setRampUpDays("5");
    }
    const cost = Number(sourceDeal?.cost ?? 0);
    setCostDigits(cost > 0 ? String(Math.round(cost * 100)) : "");
  }, [open, primary, sourceDeal?.cost]);

  const targetPlays = useMemo(() => {
    const dg = Number(dailyGoal);
    const dd = Number(durationDays);
    if (!Number.isFinite(dg) || !Number.isFinite(dd) || dg <= 0 || dd <= 0) return 0;
    return Math.round(dg * dd);
  }, [dailyGoal, durationDays]);

  const handleSearch = async () => {
    const u = url.trim();
    if (!u) {
      setSearchError("Cole o link do Spotify primeiro");
      return;
    }
    setSearching(true);
    setMeta(null);
    setSearchError(undefined);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-spotify-meta", {
        body: { url: u },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Não foi possível buscar");
      let title: string | null = data.title ?? null;
      let artist: string | null = data.artist ?? null;
      if (!artist && data.raw_title) {
        const p = parseTitle(data.raw_title);
        title = title || p.title;
        artist = p.artist;
      } else if (!artist && title) {
        const p = parseTitle(title);
        title = p.title;
        artist = p.artist;
      }
      if (!artist) {
        setSearchError("Não consegui identificar o artista — tente outro link");
        setSearching(false);
        return;
      }
      const candidates: string[] = Array.isArray(data.artist_candidates)
        ? data.artist_candidates.filter(
            (x: unknown) => typeof x === "string" && (x as string).trim().length > 0,
          )
        : artist
        ? [artist]
        : [];
      setMeta({
        title: title || "Música",
        artist,
        artist_candidates: candidates,
        thumbnail_url: data.thumbnail_url ?? null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSearchError(msg);
      toast.error("Não foi possível buscar a música", { description: msg });
    } finally {
      setSearching(false);
    }
  };

  const canSubmit =
    !!sourceDeal &&
    !!meta &&
    !!url.trim() &&
    targetPlays > 0 &&
    Number(dailyGoal) > 0 &&
    Number(durationDays) > 0;

  const handleSubmit = async (force = false) => {
    if (!sourceDeal || !meta) return;
    setSubmitting(true);
    try {
      const startedAt = new Date().toISOString();
      const endsAt = new Date(
        Date.now() + Number(durationDays) * 86400000,
      ).toISOString();
      const cost = brlDigitsToNumber(costDigits);
      const src = sourceDeal as any;

      const payload = {
        curator_id: sourceDeal.curator_id ?? null,
        curator_name: sourceDeal.curator_name,
        song_spotify_url: url.trim(),
        song_name: meta.title,
        song_artist: meta.artist,
        artist_candidates: meta.artist_candidates,
        song_cover_url: meta.thumbnail_url ?? null,
        target_plays: targetPlays,
        daily_goal: Number(dailyGoal),
        duration_days: Number(durationDays),
        baseline_plays: 0,
        cost: cost ?? null,
        started_at: startedAt,
        ends_at: endsAt,
        ramp_up_days: Number(rampUpDays) || 0,
        billing_model: src.billing_model ?? "per_streams",
        monthly_amount: src.monthly_amount ?? null,
        cycle_months: src.cycle_months ?? null,
      };

      try {
        await addDeal(payload as any, { force });
        toast.success("Deal duplicado", {
          description: `${meta.title} criado para ${sourceDeal.curator_name}`,
        });
        onOpenChange(false);
        await onSaved?.();
      } catch (e: any) {
        if (e?.message === "DUPLICATE_DEAL" && !force) {
          const ok = confirm(
            "Já existe um deal com essa música pra esse curador. Criar mesmo assim?",
          );
          if (ok) {
            await addDeal(payload as any, { force: true });
            toast.success("Deal duplicado");
            onOpenChange(false);
            await onSaved?.();
          }
        } else {
          throw e;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Falha ao duplicar deal", { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CopyIcon className="h-4 w-4" /> Duplicar deal para outra música
          </DialogTitle>
          <DialogDescription>
            {sourceDeal
              ? `Cria um deal novo para ${sourceDeal.curator_name} com os mesmos parâmetros, mudando só a música.`
              : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 text-[12.5px]">
            <div className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold mb-1">
              Curador
            </div>
            <div className="font-medium">{sourceDeal?.curator_name}</div>
            <div className="text-muted-foreground mt-0.5 text-[11.5px]">
              Modelo: {(sourceDeal as any)?.billing_model === "monthly_retainer" ? "Mensal" : "Por streams"}
              {primary ? ` · Origem: ${primary.song_name}` : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Link da música no Spotify</Label>
            <div className="flex gap-2">
              <Input
                placeholder="https://open.spotify.com/track/…"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setMeta(null);
                  setSearchError(undefined);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
                className="h-9"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSearch}
                disabled={searching || !url.trim()}
                className="h-9 shrink-0"
              >
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Buscar
              </Button>
            </div>
            {searchError && (
              <div className="text-[11.5px] text-destructive">{searchError}</div>
            )}
            {meta && (
              <div className="mt-2 rounded-xl border border-border/60 bg-card/50 p-2.5 flex items-center gap-3">
                {meta.thumbnail_url ? (
                  <img
                    src={meta.thumbnail_url}
                    alt=""
                    className="h-12 w-12 rounded-md object-cover"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-md bg-muted flex items-center justify-center">
                    <Music2 className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{meta.title}</div>
                  <div className="text-[12px] text-muted-foreground truncate">
                    {meta.artist}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Meta diária</Label>
              <Input
                value={dailyGoal}
                onChange={(e) => setDailyGoal(digitsOnly(e.target.value))}
                placeholder="0"
                inputMode="numeric"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Duração (dias)</Label>
              <Input
                value={durationDays}
                onChange={(e) => setDurationDays(digitsOnly(e.target.value))}
                placeholder="30"
                inputMode="numeric"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ramp-up (dias)</Label>
              <Input
                value={rampUpDays}
                onChange={(e) => setRampUpDays(digitsOnly(e.target.value))}
                placeholder="5"
                inputMode="numeric"
                className="h-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Custo (R$) — opcional</Label>
            <Input
              value={formatBRL(costDigits)}
              onChange={(e) => setCostDigits(digitsOnly(e.target.value))}
              placeholder="R$ 0,00"
              inputMode="numeric"
              className="h-9"
            />
          </div>

          <div className="rounded-xl bg-primary/5 border border-primary/20 px-3 py-2 text-[12.5px] flex items-center justify-between">
            <span className="text-muted-foreground">Meta total estimada</span>
            <span className="font-semibold text-primary">
              {targetPlays > 0 ? formatNumber(targetPlays) : "—"} plays
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => handleSubmit(false)}
            disabled={!canSubmit || submitting}
            className="gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Criar deal duplicado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
