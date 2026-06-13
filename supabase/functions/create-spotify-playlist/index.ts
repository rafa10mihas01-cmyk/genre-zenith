// create-spotify-playlist — cria a playlist no Spotify a partir de um template aprovado.
// POST { template_id: string, spotify_user_id?: string, public?: boolean }
// → { ok, spotify_playlist_id, spotify_url, tracks_added, tracks_failed }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserToken, spotifyFetch } from "../_shared/spotify-client.ts";
import {
  addPlaylistTracks,
  createPlaylist,
  getPlaylistMeta,
  SpotifyApiError,
} from "../_shared/spotify-playlist.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// 🔐 Auth guard — exige usuário logado com role admin/curador (has_team_access)
async function requireTeamAccess(req: Request): Promise<{ ok: true } | { ok: false; resp: Response }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, resp: jr({ error: "unauthorized" }, 401) };
  }
  const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await supabaseAuth.auth.getClaims(token);
  if (claimsErr || !claims?.claims) {
    return { ok: false, resp: jr({ error: "unauthorized" }, 401) };
  }
  const { data: hasAccess } = await supabaseAuth.rpc("has_team_access");
  if (!hasAccess) {
    return { ok: false, resp: jr({ error: "forbidden" }, 403) };
  }
  return { ok: true };
}

// 🎯 Busca followers atuais da playlist no Spotify (usado p/ baseline correto t0)
// 🎯 Busca followers atuais da playlist no Spotify (usado p/ baseline correto t0)
async function fetchPlaylistFollowers(token: string, playlistId: string): Promise<number> {
  try {
    const meta = await getPlaylistMeta(playlistId, token, { fields: "followers(total)" });
    return Number(meta.followers ?? 0);
  } catch {
    return 0;
  }
}

async function searchTrackUri(token: string, nome: string, artista: string): Promise<string | null> {
  // 🎯 Busca top 5 e escolhe pela maior popularidade — evita remix/cover errado
  const q = `track:${nome} artist:${artista}`;
  const url = `https://api.spotify.com/v1/search?type=track&limit=5&q=${encodeURIComponent(q)}`;
  const r = await spotifyFetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const j = await r.json();
  const items: any[] = j?.tracks?.items ?? [];
  if (items.length === 0) return null;
  // Penaliza variantes ruins (remix/sped up/slowed) no nome
  const bad = /\b(remix|sped\s*up|slowed|reverb|cover|karaoke|tiktok)\b/i;
  const ranked = items
    .map((t) => ({
      uri: t.uri as string,
      pop: (t.popularity ?? 0) - (bad.test(t.name ?? "") ? 30 : 0),
    }))
    .sort((a, b) => b.pop - a.pop);
  return ranked[0]?.uri ?? null;
}

