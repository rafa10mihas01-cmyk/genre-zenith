import { useEffect, useMemo, useState } from "react";
import { Loader2, ListMusic, ExternalLink, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

type DealPlaylist = {
  id: string;
  spotify_playlist_id?: string | null;
  spotify_url?: string | null;
  playlist_name?: string | null;
  image_url?: string | null;
  followers?: number | null;
  match_status?: string | null;
  song_id?: string | null;
  is_initial_roster?: boolean | null;
};

type Song = {
  id: string;
  song_name: string;
  song_artist: string | null;
  song_cover_url: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  song: Song | null;
  publicToken: string;
  /** todas as playlists do deal (qualquer música, qualquer status) */
  allPlaylists: DealPlaylist[];
  onAdded: () => void | Promise<void>;
}

export function AddSongToPlaylistDialog({
  open,
  onOpenChange,
  song,
  publicToken,
  allPlaylists,
  onAdded,
}: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [position, setPosition] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedKey(null);
      setPosition("");
      setSubmitting(false);
    }
  }, [open]);

  // Playlists do deal disponíveis pra vincular novas músicas — qualquer uma que
  // NÃO seja baseline real (is_initial_roster=true). Independe de match_status:
  // organic, curator, suspicious, todas valem. Só baseline real bloqueia.
  const options = useMemo(() => {
    const seen = new Map<string, DealPlaylist>();
    for (const p of allPlaylists) {
      if (p.is_initial_roster === true) continue;
      const key = p.spotify_playlist_id || p.spotify_url || p.id;
      if (!key) continue;
      if (!seen.has(key)) seen.set(key, p);
    }
    return Array.from(seen.entries()).map(([key, p]) => ({ key, p }));
  }, [allPlaylists]);

  // Playlists em que essa música JÁ está
  const alreadyInKeys = useMemo(() => {
    if (!song) return new Set<string>();
    const set = new Set<string>();
    for (const p of allPlaylists) {
      if (p.song_id !== song.id) continue;
      const key = p.spotify_playlist_id || p.spotify_url || p.id;
      if (key) set.add(key);
    }
    return set;
  }, [allPlaylists, song]);

  const handleSubmit = async () => {
    if (!song || !selectedKey) return;
    const opt = options.find((o) => o.key === selectedKey);
    if (!opt) return;
    const url =
      opt.p.spotify_url ||
      (opt.p.spotify_playlist_id
        ? `https://open.spotify.com/playlist/${opt.p.spotify_playlist_id}`
        : null);
    if (!url) {
      toast.error("Playlist sem link válido");
      return;
    }
    const parsedPosition = position.trim() === "" ? null : Number(position.trim());
    if (
      parsedPosition !== null &&
      (!Number.isFinite(parsedPosition) || parsedPosition < 1 || !Number.isInteger(parsedPosition))
    ) {
      toast.error("Posição deve ser um número inteiro maior que zero");
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke(
      "register-curator-playlist",
      {
        body: {
          public_token: publicToken,
          urls: [url],
          song_id: song.id,
          position: parsedPosition,
          require_track_present: true,
        },
      },
    );
    setSubmitting(false);

    if (error || !data?.ok) {
      toast.error(data?.error || error?.message || "Erro ao registrar");
      return;
    }
    const item = Array.isArray(data.items) ? data.items[0] : null;
    if (!item) {
      toast.error("Resposta inválida do servidor");
      return;
    }
    if (item.status === "duplicate") {
      toast.warning("Essa música já está registrada nessa playlist");
      return;
    }
    if (item.status === "track_not_present") {
      toast.error("Música não está nessa playlist", {
        description:
          "Adiciona a faixa no Spotify primeiro e tenta de novo. Sem ela dentro, não dá pra registrar.",
      });
      return;
    }
    if (item.status === "not_found") {
      toast.error("Playlist não encontrada no Spotify");
      return;
    }
    if (item.status === "timeout" || item.status === "error") {
      toast.error("Spotify demorou pra responder. Tenta de novo.");
      return;
    }
    if (item.status !== "ok") {
      toast.error("Não foi possível registrar");
      return;
    }
    toast.success("Música vinculada à playlist");
    await onAdded();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListMusic className="h-4 w-4 text-primary" />
            Adicionar em playlist existente
          </DialogTitle>
          <DialogDescription>
            {song
              ? `Escolha em qual das suas playlists do deal você já adicionou "${song.song_name}".`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {song && (
          <div className="flex items-center gap-3 nx-subcard p-3">
            {song.song_cover_url ? (
              <img
                src={song.song_cover_url}
                alt={song.song_name}
                className="w-10 h-10 rounded-md object-cover ring-1 ring-border"
              />
            ) : (
              <div className="w-10 h-10 rounded-md bg-muted" />
            )}
            <div className="min-w-0">
              <div className="text-[13px] font-semibold leading-tight truncate">
                {song.song_name}
              </div>
              {song.song_artist && (
                <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {song.song_artist}
                </div>
              )}
            </div>
          </div>
        )}

        {options.length === 0 ? (
          <div className="nx-subcard p-4 text-center">
            <p className="text-[13px] text-muted-foreground">
              Você ainda não cadastrou nenhuma playlist nesse deal.
              <br />
              Cole o link de uma playlist primeiro.
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1 -mr-1">
            {options.map(({ key, p }) => {
              const isSelected = selectedKey === key;
              const already = alreadyInKeys.has(key);
              return (
                <li key={key}>
                  <button
                    type="button"
                    disabled={already}
                    onClick={() => setSelectedKey(key)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 rounded-lg transition-all border",
                      already
                        ? "border-border/50 bg-muted/20 opacity-60 cursor-not-allowed"
                        : isSelected
                        ? "border-primary/50 bg-primary/5 ring-1 ring-primary/40"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt=""
                          className="w-9 h-9 rounded-md object-cover ring-1 ring-border shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-md bg-muted shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium leading-tight truncate">
                          {p.playlist_name || "Playlist"}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
                          {typeof p.followers === "number" && (
                            <span>{p.followers.toLocaleString("pt-BR")} seguidores</span>
                          )}
                          {already && (
                            <span className="inline-flex items-center gap-1 text-primary">
                              <CheckCircle2 className="h-3 w-3" /> já vinculada
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {options.length > 0 && (
          <div className="space-y-2">
            <label className="text-[12px] font-medium text-muted-foreground">
              Posição na playlist (opcional)
            </label>
            <Input
              type="number"
              min={1}
              step={1}
              placeholder="Ex.: 3"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              disabled={submitting || !selectedKey}
            />
            <p className="text-[11px] text-muted-foreground">
              Vou conferir no Spotify se a música está mesmo dentro. Se não tiver, bloqueio.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !selectedKey || options.length === 0}
            className="gap-2"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Confirmar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
