// learning-governance — mutações de governança do aprendizado (Wave 4)
// POST { genre_id, action, value? }
// actions:
//   lock_keyword / unlock_keyword / remove_keyword
//   lock_artist  / unlock_artist  / remove_artist
//   revert_last  (reaplica snapshot anterior)
//
// Persiste em genre_models.insights.learning.locked_keywords / locked_artists
// e mutaciona palavras_chave / musicas_recorrentes quando necessário.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Action =
  | "lock_keyword" | "unlock_keyword" | "remove_keyword"
  | "lock_artist"  | "unlock_artist"  | "remove_artist"
  | "revert_last";

function lower(s: any) { return String(s ?? "").toLowerCase(); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const body = await req.json();
    const genre_id: string = body.genre_id;
    const action: Action = body.action;
    const value: string | undefined = body.value;
    if (!genre_id || !action) {
      return new Response(JSON.stringify({ ok: false, error: "missing genre_id/action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: model } = await supabase
      .from("genre_models")
      .select("palavras_chave, musicas_recorrentes, insights")
      .eq("genre_id", genre_id)
      .maybeSingle();
    if (!model) {
      return new Response(JSON.stringify({ ok: false, error: "genre_model not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const insights = (model.insights as any) ?? {};
    const learning = insights.learning ?? {};
    const lockedKw: string[] = Array.isArray(learning.locked_keywords) ? [...learning.locked_keywords] : [];
    const lockedArt: string[] = Array.isArray(learning.locked_artists) ? [...learning.locked_artists] : [];
    let kwArr: any[] = Array.isArray(model.palavras_chave) ? [...(model.palavras_chave as any[])] : [];
    let trArr: any[] = Array.isArray(model.musicas_recorrentes) ? [...(model.musicas_recorrentes as any[])] : [];

    const v = lower(value);

    if (action === "revert_last") {
      const { data: snaps } = await supabase
        .from("learning_snapshots")
        .select("insights")
        .eq("genre_id", genre_id)
        .order("snapshot_at", { ascending: false })
        .limit(1);
      const prev = (snaps?.[0]?.insights as any) ?? {};
      if (Array.isArray(prev.prev_keywords)) kwArr = prev.prev_keywords;
      if (Array.isArray(prev.prev_tracks)) trArr = prev.prev_tracks;
    } else if (action === "lock_keyword") {
      if (v && !lockedKw.includes(v)) lockedKw.push(v);
      // garante presença em palavras_chave
      const exists = kwArr.some(k => lower(typeof k === "string" ? k : k.value) === v);
      if (!exists && v) kwArr.unshift({ value: v, count: 0, locked: true, source: "manual" });
    } else if (action === "unlock_keyword") {
      const i = lockedKw.indexOf(v);
      if (i >= 0) lockedKw.splice(i, 1);
    } else if (action === "remove_keyword") {
      kwArr = kwArr.filter(k => lower(typeof k === "string" ? k : k.value) !== v);
      const i = lockedKw.indexOf(v);
      if (i >= 0) lockedKw.splice(i, 1);
    } else if (action === "lock_artist") {
      if (v && !lockedArt.includes(v)) lockedArt.push(v);
    } else if (action === "unlock_artist") {
      const i = lockedArt.indexOf(v);
      if (i >= 0) lockedArt.splice(i, 1);
    } else if (action === "remove_artist") {
      const i = lockedArt.indexOf(v);
      if (i >= 0) lockedArt.splice(i, 1);
      // Remove tracks daquele artista
      trArr = trArr.filter(t => lower(t?.artista).indexOf(v) === -1);
    } else {
      return new Response(JSON.stringify({ ok: false, error: "unknown action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newLearning = {
      ...learning,
      locked_keywords: lockedKw,
      locked_artists: lockedArt,
      last_governance_at: new Date().toISOString(),
      last_governance_action: { action, value: v },
    };
    const newInsights = { ...insights, learning: newLearning };

    const { error } = await supabase.from("genre_models").update({
      palavras_chave: kwArr,
      musicas_recorrentes: trArr,
      insights: newInsights,
      updated_at: new Date().toISOString(),
    }).eq("genre_id", genre_id);

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, action, value: v, locked_keywords: lockedKw, locked_artists: lockedArt }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[learning-governance] fatal", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
