// Cron: roda a cada 30min. Marca como 'expired' campanhas draft cujo
// expires_at passou, e deleta as allocations associadas (liberando inventário).
// Cria notificação no cockpit pra cada campanha expirada.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1) Acha rascunhos expirados
    const { data: expired, error: selErr } = await supabase
      .from("campaigns")
      .select("id, track_name, artist, client_id, curator_id, expires_at")
      .eq("status", "draft")
      .lt("expires_at", new Date().toISOString());
    if (selErr) throw selErr;

    const ids = (expired ?? []).map((c) => c.id);
    if (ids.length === 0) {
      return new Response(JSON.stringify({ expired: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Deleta allocations (libera o inventário)
    const { error: delErr } = await supabase
      .from("campaign_eco_allocations")
      .delete()
      .in("campaign_id", ids);
    if (delErr) throw delErr;

    // 3) Marca campanhas como expired
    const { error: updErr } = await supabase
      .from("campaigns")
      .update({ status: "expired" })
      .in("id", ids);
    if (updErr) throw updErr;

    // 4) Notifica no cockpit (best-effort — não bloqueia se falhar)
    const notifications = (expired ?? []).map((c) => ({
      user_id: c.curator_id, // dono operacional
      kind: "campaign_expired",
      title: "Rascunho expirou",
      body: `Campanha "${c.track_name}"${c.artist ? ` — ${c.artist}` : ""} expirou após 48h. Inventário liberado.`,
      data: { campaign_id: c.id, expires_at: c.expires_at },
    }));
    if (notifications.length > 0) {
      await supabase.from("notifications").insert(notifications);
    }

    return new Response(
      JSON.stringify({ expired: ids.length, ids }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[expire-draft-campaigns]", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
