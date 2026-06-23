// enqueue-playlist-job — cria um job manual de add/remove/reorder de faixa em playlist gerenciada.
// Body:
//   { playlist_id, spotify_track_id, action: 'add' | 'remove' }
//   { playlist_id, spotify_track_id, action: 'reorder', from_position, to_position }  // 1-indexed
// Auth: usuário autenticado com role admin/curador (has_team_access).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Aceita "spotify:track:ID", "https://open.spotify.com/track/ID...", ou ID puro
function extractTrackId(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const uri = s.match(/spotify:track:([A-Za-z0-9]{22})/);
  if (uri) return uri[1];
  const url = s.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]{22})/);
  if (url) return url[1];
  if (/^[A-Za-z0-9]{22}$/.test(s)) return s;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method not allowed" }, 405);

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: any;
  try { body = await req.json(); } catch { return jr({ error: "Invalid JSON" }, 400); }

  const playlist_id = String(body?.playlist_id ?? "").trim();
  const action = String(body?.action ?? "").trim();
  const trackId = extractTrackId(String(body?.spotify_track_id ?? ""));

  if (!playlist_id) return jr({ error: "playlist_id obrigatório" }, 400);
  if (action !== "add" && action !== "remove" && action !== "reorder") {
    return jr({ error: "action deve ser 'add', 'remove' ou 'reorder'" }, 400);
  }
  if (!trackId) return jr({ error: "spotify_track_id inválido (cole URL, URI ou ID de 22 chars)" }, 400);

  let fromPosition: number | null = null;
  let toPosition: number | null = null;
  if (action === "reorder") {
    const fp = Number(body?.from_position);
    const tp = Number(body?.to_position);
    if (!Number.isInteger(fp) || fp < 1) return jr({ error: "from_position inválido (>=1)" }, 400);
    if (!Number.isInteger(tp) || tp < 1) return jr({ error: "to_position inválido (>=1)" }, 400);
    if (fp === tp) return jr({ error: "from_position e to_position são iguais" }, 400);
    fromPosition = fp;
    toPosition = tp;
  } else if (action === "add" && body?.to_position != null) {
    const tp = Number(body?.to_position);
    if (!Number.isInteger(tp) || tp < 1) return jr({ error: "to_position inválido (>=1)" }, 400);
    toPosition = tp;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Aceita tanto playlists.id (canonical) quanto managed_playlists.id
  let resolvedPlaylistId: string | null = null;
  let spotifyPlaylistId: string | null = null;
  const { data: pl, error: plErr } = await supabase
    .from("playlists")
    .select("id, spotify_playlist_id")
    .eq("id", playlist_id)
    .maybeSingle();
  if (plErr) return jr({ error: plErr.message }, 500);
  if (pl?.spotify_playlist_id) {
    resolvedPlaylistId = pl.id;
    spotifyPlaylistId = pl.spotify_playlist_id;
  } else {
    const { data: mp, error: mpErr } = await supabase
      .from("managed_playlists")
      .select("id, spotify_playlist_id")
      .eq("id", playlist_id)
      .maybeSingle();
    if (mpErr) return jr({ error: mpErr.message }, 500);
    if (mp?.spotify_playlist_id) {
      spotifyPlaylistId = mp.spotify_playlist_id;
      const { data: canon, error: canonErr } = await supabase
        .from("playlists")
        .select("id")
        .eq("spotify_playlist_id", mp.spotify_playlist_id)
        .maybeSingle();
      if (canonErr) return jr({ error: canonErr.message }, 500);
      resolvedPlaylistId = canon?.id ?? null;
    }
  }
  if (!spotifyPlaylistId || !resolvedPlaylistId) return jr({ error: "playlist não encontrada" }, 404);

  const job_type =
    action === "add" ? "playlist.track.add"
    : action === "remove" ? "playlist.track.remove"
    : "playlist.track.reorder";

  // Dedupe determinístico: chave estável + bucket de 5s.
  // Cliques duplicados dentro do mesmo bucket de 5s colapsam via UNIQUE index parcial
  // (playlist_execution_jobs_dedupe_open). Após 5s, novo bucket permite novo job.
  const DEDUPE_WINDOW_MS = 5000;
  const bucket = Math.floor(Date.now() / DEDUPE_WINDOW_MS);
  const posSuffix =
    action === "reorder" ? `:${fromPosition}->${toPosition}`
    : action === "add" && toPosition ? `:pos${toPosition}`
    : "";
  const dedupe_key = `${action}:${spotifyPlaylistId}:${trackId}${posSuffix}:manual:b${bucket}`;

  const { data: inserted, error: insErr } = await supabase
    .from("playlist_execution_jobs")
    .insert({
      job_type,
      playlist_id: resolvedPlaylistId,
      spotify_playlist_id: spotifyPlaylistId,
      spotify_track_id: trackId,
      from_position: fromPosition,
      to_position: toPosition,
      dedupe_key,
      status: "pending",
      metadata: { source: "manual_ui", actor: guard.via === "user" ? guard.userId ?? null : "service_role" },
    })
    .select("id, job_type, status, from_position, to_position")
    .single();

  if (insErr) {
    // 23505 = unique_violation: clique duplicado dentro da janela de 5s.
    // Retorna o job já existente (deduped=true) em vez de erro.
    if ((insErr as any).code === "23505") {
      const { data: existing } = await supabase
        .from("playlist_execution_jobs")
        .select("id, job_type, status, from_position, to_position")
        .eq("dedupe_key", dedupe_key)
        .in("status", ["pending", "claimed", "failed"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) return jr({ ok: true, deduped: true, job: existing });
    }
    return jr({ error: insErr.message }, 500);
  }
  return jr({ ok: true, deduped: false, job: inserted });
});
