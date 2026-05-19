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

    // 5) upsert em managed_playlists
    let imported = 0;
    let skipped = 0;
    for (const p of owned) {
      const payload = {
        spotify_playlist_id: p.id,
        spotify_url: p.external_urls?.spotify ?? `https://open.spotify.com/playlist/${p.id}`,
        name: p.name ?? `Playlist ${p.id}`,
        description: p.description ?? null,
        cover_url: p.images && p.images.length > 0 ? p.images[0].url : null,
        tracks_count: p.tracks?.total ?? 0,
        account_id: accountId,
        imported_by: guard.via === "user" ? guard.userId : null,
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

    // 6) atualiza contagem na conta
    if (accountId) {
      await supabase
        .from("accounts")
        .update({ current_playlists: owned.length, updated_at: new Date().toISOString() })
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
