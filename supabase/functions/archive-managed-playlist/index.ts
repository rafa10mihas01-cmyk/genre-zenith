// archive-managed-playlist — soft delete (não toca no Spotify).
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
    if (!id) return jr({ ok: false, error: "playlist_id obrigatório" }, 400);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // pega canonical_playlist_id antes de arquivar pra limpar derivados
    const { data: mp } = await supabase
      .from("managed_playlists")
      .select("id, canonical_playlist_id")
      .eq("id", id)
      .maybeSingle();

    // Ao restaurar, também limpa o marcador de elegibilidade (já não é arquivada).
    // Ao arquivar manualmente, registra o motivo + snapshot de followers.
    const updatePayload: Record<string, unknown> = restore
      ? { archived_at: null, reactivation_eligible_at: null }
      : { archived_at: new Date().toISOString(), archived_reason: "manual" };

    const { error } = await supabase
      .from("managed_playlists")
      .update(updatePayload)
      .eq("id", id);
    if (error) return jr({ ok: false, error: error.message }, 500);

    // Ao mandar pra lixeira, remove o cérebro/score pra não aparecer em KPIs,
    // Matriz, recomendações etc. Quando restaurada, o brain-calc recria.
    if (!restore && mp?.canonical_playlist_id) {
      await Promise.all([
        supabase.from("playlist_brain").delete().eq("playlist_id", mp.canonical_playlist_id),
        supabase.from("playlist_brain_history").delete().eq("playlist_id", mp.canonical_playlist_id),
      ]);
    }

    return jr({ ok: true, restored: restore });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
