// delete-managed-playlist — hard delete (apenas se já estiver ARCHIVED).
// playlist_type=ARCHIVED é a única fonte de verdade pra elegibilidade de exclusão.
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
    const ids: string[] = Array.isArray(body?.playlist_ids)
      ? body.playlist_ids
      : body?.playlist_id ? [body.playlist_id] : [];
    const deleteAllArchived: boolean = body?.delete_all_archived === true;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    let targetIds = ids;
    if (deleteAllArchived) {
      const { data, error } = await supabase
        .from("managed_playlists")
        .select("id")
        .eq("playlist_type", "ARCHIVED");
      if (error) return jr({ ok: false, error: error.message }, 500);
      targetIds = (data ?? []).map((r: any) => r.id);
    }

    if (targetIds.length === 0) return jr({ ok: true, deleted: 0 });

    // Segurança: só apaga se estiver ARCHIVED
    const { data: rows, error: chkErr } = await supabase
      .from("managed_playlists")
      .select("id, playlist_type")
      .in("id", targetIds);
    if (chkErr) return jr({ ok: false, error: chkErr.message }, 500);

    const okIds = (rows ?? [])
      .filter((r: any) => r.playlist_type === "ARCHIVED")
      .map((r: any) => r.id);
    if (okIds.length === 0) {
      return jr({ ok: false, error: "Nenhuma playlist ARCHIVED encontrada nos IDs informados." }, 400);
    }

    const { error: delErr } = await supabase
      .from("managed_playlists")
      .delete()
      .in("id", okIds);
    if (delErr) return jr({ ok: false, error: delErr.message }, 500);

    return jr({ ok: true, deleted: okIds.length });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
