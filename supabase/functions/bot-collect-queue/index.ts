// bot-collect-queue — Devolve fila de campanhas com auto_collect=true prontas pra coletar.
// Auth: header x-bot-key (compara com env BOT_API_KEY).
// GET ?limit=5
import { createClient } from "npm:@supabase/supabase-js@2";
import { recordMetric } from "../_shared/ops-metrics.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-bot-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.headers.get("x-bot-key") !== BOT_API_KEY) {
    return jr({ error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "5"), 1), 20);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Recovery de handoff: se a música ficou "queued" por mais de 3 min sem o bot
  // devolver print/snapshot, assumimos que a entrega se perdeu antes da AI/print.
  // Isso NÃO muda o ciclo diário; só reentrega tentativa travada de baseline/coleta.
  const handoffTimeoutAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  await supabase
    .from("curator_deal_songs")
    .update({
      auto_collect_status: "error",
      auto_collect_error: "Queued >3min sem retorno do bot — reentregando",
    })
    .eq("auto_collect_status", "queued")
    .lt("updated_at", handoffTimeoutAgo);

  // Candidatas: auto_collect=true E (next_auto_collect_at <= now OR next null)
  // E (status idle OU error) — não pega running/queued
  // E deal não fechado/pausado (state ∈ {awaiting_playlists, collecting, active})
  const { data, error } = await supabase
    .from("curator_deal_songs")
    .select(`
      id, deal_id, song_name, song_artist, artist_candidates, song_spotify_url, spotify_track_id,
      auto_collect_status, last_auto_collect_at, next_auto_collect_at,
      auto_collect_interval_minutes, last_print_at,
      curator_deals!inner ( id, curator_name, song_name, user_id, closed_at, state, token_revoked_at, token_expires_at ),
      curator_playlists ( id, playlist_name, spotify_url, spotify_playlist_id )
    `)
    .eq("auto_collect", true)
    .in("auto_collect_status", ["idle", "error"])
    .is("curator_deals.closed_at", null)
    .is("curator_deals.token_revoked_at", null)
    .in("curator_deals.state", ["awaiting_playlists", "collecting", "active"])
    .or(`next_auto_collect_at.is.null,next_auto_collect_at.lte.${new Date().toISOString()}`)
    .order("next_auto_collect_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) return jr({ error: error.message }, 500);

  // 🔒 BLINDAGEM: só coleta se o deal já tem playlists do curador cadastradas
  // (com spotify_playlist_id e não-algorítmicas). Sem whitelist, não roda.
  // Pós-filtro: token_expires_at no passado também desqualifica
  const nowMs = Date.now();
  const candidates = (data ?? []).filter((s: any) => {
    const exp = s?.curator_deals?.token_expires_at;
    if (!exp) return true;
    const t = new Date(exp).getTime();
    return !Number.isFinite(t) || t > nowMs;
  });
  const dealIds = Array.from(new Set(candidates.map((s: any) => s.deal_id)));
  const dealsWithWhitelist = new Set<string>();
  if (dealIds.length) {
    const { data: wl } = await supabase
      .from("curator_playlists")
      .select("deal_id")
      .in("deal_id", dealIds)
      .eq("match_status", "curator")
      .not("spotify_playlist_id", "is", null);
    for (const r of wl ?? []) dealsWithWhitelist.add((r as any).deal_id);
  }

  const eligible = candidates.filter((s: any) => dealsWithWhitelist.has(s.deal_id));
  const blocked = candidates.filter((s: any) => !dealsWithWhitelist.has(s.deal_id));

  // Marca songs sem whitelist com status informativo (não polui logs nem fica 'idle' eterno)
  if (blocked.length) {
    await supabase
      .from("curator_deal_songs")
      .update({
        auto_collect_status: "idle",
        auto_collect_error: "Aguardando curador cadastrar playlists",
        next_auto_collect_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      })
      .in("id", blocked.map((s: any) => s.id));

    // Notifica 1x por deal (dedupe 24h via metadata.kind + deal_id)
    const blockedDealIds = Array.from(new Set(blocked.map((s: any) => s.deal_id)));
    const dayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    for (const dId of blockedDealIds) {
      const deal = blocked.find((s: any) => s.deal_id === dId)?.curator_deals as any;
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .gte("created_at", dayAgo)
        .contains("metadata", { kind: "no_whitelist", deal_id: dId });
      if ((count ?? 0) > 0) continue;
      try {
        await supabase.rpc("create_notification" as any, {
          p_type: "warning",
          p_title: "Curador sem playlists cadastradas",
          p_message: `${deal?.curator_name ?? "Curador"} ainda não cadastrou playlists para "${deal?.song_name ?? "a faixa"}". Coleta pausada.`,
          p_action_url: `/playlist-deals?deal=${dId}`,
          p_metadata: { kind: "no_whitelist", deal_id: dId },
        });
      } catch (_) { /* ignore */ }
    }
  }

  // Marca elegíveis como queued para evitar dupla execução
  const ids = eligible.map((s: any) => s.id);
  if (ids.length) {
    await supabase
      .from("curator_deal_songs")
      .update({
        auto_collect_status: "queued",
        auto_collect_error: "Entregue ao robô; aguardando print/snapshot",
      })
      .in("id", ids);
  }

  recordMetric(supabase, {
    scope: "collect",
    operation: "bot-collect-queue",
    status: "success",
    metadata: {
      queued: ids.length,
      blocked_no_whitelist: blocked.length,
      total_candidates: candidates.length,
    },
  });

  return jr({
    ok: true,
    count: ids.length,
    blocked_no_whitelist: blocked.length,
    queue: eligible,
  });
});
