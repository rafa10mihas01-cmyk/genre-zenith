// track-playlist-metrics — Coleta seguidores atuais via Spotify API
// para cada playlist publicada (playlist_templates com spotify_playlist_id).
// Salva snapshot em playlist_metrics_snapshots.
// POST { template_ids?: string[], limit?: number }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAppToken, forceRefreshAppToken } from "../_shared/spotify-client.ts";
import { requireTeamAccess } from "../_shared/auth.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";
import { getPlaylistMeta, SpotifyApiError } from "../_shared/spotify-playlist.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchPlaylistMeta(token: string, id: string): Promise<
  { followers: number; total_tracks: number | null } | { status: number } | null
> {
  try {
    const meta = await getPlaylistMeta(id, token, { fields: "followers(total),tracks(total)" });
    return {
      followers: meta.followers ?? 0,
      total_tracks: meta.tracks_total ?? null,
    };
  } catch (e) {
    if (e instanceof SpotifyApiError) {
      if (e.status === 401) throw new Error("UNAUTH");
      return { status: e.status };
    }
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: { template_ids?: string[]; limit?: number; include_managed?: boolean } = {};
  try { if (req.method === "POST") body = await req.json(); } catch { /* allow empty */ }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Carrega templates publicados (exclui archived — Audit #13 F5)
  let q = supabase
    .from("playlist_templates")
    .select("id, spotify_playlist_id, created_on_spotify_at, followers_at_creation")
    .not("spotify_playlist_id", "is", null)
    .neq("status", "archived");

  if (body.template_ids?.length) q = q.in("id", body.template_ids);
  q = q.limit(body.limit ?? 200);

  const { data: tpls, error } = await q;
  if (error) return jr({ error: error.message }, 500);

  // Também coleta snapshots das playlists IMPORTADAS (managed_playlists)
  // — sem isso o playlist_brain nunca tem histórico das playlists do catálogo
  // e fica disparando "Habilitar coleta automática no bot" pra todas.
  // Só busca quando NÃO foi pedido um conjunto específico de templates.
  const includeManaged = body.include_managed !== false && !body.template_ids?.length;
  type ManagedRow = { spotify_playlist_id: string };
  let managed: ManagedRow[] = [];
  if (includeManaged) {
    const { data: mp } = await supabase
      .from("managed_playlists")
      .select("spotify_playlist_id")
      .neq("playlist_type", "ARCHIVED")
      .not("spotify_playlist_id", "is", null)
      .limit(body.limit ?? 200);
    managed = (mp ?? []) as ManagedRow[];
  }

  // Deduplica spotify_playlist_id entre templates e managed (templates têm prioridade
  // pra preservar o backfill de followers_at_creation)
  const seen = new Set<string>();
  const targets: Array<{ kind: "template" | "managed"; spotify_playlist_id: string; tpl?: any }> = [];
  for (const t of tpls ?? []) {
    if (!t.spotify_playlist_id || seen.has(t.spotify_playlist_id)) continue;
    seen.add(t.spotify_playlist_id);
    targets.push({ kind: "template", spotify_playlist_id: t.spotify_playlist_id, tpl: t });
  }
  for (const m of managed) {
    if (seen.has(m.spotify_playlist_id)) continue;
    seen.add(m.spotify_playlist_id);
    targets.push({ kind: "managed", spotify_playlist_id: m.spotify_playlist_id });
  }

  if (targets.length === 0) return jr({ ok: true, processed: 0, snapshots: [] });

  let token: string;
  try { token = await getAppToken(); } catch (e) {
    return jr({ error: `spotify_token: ${(e as Error).message}` }, 500);
  }

  const snapshots: any[] = [];
  let unauthRetried = false;
  let ok = 0, failed = 0, auto_archived = 0;
  const failed_ids: string[] = [];

  // Lookup pra saber quais alvos vieram de managed_playlists (pra auto-archive 404)
  const managedIdSet = new Set(managed.map((m) => m.spotify_playlist_id));

  for (const target of targets) {
    try {
      const meta = await fetchPlaylistMeta(token, target.spotify_playlist_id).catch(async (e) => {
        if ((e as Error).message === "UNAUTH" && !unauthRetried) {
          unauthRetried = true;
          token = await forceRefreshAppToken();
          return fetchPlaylistMeta(token, target.spotify_playlist_id);
        }
        throw e;
      });
      if (!meta) { failed++; if (failed_ids.length < 10) failed_ids.push(target.spotify_playlist_id); continue; }
      // Erro HTTP do Spotify
      if ("status" in meta) {
        if (meta.status === 404 && managedIdSet.has(target.spotify_playlist_id)) {
          await supabase.from("managed_playlists")
            .update({ archived_at: new Date().toISOString(), archived_reason: "spotify_404" })
            .eq("spotify_playlist_id", target.spotify_playlist_id)
            .is("archived_at", null);
          auto_archived++;
          console.log(`[track-playlist-metrics] auto-archived 404 ${target.spotify_playlist_id}`);
          continue;
        }
        failed++;
        if (failed_ids.length < 10) failed_ids.push(`${target.spotify_playlist_id}:${meta.status}`);
        continue;
      }

      const row: any = {
        template_id: target.tpl?.id ?? null,
        spotify_playlist_id: target.spotify_playlist_id,
        followers: meta.followers,
        total_tracks: meta.total_tracks,
      };
      const { error: insErr } = await supabase.from("playlist_metrics_snapshots").insert(row);
      if (insErr) {
        failed++;
        if (failed_ids.length < 10) failed_ids.push(`${target.spotify_playlist_id}:insert`);
        continue;
      }

      // Backfill followers_at_creation APENAS pra templates recém-criados (<1h).
      if (target.kind === "template" && target.tpl) {
        const tpl = target.tpl;
        if (tpl.followers_at_creation == null && tpl.created_on_spotify_at) {
          const ageMs = Date.now() - new Date(tpl.created_on_spotify_at).getTime();
          if (ageMs < 60 * 60 * 1000) {
            await supabase
              .from("playlist_templates")
              .update({ followers_at_creation: meta.followers })
              .eq("id", tpl.id);
          }
        }
      }
      snapshots.push(row);
      ok++;
      await new Promise((r) => setTimeout(r, 60));
    } catch (e) {
      console.error("snapshot failed", target.spotify_playlist_id, e);
      failed++;
      if (failed_ids.length < 10) failed_ids.push(`${target.spotify_playlist_id}:${String(e).slice(0, 30)}`);
    }
  }

  // C.1 — falha sistêmica vira alerta visível
  const totalProcessed = targets.length;
  const failureRate = totalProcessed > 0 ? failed / totalProcessed : 0;
  const isSystemicFailure = totalProcessed >= 5 && failureRate > 0.5;

  await supabase.from("collection_logs").insert({
    acao: "track_playlist_metrics",
    status: isSystemicFailure ? "error" : (failed === 0 ? "ok" : "parcial"),
    mensagem: `snapshots ok=${ok} failed=${failed} total=${totalProcessed}` +
      (isSystemicFailure ? ` ⚠️ FALHA SISTÊMICA (${Math.round(failureRate * 100)}% falharam)` : ""),
  });

  if (isSystemicFailure) {
    await supabase.rpc("create_notification", {
      p_type: "warning",
      p_title: "Coleta de métricas com falha sistêmica",
      p_message: `${failed}/${totalProcessed} snapshots falharam (${Math.round(failureRate * 100)}%). Verificar Spotify API/token.`,
      p_action_url: "/cerebro",
      p_metadata: { failed, total: totalProcessed, failure_rate: failureRate },
    }).then(() => {}, (e) => console.error("[track-playlist-metrics] log/op failed:", e?.message ?? e));
  }

  await reportCronHealth(supabase, {
    job_name: "track-playlist-metrics",
    status: isSystemicFailure ? "error" : (failed === 0 ? "ok" : "partial"),
    startedAt,
    metrics: { processed: totalProcessed, ok, failed, auto_archived, systemic_failure: isSystemicFailure, failed_ids },
    message: `processed=${totalProcessed} ok=${ok} failed=${failed} archived=${auto_archived}` +
      (failed_ids.length ? ` · first=[${failed_ids.slice(0, 3).join(",")}]` : ""),
  });

  return jr({
    ok: !isSystemicFailure,
    processed: totalProcessed,
    snapshots_ok: ok,
    failed,
    auto_archived,
    systemic_failure: isSystemicFailure,
    failed_ids: failed_ids.length ? failed_ids : undefined,
  });
});
