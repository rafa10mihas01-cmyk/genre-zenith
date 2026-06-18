// Lê o ecossistema VIVO direto do banco — usado pelo painel Capacidade.
// Zero cache, zero recálculo paralelo. Sempre que a página abre, busca o estado atual.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { EcoPlaylist } from "@/lib/ecosystemCapacity";
import { getErrorMessage } from "@/lib/errors";

export type GenreRow = { id: string; nome: string };

export type AffinityRow = {
  genre_a_id: string;
  genre_b_id: string;
  score: number;
  genre_a?: string;
  genre_b?: string;
};

export type EcosystemSnapshot = {
  loading: boolean;
  error: string | null;
  playlists: EcoPlaylist[];
  genres: Map<string, GenreRow>;
  affinities: AffinityRow[];
};

export function useEcosystemSnapshot(): EcosystemSnapshot {
  const [state, setState] = useState<EcosystemSnapshot>({
    loading: true, error: null, playlists: [], genres: new Map(), affinities: [],
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [plRes, gRes, aRes] = await Promise.all([
          supabase
            .from("managed_playlists")
            .select("id,name,followers,genre_id")
            .is("archived_at", null)
            .limit(5000),
          supabase.from("genres").select("id,nome").limit(500),
          supabase
            .from("genre_affinities")
            .select("genre_a_id,genre_b_id,score")
            .gte("score", 0.6)
            .order("score", { ascending: false })
            .limit(50),
        ]);
        if (cancelled) return;
        if (plRes.error) throw plRes.error;
        if (gRes.error)  throw gRes.error;
        if (aRes.error)  throw aRes.error;

        const genres = new Map<string, GenreRow>();
        (gRes.data ?? []).forEach((g) => genres.set(g.id, g as GenreRow));

        const aff = (aRes.data ?? []).map((r: any) => ({
          genre_a_id: r.genre_a_id,
          genre_b_id: r.genre_b_id,
          score: Number(r.score),
          genre_a: genres.get(r.genre_a_id)?.nome,
          genre_b: genres.get(r.genre_b_id)?.nome,
        })) as AffinityRow[];

        const playlists = ((plRes.data ?? []) as any[]).map((p) => ({
          id: p.id,
          name: p.name ?? "",
          followers: Number(p.followers ?? 0),
          genre_id: p.genre_id ?? null,
        })) as EcoPlaylist[];

        setState({ loading: false, error: null, playlists, genres, affinities: aff });
      } catch (e: unknown) {
        if (!cancelled) setState({ loading: false, error: getErrorMessage(e) ?? "erro", playlists: [], genres: new Map(), affinities: [] });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}

export type HistoryPoint = {
  month: string;       // YYYY-MM
  playlists: number;   // playlists distintas com snapshot no mês
  savesTotal: number;  // soma dos últimos followers do mês por playlist
};

export function useEcosystemHistory(monthsBack = 12) {
  const [state, setState] = useState<{ loading: boolean; series: HistoryPoint[] }>({
    loading: true, series: [],
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const since = new Date();
      since.setMonth(since.getMonth() - monthsBack);
      since.setDate(1);
      const { data, error } = await supabase
        .from("playlist_followers_snapshots")
        .select("playlist_spotify_id,followers,captured_at")
        .gte("captured_at", since.toISOString())
        .order("captured_at", { ascending: true })
        .limit(50000);
      if (cancelled) return;
      if (error || !data) {
        setState({ loading: false, series: [] });
        return;
      }

      // por mês: pra cada playlist, manter o ÚLTIMO followers no mês
      const byMonth = new Map<string, Map<string, number>>();
      for (const r of data as any[]) {
        const d = new Date(r.captured_at as string);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        if (!byMonth.has(key)) byMonth.set(key, new Map());
        byMonth.get(key)!.set(r.playlist_spotify_id as string, Number(r.followers ?? 0));
      }
      const series: HistoryPoint[] = Array.from(byMonth.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, m]) => ({
          month,
          playlists: m.size,
          savesTotal: Array.from(m.values()).reduce((s, v) => s + v, 0),
        }));
      setState({ loading: false, series });
    })();
    return () => { cancelled = true; };
  }, [monthsBack]);

  return state;
}
