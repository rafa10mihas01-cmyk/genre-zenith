// execution-planner — Compara campaign_allocations com a fila e enfileira ADDs faltantes.
// Idempotente via dedupe_key. Roda via pg_cron (1/min).
//
// Pacing anti-spam (3 camadas) aplicado no scheduled_for de cada job:
//   1. MIN_SPACING_MIN     — intervalo mínimo entre ADDs na mesma playlist
//   2. MAX_ADDS_PER_DAY    — cap diário de ADDs por playlist (dia em horário BR)
//   3. WINDOW [start,end)  — só agenda dentro da janela horária BR (UTC-3)
// + jitter de ±JITTER_MIN minutos pra não cravar horário batido.
import { createClient } from "npm:@supabase/supabase-js@2";
import { reportCronHealth } from "../_shared/cron-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// === Config de pacing ===
const RAMP_DAYS = 5;
const MIN_SPACING_MIN = 25;       // intervalo mínimo entre 2 ADDs na MESMA playlist
const MAX_ADDS_PER_DAY = 4;       // cap diário de ADDs por playlist
const WINDOW_START_HOUR_BR = 8;   // 08:00 BR (UTC-3)
const WINDOW_END_HOUR_BR = 22;    // 22:00 BR (exclusivo)
const JITTER_MIN = 7;             // ±7min de variação aleatória
const BR_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Hash determinístico simples pra seed de jitter (mesma chave sempre gera mesmo jitter)
function seededJitterMs(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const norm = ((h >>> 0) % 1000) / 1000; // 0..1
  return Math.round((norm * 2 - 1) * JITTER_MIN * 60_000);
}

// Retorna "YYYY-MM-DD" no fuso BR pra uma data UTC
function brDayKey(date: Date): string {
  const br = new Date(date.getTime() - BR_OFFSET_MS);
  return br.toISOString().slice(0, 10);
}

// Retorna a hora BR (0–23)
function brHour(date: Date): number {
  return new Date(date.getTime() - BR_OFFSET_MS).getUTCHours();
}

