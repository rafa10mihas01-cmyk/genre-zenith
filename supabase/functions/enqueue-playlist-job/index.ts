// enqueue-playlist-job — cria um job manual de add/remove/reorder de faixa em playlist gerenciada.
// Body:
//   { playlist_id, spotify_track_id, action: 'add' | 'remove' }
//   { playlist_id, spotify_track_id, action: 'reorder', from_position, to_position }  // 1-indexed
// Auth: usuário autenticado com role admin/curador (has_team_access).
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
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
  if (action !== "add" && action !== "remove") {
    return jr({ error: "action deve ser 'add' ou 'remove'" }, 400);
  }
  if (!trackId) return jr({ error: "spotify_track_id inválido (cole URL, URI ou ID de 22 chars)" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: pl, error: plErr } = await supabase
    .from("playlists")
    .select("id, spotify_playlist_id")
    .eq("id", playlist_id)
    .maybeSingle();
  if (plErr) return jr({ error: plErr.message }, 500);
  if (!pl?.spotify_playlist_id) return jr({ error: "playlist não encontrada" }, 404);

  const job_type = action === "add" ? "playlist.track.add" : "playlist.track.remove";
  // Inclui timestamp pra permitir múltiplos jobs do mesmo tipo na mesma faixa ao longo do tempo
  // (o índice único parcial só bloqueia jobs abertos com mesma chave).
  const dedupe_key = `${action}:${pl.spotify_playlist_id}:${trackId}:manual:${Date.now()}`;

  const { data: inserted, error: insErr } = await supabase
    .from("playlist_execution_jobs")
    .insert({
      job_type,
      playlist_id: pl.id,
      spotify_playlist_id: pl.spotify_playlist_id,
      spotify_track_id: trackId,
      dedupe_key,
      status: "pending",
      metadata: { source: "manual_ui", actor: guard.via === "user" ? guard.userId ?? null : "service_role" },
    })
    .select("id, job_type, status")
    .single();

  if (insErr) return jr({ error: insErr.message }, 500);
  return jr({ ok: true, job: inserted });
});
