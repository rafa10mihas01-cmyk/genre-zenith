// ============================================================================
// catalog-repositioner
// ----------------------------------------------------------------------------
// Reposiciona o PASSIVO de placements que caíram no fim das playlists antes
// da nova regra de posicionamento (04/07/2026). Roda em lote pequeno para
// evitar bloqueio do Spotify.
//
// Fluxo por placement:
//   1) Descobre o índice atual da faixa na playlist (Spotify).
//   2) Calcula o índice-alvo via fn_compute_catalog_target_position.
//   3) Reordena via PUT /items (range_start → insert_before) se necessário.
//   4) Persiste catalog_placements.position + repositioned_at.
//
// Body opcional: { limit?: number, delay_ms?: number }
// ============================================================================
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAppToken, getUserToken, setSpotifyCtx } from "../_shared/spotify-client.ts";
import {
  listPlaylistTrackRefs,
  reorderPlaylistTracks,
  findPlaylistTrackIndex,
} from "../_shared/spotify-playlist.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const jr = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = {
  id: string;
  catalog_track_id: string;
  managed_playlist_id: string;
  attempts: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let limit = 5;
  let delayMs = 800;
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (typeof body?.limit === "number") limit = Math.max(1, Math.min(20, body.limit));
    if (typeof body?.delay_ms === "number") delayMs = Math.max(0, Math.min(5000, body.delay_ms));
  } catch (_) { /* noop */ }

  const workerId = `repos-${crypto.randomUUID().slice(0, 8)}`;
  const t0 = Date.now();

  const { data: claimed, error: claimErr } = await supabase.rpc(
    "claim_next_catalog_repositions",
    { _worker: workerId, _limit: limit },
  );
  if (claimErr) return jr({ ok: false, error: `claim_failed: ${claimErr.message}` }, 500);

  const rows: Row[] = (claimed ?? []).map((r: any) => ({
    id: r.id,
    catalog_track_id: r.catalog_track_id,
    managed_playlist_id: r.managed_playlist_id,
    attempts: r.attempts ?? 0,
  }));
  if (rows.length === 0) {
    return jr({ ok: true, worker_id: workerId, claimed: 0, duration_ms: Date.now() - t0 });
  }

  const trackIds = Array.from(new Set(rows.map((r) => r.catalog_track_id)));
  const playlistIds = Array.from(new Set(rows.map((r) => r.managed_playlist_id)));

  const [{ data: tracks }, { data: playlists }, { data: campaignsActive }] = await Promise.all([
    supabase.from("catalog_tracks").select("id, spotify_track_id").in("id", trackIds),
    supabase.from("managed_playlists")
      .select("id, spotify_playlist_id, owner_spotify_user_id, tracks_count, operational_status, execution_mode")
      .in("id", playlistIds),
    supabase.from("campaigns").select("catalog_track_id").in("catalog_track_id", trackIds).eq("status", "active"),
  ]);

  const tMap = new Map<string, any>();
  for (const t of tracks ?? []) tMap.set(t.id, t);
  const pMap = new Map<string, any>();
  for (const p of playlists ?? []) pMap.set(p.id, p);
  const activeCampaigns = new Set<string>();
  for (const c of campaignsActive ?? []) if ((c as any).catalog_track_id) activeCampaigns.add((c as any).catalog_track_id);

  const tokenCache = new Map<string, string>();
  async function tokenFor(owner: string | null): Promise<string> {
    const key = owner ?? "__app__";
    const cached = tokenCache.get(key);
    if (cached) return cached;
    const tok = owner ? (await getUserToken(owner)).token : await getAppToken();
    tokenCache.set(key, tok);
    return tok;
  }

  let cntOk = 0, cntSkip = 0, cntErr = 0, cntNoop = 0;
  const details: any[] = [];

  for (const r of rows) {
    const t = tMap.get(r.catalog_track_id);
    const p = pMap.get(r.managed_playlist_id);
    if (!t?.spotify_track_id || !p?.spotify_playlist_id) {
      await supabase.from("catalog_placements").update({
        reposition_attempts: r.attempts + 1,
        reposition_last_error: "enrich_missing",
        locked_at: null, locked_by: null, lease_expires_at: null,
      }).eq("id", r.id);
      cntSkip++; continue;
    }
    if (p.operational_status === "do_not_operate" || p.execution_mode === "MANUAL_ONLY" || p.execution_mode === "DISABLED") {
      await supabase.from("catalog_placements").update({
        repositioned_at: new Date().toISOString(), // sai da fila
        reposition_last_error: "playlist_not_operable",
        locked_at: null, locked_by: null, lease_expires_at: null,
      }).eq("id", r.id);
      cntSkip++; continue;
    }

    try {
      setSpotifyCtx({
        appId: null,
        playlist_id: r.managed_playlist_id,
        owner_id: p.owner_spotify_user_id ?? null,
        spotify_user_id: p.owner_spotify_user_id ?? null,
        function_name: "catalog-repositioner",
      });
      const token = await tokenFor(p.owner_spotify_user_id ?? null);

      // 1) Índice atual
      const refs = await listPlaylistTrackRefs(p.spotify_playlist_id, token);
      const currentIdx = findPlaylistTrackIndex(refs, t.spotify_track_id);
      if (currentIdx < 0) {
        await supabase.from("catalog_placements").update({
          repositioned_at: new Date().toISOString(),
          reposition_last_error: "track_not_in_playlist",
          locked_at: null, locked_by: null, lease_expires_at: null,
        }).eq("id", r.id);
        cntSkip++;
        details.push({ id: r.id, status: "not_present" });
        await sleep(delayMs);
        continue;
      }

      // 2) Índice-alvo
      const { data: posData, error: posErr } = await supabase.rpc(
        "fn_compute_catalog_target_position",
        {
          _managed_playlist_id: r.managed_playlist_id,
          _spotify_track_id: t.spotify_track_id,
          _is_campaign_active: activeCampaigns.has(r.catalog_track_id),
        },
      );
      if (posErr || !Array.isArray(posData) || posData.length === 0) {
        throw new Error(`pos_rpc: ${posErr?.message ?? "empty"}`);
      }
      const targetIdx = Math.max(0, Math.min(Number((posData[0] as any).slot_position ?? 0), refs.length - 1));
      const reason = String((posData[0] as any).reason ?? "");

      // 3) Reorder (se preciso). insert_before pula a própria faixa quando
      // targetIdx está depois de currentIdx.
      if (targetIdx !== currentIdx) {
        // === PROTEÇÃO DE CAMPANHA (04/07/2026) =============================
        // O reorder do Spotify desloca todas as faixas no intervalo entre
        // range_start e insert_before. Se qualquer faixa de campanha (ativa
        // ou pausada) estiver nesse intervalo, ela seria movida — o que
        // viola a autoridade da Campaign Engine. Nesse caso, abortamos o
        // reorder e mantemos a faixa do catálogo onde está.
        const lo = Math.min(currentIdx, targetIdx);
        const hi = Math.max(currentIdx, targetIdx);
        const { data: campInRange } = await supabase
          .from("v_playlist_track_origin")
          .select("position, spotify_track_id")
          .eq("managed_playlist_id", r.managed_playlist_id)
          .eq("origin", "Campaign")
          .gte("position", lo)
          .lte("position", hi)
          .limit(1)
          .maybeSingle();
        if (campInRange) {
          await supabase.from("catalog_placements").update({
            repositioned_at: new Date().toISOString(),
            reposition_last_error: `campaign_track_in_range pos=${(campInRange as any).position}`,
            locked_at: null, locked_by: null, lease_expires_at: null,
          }).eq("id", r.id);
          await supabase.from("catalog_placement_execution_log").insert({
            placement_id: r.id,
            catalog_track_id: r.catalog_track_id,
            managed_playlist_id: r.managed_playlist_id,
            spotify_playlist_id: p.spotify_playlist_id,
            spotify_track_id: t.spotify_track_id,
            position: currentIdx,
            outcome: "skip",
            error_code: "campaign_track_in_range",
            error_message: `range=[${lo},${hi}] blocked_by=${(campInRange as any).spotify_track_id}`,
            snapshot_id: null,
            position_reason: reason,
          }).select().maybeSingle().then(() => {}, () => {});
          cntSkip++;
          details.push({ id: r.id, from: currentIdx, to: targetIdx, skipped: "campaign_track_in_range" });
          await sleep(delayMs);
          continue;
        }

        const insertBefore = targetIdx > currentIdx ? targetIdx + 1 : targetIdx;
        await reorderPlaylistTracks(p.spotify_playlist_id, {
          range_start: currentIdx,
          insert_before: insertBefore,
          range_length: 1,
        }, token);
      }

      // 4) Persistência
      await supabase.from("catalog_placements").update({
        position: targetIdx,
        repositioned_at: new Date().toISOString(),
        reposition_attempts: r.attempts + 1,
        reposition_last_error: null,
        locked_at: null, locked_by: null, lease_expires_at: null,
      }).eq("id", r.id);

      // Log de auditoria (opcional, best-effort)
      await supabase.from("catalog_placement_execution_log").insert({
        placement_id: r.id,
        catalog_track_id: r.catalog_track_id,
        managed_playlist_id: r.managed_playlist_id,
        spotify_playlist_id: p.spotify_playlist_id,
        spotify_track_id: t.spotify_track_id,
        position: targetIdx,
        outcome: "reposition",
        error_code: null,
        error_message: `from=${currentIdx} to=${targetIdx}`,
        snapshot_id: null,
        position_reason: reason,
      }).select().maybeSingle().then(() => {}, () => {});

      if (targetIdx === currentIdx) cntNoop++; else cntOk++;
      details.push({ id: r.id, from: currentIdx, to: targetIdx, reason });
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 400);
      const status = typeof e?.status === "number" ? e.status : null;
      const nextAttempts = r.attempts + 1;
      const giveUp = nextAttempts >= 5 || status === 404 || status === 403;
      await supabase.from("catalog_placements").update({
        reposition_attempts: nextAttempts,
        reposition_last_error: `${status ?? "exc"}: ${msg}`,
        repositioned_at: giveUp ? new Date().toISOString() : null,
        locked_at: null, locked_by: null, lease_expires_at: null,
      }).eq("id", r.id);
      cntErr++;
      details.push({ id: r.id, error: msg, status });
    }

    await sleep(delayMs);
  }

  return jr({
    ok: true,
    worker_id: workerId,
    claimed: rows.length,
    repositioned: cntOk,
    noop: cntNoop,
    skipped: cntSkip,
    errors: cntErr,
    duration_ms: Date.now() - t0,
    details,
  });
});
