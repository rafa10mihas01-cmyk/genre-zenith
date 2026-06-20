// sync-spotify-editorial-charts
// =====================================================================
// IMPORTANTE: desde nov/2024 o Spotify bloqueou leitura das playlists
// editoriais (Top 50 BR etc) — retorna 404 mesmo com user token.
// Então a estratégia aqui é OUTRA:
//
//   1. Lê os track_ids do raw_chart_daily de hoje (top200_br do kworb).
//   2. Chama /v1/tracks?ids=... em batches de 50 → pega capa, popularity,
//      artist_id, album_name.
//   3. UPDATE nas mesmas linhas com cover_url / album_name / popularity.
//
// Resultado: o Top 200 (e consequentemente o Top 50 = LIMIT 50) fica
// enriquecido com a CAPA OFICIAL e popularidade — exatamente o que o
// pipeline de diagnóstico precisa pra sugerir adds e referenciar capa.
// =====================================================================
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { ccFetch } from "../_shared/catalog-gateway.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_MS = 300;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchTracksBatch(ids: string[]) {
  const url = `https://api.spotify.com/v1/tracks?ids=${ids.join(",")}`;
  const r = await ccFetch(url, "sync-spotify-editorial-charts");
  if (!r.ok) throw new Error(`Spotify ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.tracks ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const start = Date.now();
  const url = new URL(req.url);
  const chartName = url.searchParams.get("chart") ?? "top200_br";
  const today = new Date().toISOString().slice(0, 10);

  try {
    // Pega snapshot mais recente desse chart (até 7 dias atrás se hoje vazio)
    const { data: rows, error } = await supabase
      .from("raw_chart_daily")
      .select("id, spotify_track_id, cover_url")
      .eq("chart_name", chartName)
      .gte("chart_date", new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10))
      .order("chart_date", { ascending: false })
      .order("position", { ascending: true })
      .limit(250);
    if (error) throw new Error(error.message);

    const targets = (rows ?? []).filter((r) => r.spotify_track_id && !r.cover_url);
    if (targets.length === 0) {
      return jr({ ok: true, message: "nada pra enriquecer", chart: chartName });
    }

    // Token via Catalog Gateway.
    let enriched = 0;
    let failed = 0;

    let batchIdx = 0;
    for (const batch of chunk(targets, 50)) {
      if (batchIdx++ > 0) await sleep(THROTTLE_MS);
      const ids = batch.map((b) => b.spotify_track_id!);
      try {
        const tracks = await fetchTracksBatch(ids);
        // map por id pra preservar ordem
        const byId = new Map<string, any>();
        for (const tr of tracks) if (tr?.id) byId.set(tr.id, tr);

        for (const row of batch) {
          const tr = byId.get(row.spotify_track_id!);
          if (!tr) continue;
          const imgs = tr.album?.images ?? [];
          const cover = imgs[0]?.url ?? null;
          const artists = (tr.artists ?? []).filter(Boolean);
          const { error: upErr } = await supabase
            .from("raw_chart_daily")
            .update({
              cover_url: cover,
              album_name: tr.album?.name ?? null,
              popularity: typeof tr.popularity === "number" ? tr.popularity : null,
              spotify_artist_id: artists[0]?.id ?? null,
            })
            .eq("id", row.id);
          if (upErr) failed++;
          else enriched++;
        }
      } catch (e) {
        failed += batch.length;
        await supabase.from("collection_logs").insert({
          acao: "sync-spotify-editorial-charts",
          status: "erro",
          mensagem: `batch ${ids.length}: ${(e as Error).message}`.slice(0, 500),
        });
      }
    }

    await supabase.from("collection_logs").insert({
      acao: "sync-spotify-editorial-charts",
      status: "sucesso",
      mensagem: `chart=${chartName} enriched=${enriched} failed=${failed}`,
      duracao_ms: Date.now() - start,
    });

    await reportCronHealth(supabase, {
      job_name: "sync-spotify-editorial-charts",
      status: failed === 0 ? "ok" : (enriched === 0 ? "error" : "partial"),
      startedAt: start,
      metrics: { chart: chartName, date: today, enriched, failed },
    });

    return jr({ ok: true, chart: chartName, date: today, enriched, failed });
  } catch (e) {
    const msg = (e as Error).message;
    await supabase.from("collection_logs").insert({
      acao: "sync-spotify-editorial-charts",
      status: "erro",
      mensagem: msg.slice(0, 500),
      duracao_ms: Date.now() - start,
    });
    await reportCronHealth(supabase, {
      job_name: "sync-spotify-editorial-charts",
      status: "error",
      startedAt: start,
      message: msg,
    });
    return jr({ ok: false, error: msg }, 500);
  }
});
