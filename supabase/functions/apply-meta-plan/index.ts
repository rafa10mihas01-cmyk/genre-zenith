// apply-meta-plan — aplica uma faixa em várias playlists nas posições planejadas
// pelo Planejador de Meta. Para cada slot: insere a faixa na posição N (empurra
// as demais pra baixo, padrão Spotify). Se já existir em outra posição, MOVE
// pra posição planejada.
//
// Body: {
//   spotify_track_id: string,
//   slots: { playlist_id: string (managed_playlists.id), position: number }[]
// }
//
// Retorno: { ok: true, results: [{playlist_id, name, status: "added"|"moved"|"skip"|"error", message?}] }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getUserAccessToken, getSpotifyToken } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function spotifyFetch(url: string, init: RequestInit, token: string) {
  const r = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Spotify ${r.status}: ${txt.slice(0, 300)}`);
  try { return txt ? JSON.parse(txt) : {}; } catch { return {}; }
}

async function fetchAllTrackUris(playlistId: string, token: string): Promise<string[]> {
  const uris: string[] = [];
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/items?fields=items(track(uri)),next&limit=100`;
  while (url) {
    const j = await spotifyFetch(url, { method: "GET" }, token);
    for (const it of j.items ?? []) {
      const uri = it?.track?.uri;
      if (uri) uris.push(uri);
    }
    url = j.next ?? null;
  }
  return uris;
}

// cache de token por owner_id (várias playlists podem compartilhar)
const tokenCache = new Map<string, string>();
async function tokenForOwner(spId: string): Promise<{ token: string; ownerId: string | null }> {
  let ownerId: string | null = null;
  try {
    const appToken = await getSpotifyToken();
    const or = await fetch(
      `https://api.spotify.com/v1/playlists/${spId}?fields=owner(id)`,
      { headers: { Authorization: `Bearer ${appToken}` } },
    );
    if (or.ok) ownerId = (await or.json())?.owner?.id ?? null;
  } catch { /* */ }
  const key = ownerId ?? "_default";
  if (tokenCache.has(key)) return { token: tokenCache.get(key)!, ownerId };
  const r = await getUserAccessToken(ownerId ?? undefined);
  tokenCache.set(key, r.token);
  return { token: r.token, ownerId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const trackId: string = body?.spotify_track_id;
    const slots: { playlist_id: string; position: number }[] = Array.isArray(body?.slots) ? body.slots : [];
    if (!trackId || !/^[A-Za-z0-9]{10,}$/.test(trackId)) {
      return jr({ ok: false, error: "spotify_track_id inválido" }, 400);
    }
    if (slots.length === 0) return jr({ ok: false, error: "slots vazio" }, 400);
    if (slots.length > 200) return jr({ ok: false, error: "máx 200 slots por execução" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const ids = [...new Set(slots.map(s => s.playlist_id))];
    const { data: pls } = await supabase
      .from("managed_playlists")
      .select("id, name, spotify_playlist_id")
      .in("id", ids);
    const plById = new Map((pls ?? []).map((p: any) => [p.id, p]));

    const trackUri = `spotify:track:${trackId}`;
    const results: any[] = [];

    for (const slot of slots) {
      const pl: any = plById.get(slot.playlist_id);
      if (!pl?.spotify_playlist_id) {
        results.push({ playlist_id: slot.playlist_id, status: "error", message: "playlist não encontrada" });
        continue;
      }
      const targetIdx = Math.max(0, Math.floor(slot.position) - 1); // posição 1-based → índice 0-based
      try {
        const { token } = await tokenForOwner(pl.spotify_playlist_id);
        const uris = await fetchAllTrackUris(pl.spotify_playlist_id, token);
        const existingIdx = uris.indexOf(trackUri);

        if (existingIdx >= 0) {
          // já existe — mover pra posição alvo
          const insertBefore = Math.max(0, Math.min(targetIdx, uris.length));
          if (insertBefore === existingIdx || insertBefore === existingIdx + 1) {
            results.push({ playlist_id: pl.id, name: pl.name, status: "skip", message: "já está na posição" });
            continue;
          }
          await spotifyFetch(
            `https://api.spotify.com/v1/playlists/${pl.spotify_playlist_id}/items`,
            {
              method: "PUT",
              body: JSON.stringify({
                range_start: existingIdx,
                insert_before: insertBefore,
                range_length: 1,
              }),
            },
            token,
          );
          results.push({ playlist_id: pl.id, name: pl.name, status: "moved", message: `movida pra pos ${slot.position}` });
        } else {
          // não existe — inserir na posição (Spotify empurra as demais pra baixo)
          const position = Math.min(targetIdx, uris.length);
          await spotifyFetch(
            `https://api.spotify.com/v1/playlists/${pl.spotify_playlist_id}/items`,
            {
              method: "POST",
              body: JSON.stringify({ uris: [trackUri], position }),
            },
            token,
          );
          results.push({ playlist_id: pl.id, name: pl.name, status: "added", message: `inserida na pos ${slot.position}` });
        }
      } catch (e) {
        results.push({ playlist_id: pl.id, name: pl.name, status: "error", message: (e as Error).message });
      }
    }

    const counts = results.reduce((acc: any, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {});
    await supabase.from("collection_logs").insert({
      acao: "apply-meta-plan",
      status: (counts.error ?? 0) === 0 ? "sucesso" : "parcial",
      mensagem: `track ${trackId}: ${JSON.stringify(counts)}`,
    });

    return jr({ ok: true, counts, results });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