Deno.serve(async (req) => {
  const __dep = await deprecationGate(req, "create-spotify-playlist");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  // 🔐 Exige sessão válida com role admin/curador
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

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
  // 🔒 Idempotência: se já tem spotify_playlist_id, retorna o existente (não recria).
  // UNIQUE index (Audit #12) também bloqueia no nível do DB caso passe.
  if (tpl.spotify_playlist_id) {
    return jr({
      ok: true, already_created: true,
      spotify_playlist_id: tpl.spotify_playlist_id,
      spotify_url: tpl.spotify_url,
      tracks_added: tpl.tracks_added, tracks_failed: tpl.tracks_failed,
    });
  }

  // 🔒 Audit #12 — Lock por template (evita 2 chamadas simultâneas criando 2 playlists no Spotify)
  const lockSince = new Date(Date.now() - 120_000).toISOString();
  const { data: recentCreate } = await supabase
    .from("collection_logs")
    .select("id")
    .eq("acao", "create-spotify-playlist-lock")
    .ilike("mensagem", `%${templateId}%`)
    .gte("created_at", lockSince)
    .limit(1);
  if (recentCreate && recentCreate.length > 0) {
    return jr({ ok: false, error: "criação já em andamento para este template (lock 120s)" }, 409);
  }
  await supabase.from("collection_logs").insert({
    acao: "create-spotify-playlist-lock", status: "lock",
    mensagem: `template=${templateId}`,
  }).then(() => {}, (e) => console.error("[create-spotify-playlist] log/op failed:", e?.message ?? e));

  // 🎯 Auto-seleção de conta: se não veio spotify_user_id, escolhe a conta ativa
  // com mais espaço disponível (current_playlists asc).
  let chosenUserId = body.spotify_user_id;
  if (!chosenUserId) {
    const { data: acc } = await supabase
      .from("accounts")
      .select("spotify_user_id,current_playlists,max_playlists")
      .eq("status", "active")
      .order("current_playlists", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (acc && acc.current_playlists < acc.max_playlists) {
      chosenUserId = acc.spotify_user_id;
    }
  }

  let token: string;
  let ownerId: string;
  try {
    const t = await getUserToken(chosenUserId);
    token = t.token;
    ownerId = t.row.spotify_user_id;
  } catch (e) {
    const msg = (e as Error).message;
    await supabase.from("playlist_templates")
      .update({ creation_error: msg }).eq("id", templateId);
    return jr({ ok: false, error: msg }, 400);
  }

  // 1) Cria a playlist
  let playlistId: string;
  let playlistUrl: string;
  try {
    const res = await createPlaylist(
      ownerId,
      {
        name: tpl.name,
        description: (tpl.description ?? "").slice(0, 300),
        public: isPublic,
      },
      token,
    );
    playlistId = res.id;
    playlistUrl = res.raw?.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlistId}`;
  } catch (e) {
    const status = e instanceof SpotifyApiError ? e.status : 0;
    const detail = e instanceof SpotifyApiError ? e.body.slice(0, 200) : (e as Error).message;
    const msg = `create playlist ${status || ""}: ${detail}`.trim();
    await supabase.from("playlist_templates")
      .update({ creation_error: msg }).eq("id", templateId);
    return jr({ ok: false, error: msg }, 200);
  }

  // 2) Resolve URIs das faixas (track_seeds)
  // 🎯 Se seed traz spotify_track_id (vindo do generate-templates), usa direto:
  // 100% preciso, zero latência extra. Fallback pra search apenas quando faltar ID.
  const seeds: any[] = Array.isArray(tpl.track_seeds) ? tpl.track_seeds : [];
  const uris: string[] = [];
  let failed = 0;
  let resolvedFromId = 0;
  let resolvedFromSearch = 0;
  // Cap de segurança em 100 — playlists naturais ficam entre 25-80; 100 é teto pra evitar
  // ruído. A regra de tamanho real é honrada lá em generate-templates (proporção da base ±20%).
  for (const s of seeds.slice(0, 100)) {
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
    try {
      const res = await addPlaylistTracks(playlistId, chunk, token);
      snapshotId = res.snapshot_id ?? snapshotId;
    } catch {
      failed += chunk.length;
    }
  }

  // 4) Persiste resultado + baseline REAL de followers (busca da API do Spotify)
  // 🎯 FIX: era hardcoded `0` — corrompia o cálculo de crescimento e o score V2.
  const followersAtCreation = await fetchPlaylistFollowers(token, playlistId);

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
    followers_at_creation: followersAtCreation,
  };
  const { error: upErr } = await supabase.from("playlist_templates").update(patch).eq("id", templateId);
  if (upErr) return jr({ ok: false, error: upErr.message, partial: patch }, 500);

  // 🔒 Incremento ATÔMICO via RPC (evita race condition entre execuções paralelas)
  await supabase.rpc("increment_account_playlists", { p_spotify_user_id: ownerId })
    .then(() => {}, (e) => console.warn("[create-spotify-playlist] increment failed:", e?.message));

  // Snapshot inicial (baseline t0 com followers reais)
  await supabase.from("playlist_metrics_snapshots").insert({
    template_id: templateId,
    spotify_playlist_id: playlistId,
    followers: followersAtCreation,
    total_tracks: uris.length,
  }).then(() => {}, (e) => console.error("[create-spotify-playlist] log/op failed:", e?.message ?? e));

  await supabase.from("collection_logs").insert({
    genre_id: tpl.genre_id, acao: "create-spotify-playlist", status: "sucesso",
    mensagem: `Playlist "${tpl.name}" criada (${uris.length} faixas, ${failed} falhas) • IDs diretos: ${resolvedFromId}, via search: ${resolvedFromSearch}`,
  }).then(() => {}, (e) => console.error("[create-spotify-playlist] log/op failed:", e?.message ?? e));

  // 🔔 Notificação INFO: playlist publicada no Spotify
  await supabase.rpc("create_notification", {
    p_type: "info",
    p_title: "Playlist publicada no Spotify",
    p_message: `"${tpl.name}" — ${uris.length} faixas adicionadas${failed > 0 ? ` (${failed} falhas)` : ""}.`,
    p_action_url: playlistUrl,
    p_metadata: { template_id: templateId, spotify_playlist_id: playlistId, tracks_added: uris.length },
  }).then(() => {}, (e) => console.error("[create-spotify-playlist] log/op failed:", e?.message ?? e));

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
