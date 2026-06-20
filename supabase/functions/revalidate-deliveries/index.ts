// Revalidação periódica — POLÍTICA "CONFIRMA UMA VEZ":
//
// Pra cada job ADD `done` de campanha ativa, confere no Spotify se a faixa
// está na playlist. Quando o status vira `present` / `moved` / `duplicate`
// (= a faixa entrou e está lá), o job é marcado como confirmado e NUNCA
// mais é re-checado. Só jobs nunca validados, ou que ficaram em `error` /
// `removed`, voltam pra fila.
//
// Fase 17-B.1: leitura via Catalog Gateway (Client Credentials + cache 24h
// + coalescência) para playlists públicas.
//
// Fase 17-B.5.2: roteamento híbrido. Playlists do ecossistema (existem em
// `managed_playlists`) são privadas/colab e o pool CC retorna 403 nelas.
// Para essas usamos OAuth do owner (`owner_spotify_user_id`) com leitura
// paginada direta em `/playlists/{id}/tracks`. Resto do pipeline inalterado.
//
// Salvaguardas:
//  - Lote pequeno (default 50, máx 200).
//  - Respeita o circuit breaker do Spotify: se mais da metade das apps
//    estiver `open`, a função sai sem chamar nada.
//  - Cron deve rodar de hora em hora — não de 1 em 1 min.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getPlaylistItems } from '../_shared/catalog-gateway.ts';
import { getUserToken, spotifyFetch } from '../_shared/spotify-client.ts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const FN = 'revalidate-deliveries';

type Item = { track_id: string };

