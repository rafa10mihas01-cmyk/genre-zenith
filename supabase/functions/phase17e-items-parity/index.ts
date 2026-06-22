// phase17e-items-parity — Validador de paridade Observer vs Catalog Gateway
// para leitura de itens de playlists públicas (Fase 17-C / Etapa 1B).
//
// POST { playlist_ids: string[] }
// Retorna, por playlist:
//   - count (observer vs gateway)
//   - ordem idêntica? (boolean)
//   - ids_match (boolean) + diff
//   - pagination_ok (boolean) — testa offsets 0/100/200 quando aplicável
//   - empty / private / removed_count (null tracks)
//   - mismatch[]
//
// Uso: compare playlists pequenas, médias (>100), vazias e privadas.
// Critério de aceite atendido se TODAS retornarem parity_ok=true.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { requireTeamAccess } from "../_shared/auth.ts";
import { ccFetch } from "../_shared/catalog-gateway.ts";
import {
  observerListAllPlaylistItems,
  observerListPlaylistItems,
  ObserverApiError,
} from "../_shared/observer-playlist.ts";

const FN = "phase17e-items-parity";

type GatewayItem = { track: { id: string } | null };

async function gatewayListAll(playlistId: string, max = 1000): Promise<Array<string | null>> {
  const ids: Array<string | null> = [];
  const limit = 100;
  let offset = 0;
  const fields = "items(track(id)),next";
  while (ids.length < max) {
    const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}&fields=${encodeURIComponent(fields)}`;
    const r = await ccFetch(url, FN, playlistId);
    if (!r.ok) {
      if (r.status === 404) return ids;
      throw new Error(`gateway ${r.status}`);
    }
    const j = await r.json() as { items?: GatewayItem[]; next?: string | null };
    const page = j.items ?? [];
    for (const it of page) ids.push(it?.track?.id ?? null);
    if (!j.next || page.length < limit) break;
    offset += limit;
    if (offset > 10_000) break;
  }
  return ids;
}

async function comparePlaylist(playlistId: string) {
  const report: Record<string, unknown> = { playlist_id: playlistId };
  let gatewayIds: Array<string | null> = [];
  let observerIds: Array<string | null> = [];
  let observerStatus: "ok" | "private_404" | "error" = "ok";
  let gatewayStatus: "ok" | "private_404" | "error" = "ok";

  try {
    gatewayIds = await gatewayListAll(playlistId);
  } catch (e) {
    gatewayStatus = "error";
    report.gateway_error = (e as Error).message;
  }

  try {
    const items = await observerListAllPlaylistItems(playlistId, { maxItems: 10_000 });
    observerIds = items.map((it) => it?.track?.id ?? null);
  } catch (e) {
    if (e instanceof ObserverApiError && e.status === 404) {
      observerStatus = "private_404";
    } else {
      observerStatus = "error";
      report.observer_error = (e as Error).message;
    }
  }

  const gatewayCount = gatewayIds.length;
  const observerCount = observerIds.length;
  const idsMatch =
    gatewayCount === observerCount &&
    gatewayIds.every((id, i) => id === observerIds[i]);

  // Paginação cruzada (offset 100 quando aplicável)
  let pagination_ok: boolean | null = null;
  if (observerCount > 100) {
    try {
      const page2 = await observerListPlaylistItems(playlistId, { offset: 100, limit: 100 });
      const observerPage2 = page2.items.map((it) => it?.track?.id ?? null);
      const expected = observerIds.slice(100, 100 + observerPage2.length);
      pagination_ok = observerPage2.every((id, i) => id === expected[i]);
    } catch {
      pagination_ok = false;
    }
  }

  const removedObserver = observerIds.filter((id) => id === null).length;
  const removedGateway = gatewayIds.filter((id) => id === null).length;

  const mismatches: Array<{ index: number; gateway: string | null; observer: string | null }> = [];
  if (!idsMatch) {
    const maxLen = Math.max(gatewayCount, observerCount);
    for (let i = 0; i < maxLen && mismatches.length < 20; i++) {
      if (gatewayIds[i] !== observerIds[i]) {
        mismatches.push({ index: i, gateway: gatewayIds[i] ?? null, observer: observerIds[i] ?? null });
      }
    }
  }

  return {
    ...report,
    gateway_status: gatewayStatus,
    observer_status: observerStatus,
    gateway_count: gatewayCount,
    observer_count: observerCount,
    count_match: gatewayCount === observerCount,
    order_match: idsMatch,
    ids_match: idsMatch,
    pagination_ok,
    empty: observerCount === 0 && gatewayCount === 0,
    removed_tracks_observer: removedObserver,
    removed_tracks_gateway: removedGateway,
    mismatch_sample: mismatches,
    parity_ok:
      gatewayStatus !== "error" &&
      observerStatus !== "error" &&
      idsMatch &&
      (pagination_ok === null || pagination_ok === true),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: { playlist_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const ids = (body.playlist_ids ?? []).filter((x) => typeof x === "string" && x.length > 0).slice(0, 20);
  if (ids.length === 0) {
    return new Response(JSON.stringify({ error: "playlist_ids[] obrigatório (até 20)" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results = [];
  for (const id of ids) {
    try {
      results.push(await comparePlaylist(id));
    } catch (e) {
      results.push({ playlist_id: id, parity_ok: false, fatal: (e as Error).message });
    }
  }

  const all_parity_ok = results.every((r: any) => r.parity_ok === true);
  return new Response(JSON.stringify({ ok: true, all_parity_ok, count: results.length, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
