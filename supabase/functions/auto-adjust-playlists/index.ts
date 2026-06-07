// auto-adjust-playlists — corrige automaticamente playlists com baixa performance.
// Seleciona templates com performance_class='baixa' e idade > 48h, então:
//   1) Renomeia (inclui ano + subgênero quando disponível)
//   2) Reordena tracks (shuffle determinístico)
//   3) Substitui ~20% das tracks por novas seeds do mesmo gênero
// Cada ação é registrada em playlist_adjustments.
//
// POST { dry_run?: boolean, limit?: number, min_age_hours?: number }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserAccessToken, guardedSpotifyFetch } from "../_shared/spotify.ts";
import { requireTeamAccess } from "../_shared/auth.ts";
import {
  addPlaylistTracks,
  listPlaylistTrackUris,
  replacePlaylistTracks,
  setPlaylistDetails,
} from "../_shared/spotify-playlist.ts";
import { getProtectedTracksForPlaylist, logProtectedBlock } from "../_shared/protected-tracks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Candidate = {
  template_id: string;
  genre_id: string;
  spotify_playlist_id: string;
  spotify_url: string | null;
  name: string;
  performance_class: string;
  created_on_spotify_at: string;
  tempo_horas: number;
};

// ─────────── Spotify helpers ───────────
async function spotifyFetch(token: string, url: string, init?: RequestInit) {
  const r = await guardedSpotifyFetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return r;
}

async function getPlaylistTracks(token: string, playlistId: string): Promise<string[]> {
  try {
    const uris = await listPlaylistTrackUris(playlistId, token);
    return uris.filter((u) => u.startsWith("spotify:track:"));
  } catch {
    return [];
  }
}

async function searchTrackUri(token: string, nome: string, artista: string): Promise<string | null> {
  const q = `track:${nome} artist:${artista}`;
  const url = `https://api.spotify.com/v1/search?type=track&limit=1&q=${encodeURIComponent(q)}`;
  const r = await spotifyFetch(token, url);
  if (!r.ok) return null;
  const j = await r.json();
  return j?.tracks?.items?.[0]?.uri ?? null;
}

async function changePlaylistDetails(token: string, playlistId: string, name: string) {
  try {
    await setPlaylistDetails(playlistId, { name }, token);
    return true;
  } catch {
    return false;
  }
}

async function replaceTracks(token: string, playlistId: string, uris: string[]) {
  // Spotify aceita até 100 por chamada no PUT (replace). Append do restante via POST.
  try {
    const first = uris.slice(0, 100);
    await replacePlaylistTracks(playlistId, first, token);
    if (uris.length > 100) {
      const rest = uris.slice(100);
      await addPlaylistTracks(playlistId, rest, token);
    }
    return true;
  } catch {
    return false;
  }
}

