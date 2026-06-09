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
    // 1) Acha rascunhos expirados — IGNORA rascunhos com plano congelado
    // (snapshot_locked_at != null). Plano fechado é intencional; quem segura
    // o rascunho é a decisão de aprovação do cliente, não o TTL de 48h.
    // Se essas campanhas precisarem ser limpas, é via UI explícita ou
    // restore-campaign-allocations para o caso de já terem sido zeradas.
    const { data: expired, error: selErr } = await supabase
      .from("campaigns")
      .select("id, track_name, artist, client_id, curator_id, expires_at")
      .eq("status", "draft")
      .is("snapshot_locked_at", null)
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

    // 4) Notifica no cockpit via RPC com dedupe por campanha (best-effort)
    for (const c of expired ?? []) {
      if (!c.curator_id) continue;
      const trackName = c.track_name ?? "campanha";
      await supabase.rpc("create_notification" as any, {
        p_type: "warning",
        p_title: "Rascunho cancelado automaticamente",
        p_message:
          `A campanha "${trackName}"${c.artist ? ` — ${c.artist}` : ""} foi descartada por inatividade (48h sem aprovação). ` +
          `Impacto: o inventário voltou a ficar disponível. ` +
          `Ação: nenhuma.`,
        p_action_url: "/campanhas",
        p_metadata: {
          domain: "system",
          severity: "medium",
          kind: "campaign_expired",
          user_id: c.curator_id,
          campaign_id: c.id,
          expires_at: c.expires_at,
        },
        p_dedupe_key: `campaign_expired:${c.id}`,
        p_cooldown_minutes: 60 * 24 * 30,
      });
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
