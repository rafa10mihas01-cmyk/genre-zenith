// Coleta automática diária: para cada gênero ativo, executa run-search
// para os termos pendentes e re-analisa o modelo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireTeamAccess } from "../_shared/auth.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  const __dep = await deprecationGate(req, "daily-collect");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const startedAt = Date.now();
  const summary = { genres: 0, terms_run: 0, models_updated: 0, errors: 0 };

  try {
    const { data: genres, error } = await supabase
      .from("genres")
      .select("id, nome")
      .eq("ativo", true);
    if (error) throw error;

    summary.genres = genres?.length ?? 0;

    for (const g of genres ?? []) {
      try {
        const { data: terms } = await supabase
          .from("search_terms")
          .select("id, termo")
          .eq("genre_id", g.id)
          .eq("executado", false)
          .limit(3);

        for (const t of terms ?? []) {
          const r = await fetch(`${supabaseUrl}/functions/v1/run-search`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              genre_id: g.id,
              term_id: t.id,
              search_term: t.termo,
            }),
          });
          if (r.ok) summary.terms_run++;
          else {
            summary.errors++;
            const errBody = await r.text().catch(() => "");
            console.error(`run-search failed ${r.status} term="${t.termo}" genre=${g.nome}: ${errBody.slice(0, 200)}`);
          }
        }

        const a = await fetch(`${supabaseUrl}/functions/v1/analyze-genre`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ genre_id: g.id }),
        });
        if (a.ok) summary.models_updated++;
        else summary.errors++;
      } catch (e) {
        summary.errors++;
        console.error(`Genre ${g.nome} failed`, e);
      }
    }

    await supabase.from("collection_logs").insert({
      acao: "daily-collect",
      status: summary.errors > 0 ? "erro" : "sucesso",
      mensagem: `Cron diário: ${summary.genres} gêneros, ${summary.terms_run} buscas, ${summary.models_updated} modelos. ${summary.errors} erros.`,
      duracao_ms: Date.now() - startedAt,
    });

    await reportCronHealth(supabase, {
      job_name: "daily-collect",
      status: summary.errors > 0 ? "partial" : "ok",
      startedAt,
      metrics: summary,
    });

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    await supabase.from("collection_logs").insert({
      acao: "daily-collect",
      status: "erro",
      mensagem: `Cron falhou: ${e.message}`,
      duracao_ms: Date.now() - startedAt,
    });
    await reportCronHealth(supabase, {
      job_name: "daily-collect",
      status: "error",
      startedAt,
      message: e.message,
    });
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
