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
    const { error } = await supabase
      .from("managed_playlists")
      .update({ archived_at: restore ? null : new Date().toISOString() })
      .eq("id", id);
    if (error) return jr({ ok: false, error: error.message }, 500);
    return jr({ ok: true, restored: restore });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