// Empurra a data pra dentro da janela [WINDOW_START, WINDOW_END) BR.
// Se cair antes do início → vai pro WINDOW_START do mesmo dia BR.
// Se cair em/depois do fim → vai pro WINDOW_START do dia BR seguinte.
function clampToWindow(date: Date): Date {
  const h = brHour(date);
  if (h >= WINDOW_START_HOUR_BR && h < WINDOW_END_HOUR_BR) return date;

  const br = new Date(date.getTime() - BR_OFFSET_MS);
  let dayShift = 0;
  if (h >= WINDOW_END_HOUR_BR) dayShift = 1;
  br.setUTCDate(br.getUTCDate() + dayShift);
  br.setUTCHours(WINDOW_START_HOUR_BR, 0, 0, 0);
  return new Date(br.getTime() + BR_OFFSET_MS);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1. Allocations elegíveis
  const { data: allocs, error: aErr } = await supabase
    .from("campaign_allocations")
    .select(`
      id, campaign_id, playlist_id, status, created_at,
      campaigns!inner ( id, status, spotify_track_id, started_at ),
      playlists!inner ( id, spotify_playlist_id, ownership )
    `)
    .in("status", ["approved", "active"])
    .in("campaigns.status", ["active", "running", "live"])
    .order("created_at", { ascending: true });

  if (aErr) return jr({ error: aErr.message }, 500);

  // 1b. Ramp-up de aquecimento (motor único, espalha no tempo)
  const now = Date.now();
  const byCampaign = new Map<string, any[]>();
  for (const a of allocs ?? []) {
    const arr = byCampaign.get(a.campaign_id) ?? [];
    arr.push(a);
    byCampaign.set(a.campaign_id, arr);
  }

  const candidates: any[] = [];
  for (const [, list] of byCampaign) {
    const startedAt = (list[0] as any).campaigns?.started_at;
    const startMs = startedAt ? new Date(startedAt).getTime() : now;
    const daysSinceStart = Math.max(0, Math.floor((now - startMs) / 86_400_000));
    const releasedFrac = Math.min(1, (daysSinceStart + 1) / RAMP_DAYS);
    const total = list.length;
    const releasedCount = Math.max(1, Math.ceil(total * releasedFrac));
    for (const a of list.slice(0, releasedCount)) {
      const trackId = (a as any).campaigns?.spotify_track_id;
      const plId = (a as any).playlists?.spotify_playlist_id;
      if (!trackId || !plId) continue;
      candidates.push({
        allocation_id: a.id,
        campaign_id: a.campaign_id,
        playlist_id: a.playlist_id,
        spotify_playlist_id: plId,
        spotify_track_id: trackId,
        dedupe_key: `add:${plId}:${trackId}`,
      });
    }
  }

  if (candidates.length === 0) return jr({ ok: true, enqueued: 0, considered: 0 });

  // 2. Filtra os que já têm job aberto/feito
  const dedupeKeys = candidates.map((c) => c.dedupe_key);
  const { data: existing } = await supabase
    .from("playlist_execution_jobs")
    .select("dedupe_key, status")
    .in("dedupe_key", dedupeKeys);

  const skip = new Set(
    (existing ?? [])
      .filter((e: any) => ["pending", "claimed", "failed", "done"].includes(e.status))
      .map((e: any) => e.dedupe_key),
  );

  const fresh = candidates.filter((c) => !skip.has(c.dedupe_key));
  if (fresh.length === 0) {
    return jr({ ok: true, enqueued: 0, considered: candidates.length });
  }

  // 3. Pacing: pra cada playlist envolvida, busca histórico recente pra
  //    calcular MIN_SPACING e CAP DIÁRIO.
  const playlistIds = Array.from(new Set(fresh.map((c) => c.spotify_playlist_id)));
  const since = new Date(now - 7 * 86_400_000).toISOString();
  const { data: history } = await supabase
    .from("playlist_execution_jobs")
    .select("spotify_playlist_id, scheduled_for, status")
    .in("spotify_playlist_id", playlistIds)
    .in("status", ["pending", "claimed", "done"])
    .gte("scheduled_for", since);

  // Por playlist: ordena scheduled_for asc e mantém contagem por dia BR
  const histByPl = new Map<string, Date[]>();
  for (const h of history ?? []) {
    const arr = histByPl.get((h as any).spotify_playlist_id) ?? [];
    arr.push(new Date((h as any).scheduled_for));
    histByPl.set((h as any).spotify_playlist_id, arr);
  }
  for (const [k, arr] of histByPl) {
    arr.sort((a, b) => a.getTime() - b.getTime());
    histByPl.set(k, arr);
  }

  // 4. Calcula scheduled_for de cada novo job e VAI ACUMULANDO no histByPl
  //    pra que candidatos posteriores na mesma rodada respeitem os anteriores.
  const toInsert: any[] = [];
  // Ordena candidatos por playlist pra distribuir de forma estável
  fresh.sort((a, b) =>
    a.spotify_playlist_id.localeCompare(b.spotify_playlist_id) ||
    a.dedupe_key.localeCompare(b.dedupe_key)
  );

  for (const c of fresh) {
    const hist = histByPl.get(c.spotify_playlist_id) ?? [];

    // Base: max(agora, último job dessa playlist + MIN_SPACING)
    let base = now;
    if (hist.length > 0) {
      const last = hist[hist.length - 1].getTime();
      base = Math.max(base, last + MIN_SPACING_MIN * 60_000);
    }
    let when = new Date(base);

    // Janela horária BR
    when = clampToWindow(when);

    // Cap diário: se o dia-BR alvo já tem MAX_ADDS_PER_DAY agendados,
    // empurra pro próximo dia 08:00 BR (e reaplica spacing se necessário).
    let safety = 0;
    while (safety++ < 14) {
      const dayKey = brDayKey(when);
      const sameDay = hist.filter((d) => brDayKey(d) === dayKey).length;
      if (sameDay < MAX_ADDS_PER_DAY) break;
      // Próximo dia 08:00 BR
      const br = new Date(when.getTime() - BR_OFFSET_MS);
      br.setUTCDate(br.getUTCDate() + 1);
      br.setUTCHours(WINDOW_START_HOUR_BR, 0, 0, 0);
      when = new Date(br.getTime() + BR_OFFSET_MS);
    }

    // Jitter determinístico (mesma key → mesmo offset; permite reproduzir)
    const jitter = seededJitterMs(c.dedupe_key);
    when = new Date(when.getTime() + jitter);
    // Reaplica clamp caso o jitter tenha cruzado a borda da janela
    when = clampToWindow(when);

    // Registra no histórico local pra próximos candidatos da mesma playlist
    hist.push(when);
    hist.sort((a, b) => a.getTime() - b.getTime());
    histByPl.set(c.spotify_playlist_id, hist);

    toInsert.push({
      job_type: "playlist.track.add",
      allocation_id: c.allocation_id,
      campaign_id: c.campaign_id,
      playlist_id: c.playlist_id,
      spotify_playlist_id: c.spotify_playlist_id,
      spotify_track_id: c.spotify_track_id,
      dedupe_key: c.dedupe_key,
      status: "pending",
      scheduled_for: when.toISOString(),
    });
  }

  if (toInsert.length === 0) {
    return jr({ ok: true, enqueued: 0, considered: candidates.length });
  }

  const { error: insErr, count } = await supabase
    .from("playlist_execution_jobs")
    .insert(toInsert, { count: "exact" });

  if (insErr) return jr({ error: insErr.message }, 500);

  return jr({
    ok: true,
    enqueued: count ?? toInsert.length,
    considered: candidates.length,
    pacing: {
      min_spacing_min: MIN_SPACING_MIN,
      max_adds_per_day: MAX_ADDS_PER_DAY,
      window_br: `${WINDOW_START_HOUR_BR}:00–${WINDOW_END_HOUR_BR}:00`,
      jitter_min: JITTER_MIN,
    },
  });
});
