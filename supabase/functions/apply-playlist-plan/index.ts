// apply-playlist-plan — executa o plano de manutenção do último diagnóstico
// via Spotify Web API. Suporta ação isolada por bucket ou o plano completo.
//
// Body: {
//   playlist_id: string (managed_playlists.id),
//   action: "remove" | "demote" | "promote" | "add" | "all",
//   limit_add?: number (default 15, max 50),
// }
//
// Ordem do "all": add → remove → demote → promote (executado em sequência,
// parando no primeiro erro fatal, mas retornando relatório por etapa).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getUserAccessToken, getSpotifyToken } from "../_shared/spotify.ts";
import {
  addPlaylistTracks,
  findPlaylistTrackIndex,
  listPlaylistTrackRefs,
  removePlaylistTracks,
  reorderPlaylistTracks,
  type PlaylistTrackRef,
} from "../_shared/spotify-playlist.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Action = "remove" | "demote" | "promote" | "add" | "all";

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function spotifyFetch(url: string, init: RequestInit, token: string) {
  const r = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const txt = await r.text();
  if (!r.ok) {
    throw new Error(`Spotify ${r.status}: ${txt.slice(0, 300)}`);
  }
  try { return txt ? JSON.parse(txt) : {}; } catch { return {}; }
}

async function syncManagedSnapshot(authHeader: string, playlistId: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/sync-managed-playlist-tracks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify({ playlist_id: playlistId }),
  });
  const txt = await r.text();
  let body: any = null;
  try { body = JSON.parse(txt); } catch { /* ignore */ }
  return { ok: r.ok && body?.ok !== false, total: body?.total ?? null, error: body?.error ?? txt };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const playlistId: string = body?.playlist_id;
    const action: Action = (body?.action ?? "all") as Action;
    const limitAdd: number = Math.max(1, Math.min(Number(body?.limit_add ?? 15), 50));
    if (!playlistId) return jr({ ok: false, error: "playlist_id obrigatório" }, 400);
    if (!["remove", "demote", "promote", "add", "all"].includes(action)) {
      return jr({ ok: false, error: "action inválida" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Managed playlist
    const { data: pl } = await supabase
      .from("managed_playlists")
      .select("id, spotify_playlist_id, name, tracks_count, lifecycle_phase")
      .eq("id", playlistId)
      .maybeSingle();
    if (!pl?.spotify_playlist_id) return jr({ ok: false, error: "playlist sem spotify_playlist_id" }, 404);

    // 2) Último diagnóstico
    const { data: diag } = await supabase
      .from("playlist_diagnoses")
      .select("id, tracks_analysis, tracks_suggestions, raw, created_at")
      .eq("playlist_id", pl.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!diag) return jr({ ok: false, error: "sem diagnóstico — rode a análise primeiro" }, 400);

    const analysis: any[] = Array.isArray(diag.tracks_analysis) ? diag.tracks_analysis : [];
    const suggestions: any[] = Array.isArray(diag.tracks_suggestions) ? diag.tracks_suggestions : [];
    const caps = (diag as any).raw?.applied_caps ?? null;

    // Respeita os caps do cérebro: detecta tudo, aplica só o recomendado neste
    // ciclo. Ordena por prioridade ANTES de truncar pra pegar os mais críticos.
    let removeItems = analysis.filter((t) => t.status === "remove" && t.spotify_track_id)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    let demoteItems = analysis.filter((t) => t.status === "demote" && t.spotify_track_id)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    let promoteItems = analysis.filter((t) => t.status === "promote" && t.spotify_track_id)
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

    if (caps) {
      if (typeof caps.recommended_remove === "number") removeItems = removeItems.slice(0, caps.recommended_remove);
      if (typeof caps.recommended_demote === "number") demoteItems = demoteItems.slice(0, caps.recommended_demote);
      if (typeof caps.recommended_promote === "number") promoteItems = promoteItems.slice(0, caps.recommended_promote);
    }
    const addItems = suggestions.filter((s) => s.spotify_track_id).slice(0, limitAdd);


    // 3) OAuth token do dono
    let ownerId: string | null = null;
    try {
      const appToken = await getSpotifyToken();
      const or = await fetch(
        `https://api.spotify.com/v1/playlists/${pl.spotify_playlist_id}?fields=owner(id)`,
        { headers: { Authorization: `Bearer ${appToken}` } },
      );
      if (or.ok) ownerId = (await or.json())?.owner?.id ?? null;
    } catch { /* */ }

    let token: string;
    try {
      const r = await getUserAccessToken(ownerId ?? undefined);
      token = r.token;
    } catch (e) {
      return jr({
        ok: false,
        error: ownerId
          ? `conta do dono "${ownerId}" não está conectada. Conecte em Configurações → Spotify.`
          : `nenhuma conta Spotify conectada: ${(e as Error).message}`,
      }, 412);
    }

    const spId = pl.spotify_playlist_id;
    const playlistDbId = pl.id;
    const expectedTracksCount = Number(pl.tracks_count ?? 0);
    const report: Record<string, any> = { ok: true, steps: [] };

    // helpers que mantêm a tracklist em memória sincronizada com a playlist real.
    // Usamos refs com linked_from porque o Spotify pode devolver uma URI relinkada
    // diferente da URI original salva no diagnóstico.
    let currentRefs: PlaylistTrackRef[] | null = null;
    async function loadSnapshotRefs(): Promise<PlaylistTrackRef[]> {
      const { data } = await supabase
        .from("managed_playlist_tracks")
        .select("spotify_track_id")
        .eq("playlist_id", playlistDbId)
        .order("position", { ascending: true });
      return (data ?? [])
        .map((row: any) => String(row.spotify_track_id ?? "").trim())
        .filter(Boolean)
        .map((id) => ({ uri: `spotify:track:${id}`, id }));
    }
    async function ensureCurrent(): Promise<PlaylistTrackRef[]> {
      if (!currentRefs) {
        const refs = await listPlaylistTrackRefs(spId, token).catch(() => []);
        currentRefs = expectedTracksCount > 0 && refs.length < Math.floor(expectedTracksCount * 0.8)
          ? await loadSnapshotRefs()
          : refs;
      }
      return currentRefs;
    }

    async function doRemove() {
      if (removeItems.length === 0) {
        report.steps.push({ action: "remove", skipped: true, reason: "nada a remover" });
        return;
      }
      const uris = removeItems.map((t) => `spotify:track:${t.spotify_track_id}`);
      const res = await removePlaylistTracks(spId, uris, token);
      if (currentRefs) currentRefs = currentRefs.filter((ref) => !uris.some((uri) => ref.uri === uri || ref.linked_from_uri === uri));
      report.snapshot_id = res?.snapshot_id ?? report.snapshot_id;
      const removed = res.removed;
      report.steps.push({ action: "remove", removed });
    }

    async function doReorder(kind: "demote" | "promote") {
      const items = kind === "promote" ? promoteItems : demoteItems;
      if (items.length === 0) {
        report.steps.push({ action: kind, skipped: true, reason: `nada a ${kind === "promote" ? "promover" : "rebaixar"}` });
        return;
      }
      await ensureCurrent();
      // Ordena: promote do mais "merecedor" primeiro (topo); demote do mais
      // próximo do topo primeiro (mandar pra zona inferior).
      const sorted = [...items].sort((a, b) => {
        if (kind === "promote") return (b.popularity ?? 0) - (a.popularity ?? 0);
        return (a.position ?? 0) - (b.position ?? 0);
      });
      let moved = 0;
      let skipped = 0;
      const details: any[] = [];
      for (const it of sorted) {
        const uri = `spotify:track:${it.spotify_track_id}`;
        const total = currentRefs!.length;
        let idx = findPlaylistTrackIndex(currentRefs!, uri);
        let index_source = "track_id";
        if (idx < 0 && Number.isFinite(it.position)) {
          const fallbackIdx = Math.max(0, Math.min(Number(it.position), total - 1));
          idx = fallbackIdx;
          index_source = "diagnosis_position";
        }
        if (idx < 0) {
          skipped++;
          details.push({ track_id: it.spotify_track_id, skipped: "not_found", position: it.position, target_position: it.target_position });
          continue;
        }
        // target: usa target_position se vier do diag, senão fallback
        // Promote (subir): fallback é "moved" (vai empilhando no topo).
        // Demote (descer): fallback é o final da lista (índice total-1).
        const fallback = kind === "promote" ? moved : Math.max(total - 1, 0);
        let target = Number.isFinite(it.target_position) ? Number(it.target_position) : fallback;
        target = Math.max(0, Math.min(target, total - 1));
        // Spotify reorder: insert_before usa índices da lista ORIGINAL.
        //   - Subindo (idx > target): insert_before = target → cai em target ✓
        //   - Descendo (idx < target): insert_before = target + 1 (compensa o slot
        //     que o próprio item ocupa antes de ser movido) → cai em target ✓
        const insertBefore = idx < target
          ? Math.min(target + 1, total)
          : target;
        if (insertBefore === idx || insertBefore === idx + 1) {
          skipped++;
          details.push({ track_id: it.spotify_track_id, skipped: "already_at_target", index: idx, target_position: target });
          continue;
        }
        const res = await reorderPlaylistTracks(spId, { range_start: idx, insert_before: insertBefore, range_length: 1 }, token);
        // Atualiza memória local
        const [item] = currentRefs!.splice(idx, 1);
        const adjusted = insertBefore > idx ? insertBefore - 1 : insertBefore;
        currentRefs!.splice(adjusted, 0, item);
        moved++;
        details.push({ track_id: it.spotify_track_id, from: idx, to: adjusted, target_position: target, index_source });
        report.snapshot_id = res?.snapshot_id ?? report.snapshot_id;
      }
      report.steps.push({ action: kind, moved, skipped, details });
    }

    async function doAdd() {
      if (addItems.length === 0) {
        report.steps.push({ action: "add", skipped: true, reason: "sem sugestões" });
        return;
      }
      await ensureCurrent();
      const uris = addItems.map((s) => `spotify:track:${s.spotify_track_id}`);
      const res = await addPlaylistTracks(spId, uris, token, { position: 0 });
      report.steps.push({ action: "add", added: uris.length });
      report.snapshot_id = res?.snapshot_id ?? report.snapshot_id;
      currentRefs = [
        ...uris.map((uri) => ({ uri, id: uri.split(":").pop() ?? null })),
        ...(currentRefs ?? []),
      ];
    }

    try {
      // Ordem editorial: remove → demote → promote → add.
      // ADD por último para que promote/demote operem sobre a lista ORIGINAL
      // (que é a base dos target_position calculados pelo diagnose). Caso
      // contrário, um ADD prévio empurra todos os índices originais e os
      // targets caem dentro do bloco recém-adicionado.
      if (action === "remove" || action === "all") await doRemove();
      if (action === "demote" || action === "all") await doReorder("demote");
      if (action === "promote" || action === "all") await doReorder("promote");
      if (action === "add" || action === "all") await doAdd();
    } catch (e) {
      const msg = (e as Error).message;
      const hint = msg.includes("403")
        ? ` — verifique se o dono da playlist ("${ownerId ?? "?"}") está conectado em Configurações → Spotify com escopos playlist-modify-public/private.`
        : "";
      await supabase.from("collection_logs").insert({
        acao: "apply-playlist-plan",
        status: "erro",
        mensagem: `${spId} (${action}): ${msg}${hint}`,
      });
      return jr({ ok: false, action, partial: report, error: `${msg}${hint}` }, 502);
    }

    const finalRefs = await listPlaylistTrackRefs(spId, token).catch(() => null);
    if (finalRefs) {
      report.current_tracks_count = finalRefs.length;
      await supabase
        .from("managed_playlists")
        .update({ tracks_count: finalRefs.length, last_metrics_at: new Date().toISOString() })
        .eq("id", pl.id);
    }

    const sync = await syncManagedSnapshot(`Bearer ${SERVICE_KEY}`, pl.id).catch((e) => ({ ok: false, error: String(e), total: null }));
    report.sync = sync.ok ? { ok: true, total: sync.total } : { ok: false, error: sync.error };
    if (sync.ok && typeof sync.total === "number") report.current_tracks_count = sync.total;

    await supabase.from("collection_logs").insert({
      acao: "apply-playlist-plan",
      status: "sucesso",
      mensagem: `${spId} (${action}): ${JSON.stringify(report.steps)} count=${report.current_tracks_count ?? "?"}`,
    });

    return jr(report);
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
