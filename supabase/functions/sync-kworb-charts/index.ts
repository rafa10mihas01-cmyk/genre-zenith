// Scraping do Top 200 BR diário do kworb.net → raw_chart_daily
// + auto-calibração da chart_position_benchmarks
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { reportCronHealth } from "../_shared/cron-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const KWORB_URL = "https://kworb.net/spotify/country/br_daily.html";

interface Row {
  position: number;
  artist: string | null;
  track: string | null;
  streams_day: number;
  streams_total: number | null;
  spotify_track_id: string | null;
  spotify_artist_id: string | null;
}

function parseHtml(html: string): { date: string | null; rows: Row[] } {
  // Data do chart: tenta <title>, depois <h1>/<h2>, depois fallback hoje (UTC)
  const dateRegex = /(\d{4})[\/\-](\d{2})[\/\-](\d{2})/;
  const titleMatch = (html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "").match(dateRegex);
  const headingMatch = (html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i)?.[1] ?? "").match(dateRegex);
  const found = titleMatch ?? headingMatch;
  const date = found
    ? `${found[1]}-${found[2]}-${found[3]}`
    : new Date().toISOString().slice(0, 10);

  const rows: Row[] = [];
  // Cada linha do chart: <tr>...<td>pos</td><td>artista - track</td><td>streams_day</td>...<td>total</td></tr>
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRegex.exec(html))) {
    const tr = m[1];
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x => x[1]);
    // Colunas kworb: Pos | P+ | Title | Days | Pk | (x?) | Streams | Streams+ | 7Day | 7Day+ | Total
    if (tds.length < 11) continue;

    const pos = parseInt(stripTags(tds[0]).trim(), 10);
    if (!Number.isFinite(pos) || pos < 1 || pos > 200) continue;

    const songCell = tds[2];
    const songText = stripTags(songCell).replace(/\s+/g, " ").trim();
    const dashIdx = songText.indexOf(" - ");
    const artist = dashIdx > 0 ? songText.slice(0, dashIdx).trim() : null;
    let track = dashIdx > 0 ? songText.slice(dashIdx + 3).trim() : songText;
    // remove "(w/ ...)" do título
    track = track.replace(/\s*\(w\/[^)]*\)\s*$/i, "").trim();

    const artistIdMatch = songCell.match(/\/artist\/([A-Za-z0-9]{10,})\.html/);
    const trackIdMatch = songCell.match(/\/track\/([A-Za-z0-9]{10,})\.html/);

    const streamsDay = parseNumber(tds[6]);
    const streamsTotal = parseNumber(tds[10]) || null;

    rows.push({
      position: pos,
      artist,
      track,
      streams_day: streamsDay,
      streams_total: streamsTotal,
      spotify_track_id: trackIdMatch?.[1] ?? null,
      spotify_artist_id: artistIdMatch?.[1] ?? null,
    });
  }

  // Deduplica por posição (mantém primeira)
  const seen = new Set<number>();
  const unique = rows.filter(r => {
    if (seen.has(r.position)) return false;
    seen.add(r.position);
    return true;
  }).sort((a, b) => a.position - b.position);

  return { date, rows: unique };
}

function stripTags(s: string) {
  return s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function parseNumber(s: string): number {
  const clean = stripTags(s).replace(/[,\.\s]/g, "");
  const n = parseInt(clean, 10);
  return Number.isFinite(n) ? n : 0;
}

async function recalibrateBenchmarks(supabase: any, chartDate: string) {
  const buckets: Array<[number, number, string]> = [
    [1, 10, "1-10"],
    [11, 30, "11-30"],
    [31, 50, "31-50"],
    [51, 100, "51-100"],
    [101, 150, "101-150"],
    [151, 200, "151-200"],
  ];
  const { data } = await supabase
    .from("raw_chart_daily")
    .select("position, streams_day")
    .eq("chart_name", "top200_br")
    .eq("chart_date", chartDate);
  if (!data || !data.length) return;

  const benchmarkRows = [];
  for (const [from, to] of buckets) {
    const inRange = data.filter((r: any) => r.position >= from && r.position <= to);
    if (!inRange.length) continue;
    // Média por posição dentro do bucket
    const byPos = new Map<number, number>();
    for (const r of inRange) byPos.set(r.position, r.streams_day);
    for (const [pos, streams] of byPos) {
      benchmarkRows.push({
        position: pos,
        streams_day: streams,
        database: "br",
        captured_at: chartDate,
      });
    }
  }
  if (benchmarkRows.length) {
    await supabase.from("chart_position_benchmarks").upsert(benchmarkRows, {
      onConflict: "position,database,captured_at",
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const res = await fetch(KWORB_URL, {
      headers: { "User-Agent": "NexEngineBot/1.0 (+https://nexcreatorx.com)" },
    });
    if (!res.ok) throw new Error(`kworb HTTP ${res.status}`);
    const html = await res.text();

    const { date, rows } = parseHtml(html);
    if (rows.length < 50) {
      throw new Error(`Parse falhou: rows=${rows.length}`);
    }

    const payload = rows.map(r => ({
      chart_name: "top200_br",
      chart_date: date,
      source: "kworb",
      ...r,
    }));

    const { error } = await supabase
      .from("raw_chart_daily")
      .upsert(payload, { onConflict: "chart_name,chart_date,position" });
    if (error) throw error;

    await recalibrateBenchmarks(supabase, date);

    return new Response(
      JSON.stringify({ ok: true, date, rows: rows.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("sync-kworb-charts", e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
