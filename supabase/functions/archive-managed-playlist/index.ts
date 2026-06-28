// archive-managed-playlist — soft delete via playlist_type=ARCHIVED.
// playlist_type passou a ser a fonte de verdade; archived_at é apenas timestamp
// derivado (gatilho `trg_sync_archived_at_with_playlist_type` cuida disso).
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const id: string = body?.playlist_id;
    const restore = body?.restore === true;
    // Ao restaurar, a categoria padrão é CATALOG (a função de negócio anterior se perdeu).
    // O operador pode promover para CAMPAIGN depois, manualmente.
    const restoreTo: "CAMPAIGN" | "CATALOG" =
      body?.restore_to === "CAMPAIGN" ? "CAMPAIGN" : "CATALOG";
    if (!id) return jr({ ok: false, error: "playlist_id obrigatório" }, 400);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: mp } = await supabase
      .from("managed_playlists")
      .select("id, canonical_playlist_id, followers, playlist_type")
      .eq("id", id)
      .maybeSingle();

    const updatePayload: Record<string, unknown> = restore
      ? { playlist_type: restoreTo }
      : {
          playlist_type: "ARCHIVED",
          archived_reason: "manual",
          archived_followers: mp?.followers ?? null,
        };

    const { error } = await supabase
      .from("managed_playlists")
      .update(updatePayload)
      .eq("id", id);
    if (error) return jr({ ok: false, error: error.message }, 500);

    // Ao mandar pra lixeira (ARCHIVED), remove o cérebro/score pra não aparecer em KPIs,
    // Matriz, recomendações etc. Quando restaurada, o brain-calc recria.
    if (!restore && mp?.canonical_playlist_id) {
      await Promise.all([
        supabase.from("playlist_brain").delete().eq("playlist_id", mp.canonical_playlist_id),
        supabase.from("playlist_brain_history").delete().eq("playlist_id", mp.canonical_playlist_id),
      ]);
    }

    return jr({ ok: true, restored: restore, playlist_type: restore ? restoreTo : "ARCHIVED" });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
