// bot-ingest-snapshot — Recebe coleta do bot e grava via record_curator_deal_capture.
// Auth: header x-bot-key.
// POST { song_id, deal_id, total_plays, snapshots: [{playlist_name, spotify_url, plays, source?}], note?, print_urls? }
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertDealOperable } from "../_shared/deal-access.ts";
import { recordMetric } from "../_shared/ops-metrics.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-bot-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  const t0 = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);

  if (req.headers.get("x-bot-key") !== BOT_API_KEY) {
    return jr({ error: "unauthorized" }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch { return jr({ error: "invalid_json" }, 400); }

  const { song_id, deal_id, total_plays, snapshots, note, print_urls, print_taken, error: bot_error } = body ?? {};
  if (!deal_id || !song_id) return jr({ error: "deal_id and song_id required" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // ====== Gate de ciclo de vida (Fase 5B) ======
  // Bloqueia ingestão se o deal estiver fechado/pausado/completed/token revogado.
  {
    const { data: dealRow } = await supabase
      .from("curator_deals")
      .select("id, state, closed_at, token_revoked_at, token_expires_at")
      .eq("id", deal_id)
      .maybeSingle();
    const gate = assertDealOperable(dealRow as any);
    if (!gate.ok) {
      await supabase
        .from("curator_deal_songs")
        .update({
          auto_collect_status: "idle",
          auto_collect_error: gate.error,
          next_auto_collect_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          queued_at: null,
        })
        .eq("id", song_id);
      return jr({ ok: false, error: gate.error, code: gate.code, gated: true }, gate.status);
    }
  }


  if (bot_error) {
    await supabase
      .from("curator_deal_songs")
      .update({
        auto_collect_status: bot_error === "auth_required" ? "auth_required" : "error",
        auto_collect_error: String(bot_error).slice(0, 500),
        queued_at: null,
      })
      .eq("id", song_id);

    await supabase.from("collection_logs").insert({
      acao: "bot_collect",
      status: "error",
      mensagem: `song=${song_id} error=${bot_error}`,
    });

    if (bot_error === "auth_required") {
      await supabase.rpc("create_notification", {
        p_type: "warning",
        p_title: "Bot Spotify precisa reautenticar",
        p_message: "A sessão do Spotify for Artists expirou. Refaça o login no servidor do bot.",
        p_action_url: "/playlist-deals",
        p_metadata: { song_id, deal_id },
      });
    }
    return jr({ ok: true, recorded_error: true });
  }

  // Resolve user_id do dono do deal pra impersonar via service role (record_curator_deal_capture exige auth.uid())
  // -> Como o RPC usa auth.uid(), e estamos com service role, precisamos inserir direto.
  // Vamos inserir snapshot via insert direto (não usa RPC pra evitar precisar de JWT).

  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return jr({ error: "snapshots required" }, 400);
  }

  // Dedupe: se já existe log dessa song nos últimos 90s, ignora (evita coleta duplicada
  // quando o cron e o "forçar coleta" disparam quase juntos)
  {
    const since = new Date(Date.now() - 90_000).toISOString();
    const { data: recent } = await supabase
      .from("curator_deal_logs")
      .select("id, created_at")
      .eq("song_id", song_id)
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length > 0) {
      const { data: songRow } = await supabase
        .from("curator_deal_songs")
        .select("auto_collect_interval_minutes")
        .eq("id", song_id)
        .single();
      const intervalMin = songRow?.auto_collect_interval_minutes ?? 1440;
      const nextAt = new Date(Date.now() + intervalMin * 60_000).toISOString();
      // Atualiza status pra não ficar travado em "queued"
      await supabase
        .from("curator_deal_songs")
        .update({
          auto_collect_status: "idle",
          auto_collect_error: null,
          last_auto_collect_at: new Date().toISOString(),
          next_auto_collect_at: nextAt,
          queued_at: null,
        })
        .eq("id", song_id);
      return jr({ ok: true, deduped: true, reason: "log within 90s exists" });
    }
  }

  // Detecta se essa é a PRIMEIRA coleta dessa song → marca como baseline
  const { count: existingLogs } = await supabase
    .from("curator_deal_logs")
    .select("id", { count: "exact", head: true })
    .eq("song_id", song_id);
  const isBaseline = (existingLogs ?? 0) === 0;

  // Para cada snapshot, achar/criar curator_playlist e inserir snapshot.
  // Função utilitária inline pra extrair playlist id do url.
  const extractId = (url: string | null | undefined) => {
    if (!url) return null;
    const m = url.match(/playlist[/:]([a-zA-Z0-9]{16,})/);
    return m ? m[1] : null;
  };

  // Dedupe dentro do lote (bot manda mesma playlist em vários scrolls)
  const scoreSnap = (x: any) =>
    (x.plays_24h != null ? 1 : 0) +
    (x.plays_7d  != null ? 1 : 0) +
    (x.plays_28d != null ? 1 : 0) +
    (x.plays     != null ? 1 : 0) +
    (x.followers != null ? 1 : 0);
  const dedupMap = new Map<string, any>();
  for (const s of snapshots) {
    const key = extractId(s.spotify_url) ?? `name:${String(s.playlist_name ?? "").trim().toLowerCase()}`;
    if (!key) continue;
    const prev = dedupMap.get(key);
    if (!prev || scoreSnap(s) > scoreSnap(prev)) dedupMap.set(key, s);
  }
  const dedupedSnapshots = Array.from(dedupMap.values());
  const dedupedOut = snapshots.length - dedupedSnapshots.length;

  let inserted = 0;
  let skipped = 0;
  for (const snap of dedupedSnapshots) {
    const sUrl = snap.spotify_url ?? "";
    const sName = snap.playlist_name ?? null;
    const sId = extractId(sUrl);
    // Janelas (novo contrato). Se o bot só mandar `plays` (legado), assumimos 7d.
    const toInt = (v: unknown) => {
      const n = parseInt(String(v ?? "")) || 0;
      return n > 0 ? n : 0;
    };
    const plays24h = snap.plays_24h != null ? toInt(snap.plays_24h) : null;
    const plays7d  = snap.plays_7d  != null ? toInt(snap.plays_7d)  : (snap.plays != null ? toInt(snap.plays) : null);
    const plays28d = snap.plays_28d != null ? toInt(snap.plays_28d) : null;
    // Para o campo legado `plays` (não-nulo no schema): janela oficial agora é 7d.
    // Fallback: 7d → 28d → 24h (compat com payloads antigos) → 0.
    const plays = plays7d ?? plays28d ?? plays24h ?? 0;

    // Match robusto via RPC: spotify_id → nome normalizado → fuzzy ≥0.6
    let playlistId: string | null = null;
    let matchMethod: string | null = null;
    {
      const { data: matchData } = await supabase.rpc("match_curator_playlist", {
        p_deal_id: deal_id,
        p_spotify_playlist_id: sId,
        p_playlist_name: sName,
      });
      const row = Array.isArray(matchData) ? matchData[0] : null;
      if (row?.playlist_id) {
        playlistId = row.playlist_id as string;
        matchMethod = (row.match_method as string) ?? null;
      }
    }

    // Se não encontrou: NÃO cria nova playlist. Loga + notifica + pula.
    if (!playlistId) {
      const ref = sId ?? sName ?? "unknown";
      await supabase.from("collection_logs").insert({
        acao: "no_match",
        status: "alerta",
        mensagem: `[WARN] no_match: playlist ${ref} not registered in deal ${deal_id}`,
      });
      await supabase.rpc("create_notification", {
        p_type: "playlist_nao_identificada",
        p_title: "Playlist não identificada no deal",
        p_message: `Playlist não cadastrada no deal — verificar manualmente: ${ref}`,
        p_action_url: `/playlist-deals/${deal_id}`,
        p_metadata: { deal_id, song_id, spotify_playlist_id: sId, playlist_name: sName },
      });
      skipped++;
      continue;
    }


    // ===== FIX A: anti-spike / anti-drop validation =====
    let flagged = false;
    let flagReason: string | null = null;
    if (!isBaseline && plays > 0) {
      const { data: prevSnap } = await supabase
        .from("curator_deal_snapshots")
        .select("plays, captured_at")
        .eq("song_id", song_id)
        .eq("playlist_id", playlistId)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const prevPlays = Number(prevSnap?.plays ?? 0);
      if (prevPlays > 0) {
        if (plays < prevPlays * 0.5) {
          flagged = true;
          flagReason = `plays_decrease: ${plays} < ${prevPlays} * 0.5`;
        } else if (plays > prevPlays * 10) {
          flagged = true;
          flagReason = `plays_spike: ${plays} > ${prevPlays} * 10`;
        }
        if (flagged) {
          await supabase.from("collection_logs").insert({
            acao: "bot_collect",
            status: "alerta",
            mensagem: `flag song=${song_id} playlist=${playlistId} ${flagReason}`,
          });
          await supabase.rpc("create_notification", {
            p_type: "warning",
            p_title: "Snapshot suspeito detectado",
            p_message: `Deal ${deal_id}: ${flagReason}`,
            p_action_url: `/playlist-deals/${deal_id}`,
            p_metadata: { deal_id, song_id, playlist_id: playlistId, plays, prev_plays: prevPlays },
          });
        }
      }
    }

    const { error: insErr } = await supabase.from("curator_deal_snapshots").insert({
      deal_id,
      song_id,
      playlist_id: playlistId,
      plays,
      plays_24h: plays24h,
      plays_7d:  plays7d,
      plays_28d: plays28d,
      source: snap.source ?? "spotify_for_artists",
      match_method: matchMethod ?? (sId ? "spotify_id" : "name"),
      is_baseline: isBaseline,
      flagged,
      flag_reason: flagReason,
    });
    if (insErr) skipped++; else inserted++;
  }

  // Se for baseline, persiste blacklist de playlists do deal.
  if (isBaseline) {
    const { data: allPls } = await supabase
      .from("curator_playlists")
      .select("spotify_playlist_id, playlist_name, song_id")
      .eq("deal_id", deal_id)
      .eq("song_id", song_id)
      .not("spotify_playlist_id", "is", null);
    const rows = (allPls ?? [])
      .filter((p: any) => p.spotify_playlist_id && !String(p.spotify_playlist_id).startsWith("algo:"))
      .map((p: any) => ({
        deal_id,
        song_id,
        spotify_playlist_id: p.spotify_playlist_id,
        playlist_name: p.playlist_name ?? null,
      }));
    if (rows.length > 0) {
      await supabase
        .from("curator_deal_baseline_playlists")
        .upsert(rows, { onConflict: "deal_id,song_id,spotify_playlist_id", ignoreDuplicates: true });
    }
  }

  // Log do total na tabela curator_deal_logs.
  // Se total_plays vier ausente ou zero, calcula automaticamente somando snapshots[].plays.
  const computedTotal =
    typeof total_plays === "number" && total_plays > 0
      ? total_plays
      : snapshots.reduce(
          (acc: number, s: any) => acc + Math.max(0, parseInt(String(s.plays ?? 0)) || 0),
          0,
        );

  await supabase.from("curator_deal_logs").insert({
    deal_id,
    song_id,
    total_plays: Math.max(0, computedTotal),
    note: note ?? (isBaseline ? `[bot] baseline inicial` : `[bot] auto-collect`),
    print_urls: print_urls ?? [],
    is_baseline: isBaseline,
  });

  // Atualiza song com next_auto_collect_at
  const { data: songRow } = await supabase
    .from("curator_deal_songs")
    .select("auto_collect_interval_minutes, queued_at")
    .eq("id", song_id)
    .single();
  const intervalMin = songRow?.auto_collect_interval_minutes ?? 120;
  const nextAt = new Date(Date.now() + intervalMin * 60_000).toISOString();
  const queueAgeMs = (songRow as any)?.queued_at ? Date.now() - new Date((songRow as any).queued_at).getTime() : null;

  const updatePayload: Record<string, unknown> = {
    auto_collect_status: "idle",
    auto_collect_error: null,
    last_auto_collect_at: new Date().toISOString(),
    next_auto_collect_at: nextAt,
    queued_at: null,
  };
  if (print_taken === true) {
    updatePayload.last_print_at = new Date().toISOString();
  }

  await supabase
    .from("curator_deal_songs")
    .update(updatePayload)
    .eq("id", song_id);

  await supabase.from("collection_logs").insert({
    acao: "bot_collect",
    status: skipped > 0 ? "parcial" : "ok",
    mensagem: `song=${song_id} inserted=${inserted} skipped=${skipped} deduped_in_batch=${dedupedOut}`,
  });

  recordMetric(supabase, {
    scope: "bot",
    operation: "bot-ingest-snapshot",
    status: skipped > 0 ? "partial" : "success",
    duration_ms: Date.now() - t0,
    deal_id,
    song_id,
    metadata: { inserted, skipped, queue_age_ms: queueAgeMs },
  });

  return jr({ ok: true, inserted, skipped, deduped_in_batch: dedupedOut, next_auto_collect_at: nextAt });
});
