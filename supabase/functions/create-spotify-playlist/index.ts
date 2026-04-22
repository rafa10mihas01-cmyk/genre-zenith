// create-spotify-playlist — cria a playlist no Spotify a partir de um template aprovado.
// POST { template_id: string, spotify_user_id?: string, public?: boolean }
// → { ok, spotify_playlist_id, spotify_url, tracks_added, tracks_failed }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserAccessToken } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function searchTrackUri(token: string, nome: string, artista: string): Promise<string | null> {
  const q = `track:${nome} artist:${artista}`;
  const url = `https://api.spotify.com/v1/search?type=track&limit=1&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const j = await r.json();
  const item = j?.tracks?.items?.[0];
  return item?.uri ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  let body: { template_id?: string; spotify_user_id?: string; public?: boolean };
  try { body = await req.json(); } catch { return jr({ error: "invalid json" }, 400); }
  const templateId = body.template_id;
  if (!templateId) return jr({ error: "template_id required" }, 400);
  const isPublic = body.public ?? true;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: tpl, error: tplErr } = await supabase
    .from("playlist_templates").select("*").eq("id", templateId).maybeSingle();
  if (tplErr || !tpl) return jr({ error: "template not found" }, 404);
  if (tpl.status !== "approved" && tpl.status !== "created") {
    return jr({ error: `template não aprovado (status=${tpl.status})` }, 400);
  }
  if (tpl.spotify_playlist_id) {
    return jr({
      ok: true, already_created: true,
      spotify_playlist_id: tpl.spotify_playlist_id,
      spotify_url: tpl.spotify_url,
      tracks_added: tpl.tracks_added, tracks_failed: tpl.tracks_failed,
    });
  }

  let token: string;
  let ownerId: string;
  try {
    const t = await getUserAccessToken(body.spotify_user_id);
    token = t.token;
    ownerId = t.row.spotify_user_id;
  } catch (e) {
    const msg = (e as Error).message;
    await supabase.from("playlist_templates")
      .update({ creation_error: msg }).eq("id", templateId);
    return jr({ ok: false, error: msg }, 400);
  }

  // 1) Cria a playlist
  const createResp = await fetch(`https://api.spotify.com/v1/users/${encodeURIComponent(ownerId)}/playlists`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: tpl.name,
      description: (tpl.description ?? "").slice(0, 300),
      public: isPublic,
    }),
  });
  if (!createResp.ok) {
    const t = await createResp.text();
    const msg = `create playlist ${createResp.status}: ${t.slice(0, 200)}`;
    await supabase.from("playlist_templates")
      .update({ creation_error: msg }).eq("id", templateId);
    return jr({ ok: false, error: msg }, 200);
  }
  const created = await createResp.json();
  const playlistId: string = created.id;
  const playlistUrl: string = created?.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlistId}`;

  // 2) Resolve URIs das faixas (track_seeds)
  // 🎯 Se seed traz spotify_track_id (vindo do generate-templates), usa direto:
  // 100% preciso, zero latência extra. Fallback pra search apenas quando faltar ID.
  const seeds: any[] = Array.isArray(tpl.track_seeds) ? tpl.track_seeds : [];
  const uris: string[] = [];
  let failed = 0;
  let resolvedFromId = 0;
  let resolvedFromSearch = 0;
  for (const s of seeds.slice(0, 80)) {
    const trackId = String(s?.spotify_track_id ?? "").trim();
    if (trackId && /^[A-Za-z0-9]{16,}$/.test(trackId)) {
      uris.push(`spotify:track:${trackId}`);
      resolvedFromId++;
      continue;
    }
    const nome = String(s?.nome ?? "").trim();
    const artista = String(s?.artista ?? "").trim();
    if (!nome || !artista) { failed++; continue; }
    try {
      const uri = await searchTrackUri(token, nome, artista);
      if (uri) { uris.push(uri); resolvedFromSearch++; } else failed++;
    } catch { failed++; }
  }

  // 3) Adiciona faixas (em chunks de 100)
  let snapshotId: string | null = null;
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    const addResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ uris: chunk }),
    });
    if (addResp.ok) {
      const j = await addResp.json();
      snapshotId = j?.snapshot_id ?? snapshotId;
    } else {
      failed += chunk.length;
    }
  }

  // 4) Persiste resultado
  const patch = {
    status: "created",
    spotify_playlist_id: playlistId,
    spotify_url: playlistUrl,
    spotify_snapshot_id: snapshotId,
    spotify_owner_id: ownerId,
    tracks_added: uris.length,
    tracks_failed: failed,
    creation_error: null,
    created_on_spotify_at: new Date().toISOString(),
  };
  const { error: upErr } = await supabase.from("playlist_templates").update(patch).eq("id", templateId);
  if (upErr) return jr({ ok: false, error: upErr.message, partial: patch }, 500);

  await supabase.from("collection_logs").insert({
    genre_id: tpl.genre_id, acao: "create-spotify-playlist", status: "sucesso",
    mensagem: `Playlist "${tpl.name}" criada (${uris.length} faixas, ${failed} falhas) • IDs diretos: ${resolvedFromId}, via search: ${resolvedFromSearch}`,
  }).then(() => {}, () => {});

  return jr({
    ok: true,
    spotify_playlist_id: playlistId,
    spotify_url: playlistUrl,
    tracks_added: uris.length,
    tracks_failed: failed,
    resolved_from_id: resolvedFromId,
    resolved_from_search: resolvedFromSearch,
  });
});
