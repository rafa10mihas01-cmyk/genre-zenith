// useTrackPresence — dada uma música (spotify_track_id), retorna em quais das
// suas managed_playlists ativas a música está, em que posição, e quais playlists
// ativas NÃO têm a música. Fonte: managed_playlist_tracks (snapshot atualizado
// periodicamente pelo coletor).
//
// Status por playlist:
//   top    → position <= 5
//   middle → 6 <= position <= 10
//   tail   → position > 10
//   absent → não está na playlist
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errors";

export type TrackPresenceStatus = "top" | "middle" | "tail" | "absent";

export type TrackPresenceRow = {
  playlist_id: string;
  playlist_name: string;
  followers: number | null;
  genre_id: string | null;
  genre_name: string | null;
  lifecycle_phase: string | null;
  position: number | null; // null quando absent
  added_at: string | null;
  snapshot_at: string | null;
  status: TrackPresenceStatus;
};

function classify(position: number | null | undefined): TrackPresenceStatus {
  if (position == null) return "absent";
  if (position <= 5) return "top";
  if (position <= 10) return "middle";
  return "tail";
}

export function useTrackPresence(spotifyTrackId: string | null | undefined) {
  const [rows, setRows] = useState<TrackPresenceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = (spotifyTrackId ?? "").trim();
    if (!id) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // 1) Todas as managed_playlists ativas.
        const { data: playlists, error: plErr } = await supabase
          .from("managed_playlists")
          .select("id, name, followers, genre_id, lifecycle_phase")
          .is("archived_at", null)
          .limit(2000);
        if (plErr) throw plErr;
        // 2) Onde a track aparece (latest snapshot por playlist).
        const { data: tracks, error: tErr } = await supabase
          .from("managed_playlist_tracks")
          .select("playlist_id, position, added_at, snapshot_at")
          .eq("spotify_track_id", id)
          .limit(2000);
        if (tErr) throw tErr;

        // 3) Gêneros (sem FK no PostgREST → busca separada).
        const genreIds = Array.from(
          new Set((playlists ?? []).map((p) => p.genre_id).filter(Boolean)),
        );
        const genreMap = new Map<string, string>();
        if (genreIds.length > 0) {
          const { data: genres, error: gErr } = await supabase
            .from("genres")
            .select("id, nome")
            .in("id", genreIds as string[]);
          if (gErr) throw gErr;
          for (const g of (genres ?? []) as any[]) genreMap.set(g.id, g.nome);
        }

        if (cancelled) return;

        const byPlaylist = new Map<
          string,
          { position: number; added_at: string | null; snapshot_at: string | null }
        >();
        for (const t of (tracks ?? []) as any[]) {
          const prev = byPlaylist.get(t.playlist_id);
          const snapAt = t.snapshot_at ?? null;
          if (!prev || (snapAt && (!prev.snapshot_at || snapAt > prev.snapshot_at))) {
            byPlaylist.set(t.playlist_id, {
              position: Number(t.position),
              added_at: t.added_at ?? null,
              snapshot_at: snapAt,
            });
          }
        }

        const out: TrackPresenceRow[] = (playlists ?? []).map((p) => {
          const hit = byPlaylist.get(p.id);
          return {
            playlist_id: p.id,
            playlist_name: p.name,
            followers: p.followers ?? null,
            genre_id: p.genre_id ?? null,
            genre_name: p.genre_id ? genreMap.get(p.genre_id) ?? null : null,
            lifecycle_phase: p.lifecycle_phase ?? null,
            position: hit?.position ?? null,
            added_at: hit?.added_at ?? null,
            snapshot_at: hit?.snapshot_at ?? null,
            status: classify(hit?.position),
          };
        });

        out.sort((a, b) => {
          if (a.position != null && b.position != null) return a.position - b.position;
          if (a.position != null) return -1;
          if (b.position != null) return 1;
          return (b.followers ?? 0) - (a.followers ?? 0);
        });

        setRows(out);
      } catch (e: unknown) {
        if (!cancelled) {
          const msg =
            getErrorMessage(e) ||
            e?.error_description ||
            e?.hint ||
            e?.details ||
            (typeof e === "string" ? e : JSON.stringify(e));
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spotifyTrackId]);

  const summary = useMemo(() => {
    const total = rows.length;
    const present = rows.filter((r) => r.status !== "absent").length;
    const top = rows.filter((r) => r.status === "top").length;
    const middle = rows.filter((r) => r.status === "middle").length;
    const tail = rows.filter((r) => r.status === "tail").length;
    const absent = total - present;
    return { total, present, absent, top, middle, tail };
  }, [rows]);

  return { rows, summary, loading, error };
}

export function extractSpotifyTrackId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/track[/:]([a-zA-Z0-9]{16,})/);
  return m ? m[1] : null;
}