// ─────────── Lógica de transformação ───────────
function shuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildNewName(oldName: string, subgenero: string | null): string {
  const year = new Date().getFullYear();
  const cleaned = oldName.replace(/\s*\b(20\d{2})\b\s*/g, " ").trim();
  const subPart = subgenero ? ` ${subgenero}` : "";
  // mantém curto e natural
  const base = `${cleaned}${subPart} ${year}`.replace(/\s+/g, " ").trim();
  return base.slice(0, 90);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  let body: { dry_run?: boolean; limit?: number; min_age_hours?: number } = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { /* allow empty */ }
  }
  const dryRun = body.dry_run ?? false;
  const limit = Math.min(Math.max(body.limit ?? 5, 1), 10);
  const minAge = body.min_age_hours ?? 48;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) Candidatos
  const { data: candidates, error: candErr } = await supabase.rpc(
    "get_low_performance_candidates",
    { p_min_age_hours: minAge, p_cooldown_hours: 72, p_limit: limit },
  );
  if (candErr) return jr({ error: candErr.message }, 500);

  const cand = (candidates ?? []) as Candidate[];
  if (cand.length === 0) {
    return jr({ ok: true, processed: 0, message: "no low-performance candidates" });
  }

  // 2) Token Spotify (1 vez)
  let token: string | null = null;
  if (!dryRun) {
    try {
      const t = await getUserAccessToken();
      token = t.token;
    } catch (e) {
      return jr({ ok: false, error: `spotify token: ${(e as Error).message}` }, 400);
    }
  }

  const results: any[] = [];

  for (const c of cand) {
    const log = {
      template_id: c.template_id,
      spotify_playlist_id: c.spotify_playlist_id,
      genre_id: c.genre_id,
      actions_done: [] as string[],
      errors: [] as string[],
    };

    // ── HARD LOCK: bloqueia se houver faixa protegida por campanha ativa ──
    const protectedTracks = await getProtectedTracksForPlaylist(supabase, {
      spotify_playlist_id: c.spotify_playlist_id,
    });
    if (protectedTracks.length > 0) {
      await logProtectedBlock(supabase, {
        source: "auto-adjust-playlists",
        spotify_playlist_id: c.spotify_playlist_id,
        managed_playlist_id: null,
        action: "replace+reorder",
        blocked_tracks: protectedTracks.map((p) => p.spotify_track_id),
        extra: { template_id: c.template_id },
      });
      results.push({
        template_id: c.template_id,
        name_before: c.name,
        name_after: c.name,
        replaced: 0,
        status: "skipped_protected",
        errors: [],
        protected_count: protectedTracks.length,
      });
      continue;
    }


    // Busca contexto: subgênero do gênero + pool de tracks frescas
    const [genreRow, tracksPool, currentTpl] = await Promise.all([
      supabase.from("genres").select("nome,slug").eq("id", c.genre_id).maybeSingle(),
      supabase
        .from("search_tracks")
        .select("nome_musica,artista,spotify_track_id")
        .eq("genre_id", c.genre_id)
        .order("coletado_em", { ascending: false })
        .limit(200),
      supabase.from("playlist_templates").select("track_seeds,name,description").eq("id", c.template_id).maybeSingle(),
    ]);

    const subgenero = genreRow.data?.nome ?? null;
    const pool = tracksPool.data ?? [];

    // ── AÇÃO 1: rename ──
    const newName = buildNewName(c.name, subgenero);
    if (!dryRun && token && newName !== c.name) {
      const ok = await changePlaylistDetails(token, c.spotify_playlist_id, newName);
      if (ok) log.actions_done.push("rename");
      else log.errors.push("rename failed");
    } else if (dryRun) {
      log.actions_done.push("rename(dry)");
    }

    // ── AÇÃO 2 + 3: substituir ~20% e reordenar ──
    let beforeUris: string[] = [];
    let afterUris: string[] = [];
    let replacedCount = 0;

    if (!dryRun && token) {
      beforeUris = await getPlaylistTracks(token, c.spotify_playlist_id);
      if (beforeUris.length > 0) {
        const replaceN = Math.max(1, Math.floor(beforeUris.length * 0.2));
        const seed = Date.now() % 1000;

        // Mantém 80% (shuffled) + adiciona novas
        const shuffled = shuffle(beforeUris, seed);
        const kept = shuffled.slice(replaceN);

        // Busca novas URIs do pool (que NÃO estejam já na playlist)
        const existing = new Set(beforeUris);
        const candidatesPool = shuffle(pool, seed + 7);
        const newUris: string[] = [];
        for (const t of candidatesPool) {
          if (newUris.length >= replaceN) break;
          let uri: string | null = null;
          if (t.spotify_track_id) uri = `spotify:track:${t.spotify_track_id}`;
          else uri = await searchTrackUri(token, t.nome_musica, t.artista);
          if (uri && !existing.has(uri) && !newUris.includes(uri)) newUris.push(uri);
        }

        // Reordenação final: intercala novas no topo + restante shuffled
        afterUris = shuffle([...newUris, ...kept], seed + 13);
        replacedCount = newUris.length;

        const ok = await replaceTracks(token, c.spotify_playlist_id, afterUris);
        if (ok) {
          log.actions_done.push("reorder");
          if (replacedCount > 0) log.actions_done.push(`replace_${replacedCount}`);
        } else {
          log.errors.push("replace tracks failed");
        }
      }
    } else if (dryRun) {
      log.actions_done.push("reorder(dry)", "replace_20%(dry)");
    }

    // ── LOG ──
    const status = log.errors.length === 0 ? (dryRun ? "dry_run" : "success") : "failed";
    await supabase.from("playlist_adjustments").insert({
      template_id: c.template_id,
      spotify_playlist_id: c.spotify_playlist_id,
      genre_id: c.genre_id,
      action_type: log.actions_done.join("+") || "noop",
      status,
      before: { name: c.name, tracks_count: beforeUris.length },
      after: { name: newName, tracks_count: afterUris.length, replaced: replacedCount },
      details: {
        actions: log.actions_done,
        subgenero,
        tempo_horas: c.tempo_horas,
        replace_pct: 20,
      },
      error_message: log.errors.length ? log.errors.join("; ") : null,
      triggered_by: dryRun ? "dry_run" : "auto",
    });

    results.push({
      template_id: c.template_id,
      name_before: c.name,
      name_after: newName,
      replaced: replacedCount,
      status,
      errors: log.errors,
    });
  }

  return jr({
    ok: true,
    processed: results.length,
    dry_run: dryRun,
    results,
  });
});
