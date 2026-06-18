// apply-meta-plan — aplica uma faixa em várias playlists nas posições planejadas
// pelo Planejador de Meta. Para cada slot: insere a faixa na posição N (empurra
// as demais pra baixo, padrão Spotify). Se já existir em outra posição, MOVE
// pra posição planejada.
//
// FIDELIDADE: depois de adicionar/mover, RE-LISTA a playlist e verifica o
// índice real. Se a posição final divergir do alvo (Spotify relinkou, contou
// item local/episode diferente, etc.), faz um REORDER de correção pra cravar
// exatamente a posição planejada. Sem isso, era comum cair em pos 3 → 5.
//
// Body: {
//   spotify_track_id: string,
//   slots: { playlist_id: string (managed_playlists.id), position: number }[]
// }
//
// Retorno: { ok: true, results: [{playlist_id, name, status, message?, final_position?}] }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getUserToken, getAppToken } from "../_shared/spotify-client.ts";
import {
  addPlaylistTracks,
  findPlaylistTrackIndex,
  getPlaylistMeta,
  listPlaylistTrackRefs,
  reorderPlaylistTracks,
} from "../_shared/spotify-playlist.ts";
import {
  acquirePlaylistLock,
  releasePlaylistLock,
  finishPlaylistOperation,
  formatPlaylistError,
} from "../_shared/playlist-lock.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_MS = 300;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// cache de token por owner_id (várias playlists podem compartilhar)
const tokenCache = new Map<string, string>();
async function tokenForOwner(spId: string): Promise<{ token: string; ownerId: string | null }> {
  let ownerId: string | null = null;
  try {
    const appToken = await getAppToken();
    const meta = await getPlaylistMeta(spId, appToken, { fields: "owner(id)" });
    ownerId = meta.owner_id;
  } catch { /* */ }
  const key = ownerId ?? "_default";
  if (tokenCache.has(key)) return { token: tokenCache.get(key)!, ownerId };
  const r = await getUserToken(ownerId ?? undefined);
  tokenCache.set(key, r.token);
  return { token: r.token, ownerId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const trackId: string = body?.spotify_track_id;
    const slots: { playlist_id: string; position: number }[] = Array.isArray(body?.slots) ? body.slots : [];
    if (!trackId || !/^[A-Za-z0-9]{10,}$/.test(trackId)) {
      return jr({ ok: false, error: "spotify_track_id inválido" }, 400);
    }
    if (slots.length === 0) return jr({ ok: false, error: "slots vazio" }, 400);
    if (slots.length > 200) return jr({ ok: false, error: "máx 200 slots por execução" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const ids = [...new Set(slots.map(s => s.playlist_id))];
    const { data: pls } = await supabase
      .from("managed_playlists")
      .select("id, name, spotify_playlist_id")
      .in("id", ids);
    const plById = new Map((pls ?? []).map((p: any) => [p.id, p]));

    const trackUri = `spotify:track:${trackId}`;
    const results: any[] = [];

    let slotIdx = 0;
    for (const slot of slots) {
      if (slotIdx++ > 0) await sleep(THROTTLE_MS);
      const pl: any = plById.get(slot.playlist_id);
      if (!pl?.spotify_playlist_id) {
        results.push({ playlist_id: slot.playlist_id, status: "error", message: "playlist não encontrada" });
        continue;
      }
      const planned1 = Math.max(1, Math.floor(slot.position));
      const targetIdx0 = planned1 - 1; // 1-based → 0-based

      // Adquire lock por playlist antes de qualquer escrita no Spotify.
      const lock = await acquirePlaylistLock(supabase, pl.id, "MANUAL_EDITOR", null);
      if (!lock.ok) {
        results.push({
          playlist_id: pl.id,
          name: pl.name,
          status: "error",
          message: `playlist em uso por ${lock.locked_by ?? "outra operação"}`,
          planned_position: planned1,
        });
        continue;
      }

      try {
        const { token } = await tokenForOwner(pl.spotify_playlist_id);

        // 1) snapshot inicial via helper canônico (com linked_from)
        let refs = await listPlaylistTrackRefs(pl.spotify_playlist_id, token);
        const existingIdx = findPlaylistTrackIndex(refs, trackUri);

        let action: "added" | "moved" | "skip" = "skip";
        let message = "";

        if (existingIdx < 0) {
          // ADD na posição alvo (Spotify: position é 0-based; clamp em len)
          const insertPos = Math.min(targetIdx0, refs.length);
          await addPlaylistTracks(pl.spotify_playlist_id, [trackUri], token, { position: insertPos });
          action = "added";
          message = `inserida na pos ${planned1}`;
        } else {
          const clampedTarget = Math.max(0, Math.min(targetIdx0, refs.length - 1));
          if (existingIdx === clampedTarget) {
            results.push({
              playlist_id: pl.id, name: pl.name, status: "skip",
              message: `já está na posição ${existingIdx + 1}`,
              final_position: existingIdx + 1, planned_position: planned1,
            });
            await finishPlaylistOperation(supabase, lock, { status: "success", tracks_changed: 0 });
            await releasePlaylistLock(supabase, lock);
            continue;
          }
          const insertBefore = existingIdx < clampedTarget
            ? Math.min(clampedTarget + 1, refs.length)
            : clampedTarget;
          await reorderPlaylistTracks(
            pl.spotify_playlist_id,
            { range_start: existingIdx, insert_before: insertBefore, range_length: 1 },
            token,
          );
          action = "moved";
          message = `${existingIdx + 1} → ${planned1}`;
        }

        // 2) VERIFICA fidelidade — re-lista e confere o índice real
        refs = await listPlaylistTrackRefs(pl.spotify_playlist_id, token);
        let actualIdx = findPlaylistTrackIndex(refs, trackUri);
        const desiredIdx = Math.max(0, Math.min(targetIdx0, Math.max(0, refs.length - 1)));

        let corrected = false;
        if (actualIdx >= 0 && actualIdx !== desiredIdx) {
          // 3) Correção: REORDER pra cravar a posição exata
          const insertBefore = actualIdx < desiredIdx
            ? Math.min(desiredIdx + 1, refs.length)
            : desiredIdx;
          await reorderPlaylistTracks(
            pl.spotify_playlist_id,
            { range_start: actualIdx, insert_before: insertBefore, range_length: 1 },
            token,
          );
          refs = await listPlaylistTrackRefs(pl.spotify_playlist_id, token);
          actualIdx = findPlaylistTrackIndex(refs, trackUri);
          corrected = true;
        }

        const finalPos = actualIdx >= 0 ? actualIdx + 1 : null;
        const fidelityOk = finalPos === planned1;

        results.push({
          playlist_id: pl.id,
          name: pl.name,
          status: action,
          message: corrected
            ? `${message} (corrigido p/ ${planned1})`
            : message,
          planned_position: planned1,
          final_position: finalPos,
          fidelity_ok: fidelityOk,
        });
        await finishPlaylistOperation(supabase, lock, {
          status: "success",
          tracks_after: refs.length,
          tracks_changed: action === "skip" ? 0 : 1,
        });
      } catch (e) {
        results.push({
          playlist_id: pl.id,
          name: pl.name,
          status: "error",
          message: (e as Error).message,
          planned_position: planned1,
        });
        await finishPlaylistOperation(supabase, lock, {
          status: "failed",
          error: formatPlaylistError(e),
        });
      } finally {
        await releasePlaylistLock(supabase, lock);
      }
    }

    const counts = results.reduce((acc: any, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      if (r.fidelity_ok === false) acc.fidelity_drift = (acc.fidelity_drift ?? 0) + 1;
      return acc;
    }, {});
    await supabase.from("collection_logs").insert({
      acao: "apply-meta-plan",
      status: (counts.error ?? 0) === 0 ? "sucesso" : "parcial",
      mensagem: `track ${trackId}: ${JSON.stringify(counts)}`,
    });

    return jr({ ok: true, counts, results });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
