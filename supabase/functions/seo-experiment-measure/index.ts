// seo-experiment-measure — varre experimentos ativos vencidos e calcula delta
// + agrega lições por nicho. Disparado por cron diário.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function outcomeFor(deltaPct: number): "positive" | "neutral" | "negative" {
  if (deltaPct >= 2) return "positive";
  if (deltaPct <= -2) return "negative";
  return "neutral";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const isCron = CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;
  const isService = req.headers.get("Authorization") === `Bearer ${SERVICE_KEY}`;
  if (!isCron && !isService) return jr({ ok: false, error: "unauthorized" }, 401);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { data: due, error } = await supabase
      .from("playlist_seo_experiments")
      .select("id, playlist_id, genre_id, field, pattern_key, pattern_label, baseline_followers")
      .eq("status", "active")
      .lte("measure_due_at", new Date().toISOString())
      .limit(200);
    if (error) throw new Error(error.message);

    let measured = 0;
    const touchedLessons = new Set<string>();

    for (const exp of (due ?? []) as any[]) {
      const { data: pl } = await supabase
        .from("managed_playlists")
        .select("followers")
        .eq("id", exp.playlist_id)
        .maybeSingle();
      const currentFollowers = (pl as any)?.followers ?? 0;
      const baseline = Number(exp.baseline_followers ?? 0);
      const delta = currentFollowers - baseline;
      const deltaPct = baseline > 0 ? (delta / baseline) * 100 : 0;
      const outcome = outcomeFor(deltaPct);
      const now = new Date().toISOString();

      await supabase.from("playlist_seo_experiments").update({
        status: "completed",
        measured_followers: currentFollowers,
        measured_at: now,
        delta_followers: delta,
        delta_pct: Number(deltaPct.toFixed(2)),
        outcome,
        updated_at: now,
      }).eq("id", exp.id);
      measured++;

      // Agrega no cérebro do nicho
      if (exp.genre_id && exp.pattern_key) {
        touchedLessons.add(`${exp.genre_id}|${exp.pattern_key}|${exp.field}`);
      }
    }

    // Recalcula lições agregadas (uma por combinação tocada)
    for (const key of touchedLessons) {
      const [genreId, patternKey, field] = key.split("|");
      const { data: all } = await supabase
        .from("playlist_seo_experiments")
        .select("delta_pct, outcome, pattern_label")
        .eq("genre_id", genreId)
        .eq("pattern_key", patternKey)
        .eq("field", field)
        .not("outcome", "is", null);
      const rows = all ?? [];
      if (rows.length === 0) continue;
      const samples = rows.length;
      const pos = rows.filter((r: any) => r.outcome === "positive").length;
      const neu = rows.filter((r: any) => r.outcome === "neutral").length;
      const neg = rows.filter((r: any) => r.outcome === "negative").length;
      const avg = rows.reduce((s: number, r: any) => s + Number(r.delta_pct ?? 0), 0) / samples;
      // Confiança simples: cresce com nº de amostras até 10
      const confidence = Math.min(1, samples / 10);
      const label = (rows[0] as any).pattern_label ?? patternKey;

      await supabase.from("seo_genre_lessons").upsert({
        genre_id: genreId,
        pattern_key: patternKey,
        pattern_label: label,
        field,
        samples_count: samples,
        positive_count: pos,
        neutral_count: neu,
        negative_count: neg,
        avg_delta_pct: Number(avg.toFixed(2)),
        confidence: Number(confidence.toFixed(2)),
        last_updated_at: new Date().toISOString(),
      }, { onConflict: "genre_id,pattern_key" });
    }

    return jr({ ok: true, measured, lessons_updated: touchedLessons.size });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
