// import-account-playlists — importa em massa todas as playlists da conta
// Spotify conectada (token OAuth) para a tabela managed_playlists.
// - Lê /v1/me/playlists com paginação
// - Filtra só as que pertencem ao próprio usuário (owner.id === me.id)
// - Upsert por spotify_playlist_id (idempotente)
// - Atualiza accounts.current_playlists
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getUserAccessToken } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SpotifyPlaylistItem = {
  id: string;
  name: string;
  description: string | null;
  images: { url: string }[] | null;
  tracks: { total: number } | null;
  owner: { id: string; display_name?: string };
  external_urls?: { spotify?: string };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = body?.dry_run === true;

    // 1) token OAuth da conta padrão (Baile Hits Oficial hoje)
    const { token, row } = await getUserAccessToken(body?.spotify_user_id ?? undefined);
    const ownerId = row.spotify_user_id;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 2) descobre account_id correspondente em `accounts`
    const { data: acc } = await supabase
      .from("accounts")
      .select("id")
      .eq("spotify_user_id", ownerId)
      .maybeSingle();
    const accountId: string | null = acc?.id ?? null;

    // 3) paginação /v1/me/playlists
    const collected: SpotifyPlaylistItem[] = [];
    let url: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";
    let safety = 0;
    while (url && safety < 20) {
      safety++;
      const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        const t = await r.text();
        return jr({ ok: false, error: `Spotify ${r.status}: ${t.slice(0, 200)}` }, 500);
      }
      const j: { items: SpotifyPlaylistItem[]; next: string | null } = await r.json();
      for (const it of j.items ?? []) collected.push(it);
      url = j.next ?? null;
    }

    // 4) filtra só as que são DO próprio usuário
    const owned = collected.filter((p) => p.owner?.id === ownerId);
    const others = collected.length - owned.length;

    if (dryRun) {
      return jr({
        ok: true,
        dry_run: true,
        spotify_user_id: ownerId,
        account_id: accountId,
        total_fetched: collected.length,
        owned_count: owned.length,
        others_count: others,
        sample: owned.slice(0, 5).map((p) => ({ id: p.id, name: p.name, tracks: p.tracks?.total })),
      });
    }

    // 5) enriquecimento: busca followers de CADA playlist em paralelo (lotes de 8)
    // /v1/me/playlists não retorna followers — só /v1/playlists/{id} retorna.
    const followersMap = new Map<string, number | null>();
    const CONCURRENCY = 8;
    for (let i = 0; i < owned.length; i += CONCURRENCY) {
      const batch = owned.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (p) => {
        try {
          const r = await fetch(
            `https://api.spotify.com/v1/playlists/${p.id}?fields=followers(total)`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!r.ok) { followersMap.set(p.id, null); return; }
          const j = await r.json();
          followersMap.set(p.id, j?.followers?.total ?? null);
        } catch {
          followersMap.set(p.id, null);
        }
      }));
    }

    // 6) upsert em managed_playlists já com followers preenchidos
    const nowIso = new Date().toISOString();
    let imported = 0;
    let skipped = 0;
    const snapshotInserts: Array<{ playlist_spotify_id: string; followers: number | null; total_tracks: number | null }> = [];

    for (const p of owned) {
      const followers = followersMap.get(p.id) ?? null;
      const payload = {
        spotify_playlist_id: p.id,
        spotify_url: p.external_urls?.spotify ?? `https://open.spotify.com/playlist/${p.id}`,
        name: p.name ?? `Playlist ${p.id}`,
        description: p.description ?? null,
        cover_url: p.images && p.images.length > 0 ? p.images[0].url : null,
        tracks_count: p.tracks?.total ?? 0,
        followers,
        last_metrics_at: nowIso,
        account_id: accountId,
        imported_by: guard.via === "user" ? guard.userId : null,
        owner_spotify_user_id: ownerId,
        metadata: { source: "import-account-playlists", owner_display_name: p.owner?.display_name ?? null },
      };
      const { data: upserted, error } = await supabase
        .from("managed_playlists")
        .upsert(payload, { onConflict: "spotify_playlist_id" })
        .select("id, lifecycle_stage")
        .maybeSingle();
      if (error) {
        skipped++;
        console.error("upsert error", p.id, error.message);
      } else {
        imported++;
        snapshotInserts.push({
          playlist_spotify_id: p.id,
          followers,
          total_tracks: p.tracks?.total ?? null,
        });
        // Dispara onboarding-check (fire-and-forget) só pra playlists em estágio onboarding.
        if (upserted?.id && upserted?.lifecycle_stage === "onboarding") {
          fetch(`${SUPABASE_URL}/functions/v1/playlist-onboarding-check`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_KEY}`,
            },
            body: JSON.stringify({ playlist_id: upserted.id }),
          }).catch((e) => console.warn("onboarding-check dispatch", upserted.id, (e as Error).message));
        }
      }
    }

    // 7) snapshot temporal de followers (mesma tabela usada pelo refresh-search-results)
    if (snapshotInserts.length) {
      const { error: sErr } = await supabase
        .from("playlist_followers_snapshots")
        .insert(snapshotInserts);
      if (sErr) console.warn("snapshot insert:", sErr.message);
    }

    // 8) se a playlist já existe em search_results, atualiza followers/cover/tracks lá também
    const ids = owned.map((p) => p.id);
    if (ids.length) {
      for (const p of owned) {
        const followers = followersMap.get(p.id);
        await supabase.from("search_results").update({
          seguidores: followers ?? null,
          nome_playlist: p.name ?? null,
          imagem_url: p.images?.[0]?.url ?? null,
          total_musicas: p.tracks?.total ?? null,
          last_refreshed_at: nowIso,
          followers_verified_at: nowIso,
        }).eq("spotify_playlist_id", p.id);
      }
    }

    // 9) atualiza contagem na conta
    if (accountId) {
      await supabase
        .from("accounts")
        .update({ current_playlists: owned.length, updated_at: nowIso })
        .eq("id", accountId);
    }

    return jr({
      ok: true,
      spotify_user_id: ownerId,
      account_id: accountId,
      total_fetched: collected.length,
      owned_count: owned.length,
      others_count: others,
      imported,
      skipped,
    });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