/** Leitura paginada via OAuth do owner para playlists managed/privadas. */
async function fetchManagedItems(playlistId: string, ownerSpotifyUserId: string | null): Promise<Item[]> {
  if (!ownerSpotifyUserId) {
    throw new Error(`managed playlist sem owner_spotify_user_id (${playlistId})`);
  }
  const { token } = await getUserToken(ownerSpotifyUserId);
  const out: Item[] = [];
  let offset = 0;
  const limit = 100;
  const fields = 'items(track(id)),next';
  while (true) {
    const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}&fields=${encodeURIComponent(fields)}`;
    const r = await spotifyFetch(url, { headers: { Authorization: `Bearer ${token}` } }, {
      functionName: FN,
      operation: 'managed_read',
      playlist_id: playlistId,
      spotify_user_id: ownerSpotifyUserId,
    });
    if (!r.ok) {
      if (r.status === 404) return [];
      throw new Error(`managed read ${r.status} playlist=${playlistId}`);
    }
    const j = await r.json() as { items?: Array<{ track: { id: string } | null }>; next?: string | null };
    const page = j.items ?? [];
    for (const it of page) {
      if (it.track?.id) out.push({ track_id: it.track.id });
    }
    if (!j.next || page.length < limit) break;
    offset += limit;
    if (offset > 10_000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Circuit breaker check ─────────────────────────────────────────────
  const { data: breakers } = await sb
    .from('spotify_circuit_breaker')
    .select('status, blocked_until');
  const total = breakers?.length ?? 0;
  const openNow = (breakers ?? []).filter(
    (b) => b.status === 'open' && (!b.blocked_until || new Date(b.blocked_until) > new Date()),
  ).length;
  if (total > 0 && openNow * 2 >= total) {
    return new Response(
      JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'circuit_breaker_majority_open',
        open: openNow,
        total,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── Limite do lote ────────────────────────────────────────────────────
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const rawLimit = Number(body?.limit ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;

  // ── Campanhas ativas ──────────────────────────────────────────────────
  const { data: camps } = await sb
    .from('campaigns')
    .select('id, spotify_track_id')
    .eq('status', 'active');
  const campMap = new Map((camps ?? []).map((c) => [c.id, c]));
  if (campMap.size === 0) {
    return new Response(JSON.stringify({ ok: true, checked: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Jobs candidatos a revalidar ───────────────────────────────────────
  const { data: jobs } = await sb
    .from('playlist_execution_jobs')
    .select('id, campaign_id, spotify_playlist_id, to_position, last_validation_status, last_validated_at')
    .eq('status', 'done')
    .eq('job_type', 'playlist.track.add')
    .in('campaign_id', [...campMap.keys()])
    .or(`last_validation_status.is.null,last_validation_status.in.(error,removed)`)
    .order('last_validated_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  // dedupe por (playlist, track) — uma checagem por par
  const uniq = new Map<string, any>();
  for (const j of jobs ?? []) {
    const c = campMap.get(j.campaign_id);
    if (!c) continue;
    const k = `${j.spotify_playlist_id}|${c.spotify_track_id}`;
    if (!uniq.has(k)) uniq.set(k, { ...j, spotify_track_id: c.spotify_track_id });
  }

  if (uniq.size === 0) {
    return new Response(
      JSON.stringify({ ok: true, checked: 0, note: 'nada pendente de confirmação' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── Pré-lookup: quais playlists são managed (e qual o owner OAuth) ───
  const playlistIds = Array.from(new Set(Array.from(uniq.values()).map((j) => j.spotify_playlist_id)));
  const { data: managedRows } = await sb
    .from('managed_playlists')
    .select('spotify_playlist_id, owner_spotify_user_id')
    .in('spotify_playlist_id', playlistIds);
  const managedOwner = new Map<string, string | null>(
    (managedRows ?? []).map((r: any) => [r.spotify_playlist_id, r.owner_spotify_user_id ?? null]),
  );

  // ── Loop de validação (rota híbrida: gateway-cc | oauth-managed) ─────
  const itemsCache = new Map<string, Item[]>();
  const counts = { present: 0, moved: 0, duplicate: 0, removed: 0, error: 0, skipped: 0 };
  const routing = { gateway_cc: 0, oauth_managed: 0 };
  const validations: any[] = [];
  const jobUpdates: { id: string; status: string; position: number | null }[] = [];

  for (const j of uniq.values()) {
    try {
      let items = itemsCache.get(j.spotify_playlist_id);
      if (!items) {
        if (managedOwner.has(j.spotify_playlist_id)) {
          items = await fetchManagedItems(j.spotify_playlist_id, managedOwner.get(j.spotify_playlist_id) ?? null);
          routing.oauth_managed++;
        } else {
          items = await getPlaylistItems(j.spotify_playlist_id, FN);
          routing.gateway_cc++;
        }
        itemsCache.set(j.spotify_playlist_id, items);
      }
      const positions: number[] = [];
      items.forEach((r, idx) => {
        if (r.track_id === j.spotify_track_id) positions.push(idx + 1);
      });
      const actual = positions[0] ?? null;
      let status: string;
      if (positions.length > 1) { status = 'duplicate'; counts.duplicate++; }
      else if (actual == null) { status = 'removed'; counts.removed++; }
      else if (actual === j.to_position) { status = 'present'; counts.present++; }
      else { status = 'moved'; counts.moved++; }

      validations.push({
        job_id: j.id,
        campaign_id: j.campaign_id,
        spotify_playlist_id: j.spotify_playlist_id,
        spotify_track_id: j.spotify_track_id,
        expected_position: j.to_position,
        actual_position: actual,
        occurrences: positions.length,
        status,
      });
      jobUpdates.push({ id: j.id, status, position: actual });
    } catch (e: any) {
      counts.error++;
      validations.push({
        job_id: j.id,
        campaign_id: j.campaign_id,
        spotify_playlist_id: j.spotify_playlist_id,
        spotify_track_id: j.spotify_track_id,
        expected_position: j.to_position,
        actual_position: null,
        occurrences: 0,
        status: 'error',
        error: String(e?.message ?? e).slice(0, 300),
      });
      jobUpdates.push({ id: j.id, status: 'error', position: null });
    }
  }

  if (validations.length) {
    await sb.from('playlist_delivery_validations').insert(validations);
  }
  await Promise.all(
    jobUpdates.map((u) =>
      sb
        .from('playlist_execution_jobs')
        .update({
          last_validated_at: new Date().toISOString(),
          last_validation_status: u.status,
          last_validation_position: u.position,
        })
        .eq('id', u.id),
    ),
  );

  return new Response(
    JSON.stringify({
      ok: true,
      checked: uniq.size,
      limit,
      counts,
      routing,
      via: 'hybrid: gateway-cc (public) + oauth (managed)',
      policy: 'confirm_once: present/moved/duplicate never re-checked',
    }, null, 2),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
