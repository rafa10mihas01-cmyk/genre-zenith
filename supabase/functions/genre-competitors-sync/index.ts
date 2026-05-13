// genre-competitors-sync — Promove playlists_dominantes (jsonb em genre_models)
// para a tabela playlists com ownership='external', monitored=true e genre_id setado.
// Modos:
//   { genre_id: "uuid" }  → 1 gênero
//   { batch: true }       → todos os gêneros com dominantes mapeadas
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractIdFromUrl(url: string): string | null {
  const m = url.match(/playlist\/([A-Za-z0-9]+)/);
  return m?.[1] ?? null;
}

async function syncOne(supabase: any, genreId: string) {
  const { data: gm } = await supabase
    .from("genre_models")
    .select("playlists_dominantes")
    .eq("genre_id", genreId)
    .maybeSingle();

  const list = Array.isArray(gm?.playlists_dominantes) ? gm.playlists_dominantes : [];
  let inserted = 0, updated = 0, skipped = 0;

  for (const item of list) {
    const url: string | undefined = item?.url;
    if (!url) { skipped++; continue; }
    const spId = extractIdFromUrl(url);
    if (!spId) { skipped++; continue; }

    const followers = typeof item.seguidores === "number" ? item.seguidores : null;
    const name = item.nome ?? null;
    const cover = item.imagem ?? null;

    const { data: existing } = await supabase
      .from("playlists")
      .select("id, ownership, monitored, genre_id")
      .eq("spotify_playlist_id", spId)
      .maybeSingle();

    if (existing) {
      // Não sobrescreve ownership='own' (uma playlist nossa não vira competitor)
      if (existing.ownership === "own") { skipped++; continue; }
      const patch: any = {
        monitored: true,
        genre_id: genreId,
        last_seen_at: new Date().toISOString(),
      };
      if (followers != null) patch.followers = followers;
      if (name) patch.name = name;
      if (cover) patch.cover_url = cover;
      const { error } = await supabase.from("playlists").update(patch).eq("id", existing.id);
      if (!error) updated++;
    } else {
      const { error } = await supabase.from("playlists").insert({
        spotify_playlist_id: spId,
        name,
        ownership: "external",
        source: "apify",
        followers,
        cover_url: cover,
        genre_id: genreId,
        monitored: true,
      });
      if (!error) inserted++;
    }
  }

  return { genre_id: genreId, total_in_model: list.length, inserted, updated, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    if (body?.genre_id) {
      return jr({ ok: true, mode: "single", result: await syncOne(supabase, body.genre_id) });
    }

    if (body?.batch === true) {
      const { data: gms } = await supabase
        .from("genre_models")
        .select("genre_id, playlists_dominantes");
      const targets = (gms ?? []).filter((g: any) =>
        Array.isArray(g.playlists_dominantes) && g.playlists_dominantes.length > 0
      );
      const results: any[] = [];
      for (const g of targets) {
        try { results.push(await syncOne(supabase, g.genre_id)); }
        catch (e) { results.push({ genre_id: g.genre_id, error: (e as Error).message }); }
      }
      return jr({ ok: true, mode: "batch", processed: results.length, results });
    }

    return jr({ ok: false, error: "informe genre_id ou batch:true" }, 400);
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
