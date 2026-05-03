// bot-ingest-snapshot — Recebe coleta do bot e grava via record_curator_deal_capture.
// Auth: header x-bot-key.
// POST { song_id, deal_id, total_plays, snapshots: [{playlist_name, spotify_url, plays, source?}], note?, print_urls? }
import { createClient } from "npm:@supabase/supabase-js@2";

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

  // Caso de erro reportado pelo bot (sessão expirada, captcha, etc)
  if (bot_error) {
    await supabase
      .from("curator_deal_songs")
      .update({
        auto_collect_status: bot_error === "auth_required" ? "auth_required" : "error",
        auto_collect_error: String(bot_error).slice(0, 500),
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

  let inserted = 0;
  let skipped = 0;
  for (const snap of snapshots) {
    const sUrl = snap.spotify_url ?? "";
    const sName = snap.playlist_name ?? null;
    const sId = extractId(sUrl);
    const plays = Math.max(0, parseInt(String(snap.plays ?? 0)) || 0);

    // Busca playlist existente
    let playlistId: string | null = null;
    if (sId) {
      const { data } = await supabase
        .from("curator_playlists")
        .select("id")
        .eq("deal_id", deal_id)
        .eq("spotify_playlist_id", sId)
        .maybeSingle();
      playlistId = data?.id ?? null;
    }
    if (!playlistId && sName) {
      const { data } = await supabase
        .from("curator_playlists")
        .select("id")
        .eq("deal_id", deal_id)
        .ilike("playlist_name", sName)
        .maybeSingle();
      playlistId = data?.id ?? null;
    }

    // Se não existe, cria
    if (!playlistId) {
      const { data: created, error: cErr } = await supabase
        .from("curator_playlists")
        .insert({
          deal_id,
          song_id,
          spotify_url: sUrl,
          spotify_playlist_id: sId,
          playlist_name: sName ?? "Sem nome",
          followers: snap.followers ?? null,
        })
        .select("id")
        .single();
      if (cErr) { skipped++; continue; }
      playlistId = created.id;
    }

    const { error: insErr } = await supabase.from("curator_deal_snapshots").insert({
      deal_id,
      song_id,
      playlist_id: playlistId,
      plays,
      source: snap.source ?? "spotify_for_artists",
      match_method: sId ? "spotify_id" : "name",
      is_baseline: isBaseline,
    });
    if (insErr) skipped++; else inserted++;
  }

  // Log do total na tabela curator_deal_logs
  if (typeof total_plays === "number") {
    await supabase.from("curator_deal_logs").insert({
      deal_id,
      song_id,
      total_plays: Math.max(0, total_plays),
      note: note ?? `[bot] auto-collect`,
      print_urls: print_urls ?? [],
      is_baseline: false,
    });
  }

  // Atualiza song com next_auto_collect_at
  const { data: songRow } = await supabase
    .from("curator_deal_songs")
    .select("auto_collect_interval_minutes")
    .eq("id", song_id)
    .single();
  const intervalMin = songRow?.auto_collect_interval_minutes ?? 120;
  const nextAt = new Date(Date.now() + intervalMin * 60_000).toISOString();

  const updatePayload: Record<string, unknown> = {
    auto_collect_status: "idle",
    auto_collect_error: null,
    last_auto_collect_at: new Date().toISOString(),
    next_auto_collect_at: nextAt,
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
    mensagem: `song=${song_id} inserted=${inserted} skipped=${skipped}`,
  });

  return jr({ ok: true, inserted, skipped, next_auto_collect_at: nextAt });
});
