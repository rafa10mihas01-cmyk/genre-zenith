// register-cohort-baseline — Fase 3.B.1.
// Edge function que recebe matches da IA (analyze-deal-prints) + print URLs e
// persiste a baseline manual da campanha SERVER-SIDE. Frontend não decide
// pertencimento de playlist. Match acontece exclusivamente via RPC oficial
// `match_curator_playlist`. Enriquecimento com `managed_playlists` (cover,
// followers, spotify_id) é feito aqui no backend e não no navegador.
//
// Contrato:
//   POST { campaign_id, deal_id, song_id, captured_at, print_urls, matches }
//   matches: [{ playlist_name, plays, source_index? }]
//   Retorno: { ok, inserted, total_plays }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type IncomingMatch = {
  playlist_name: string;
  plays: number;
  source_index?: number | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jr({ ok: false, error: "missing_auth" }, 401);
    }
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jr({ ok: false, error: "invalid_auth" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const campaignId = String(body?.campaign_id ?? "").trim();
    const dealId = String(body?.deal_id ?? "").trim();
    const songId = body?.song_id ? String(body.song_id) : null;
    const capturedAt: string = body?.captured_at ?? new Date().toISOString();
    const printUrls: string[] = Array.isArray(body?.print_urls) ? body.print_urls : [];
    const matches: IncomingMatch[] = Array.isArray(body?.matches) ? body.matches : [];

    if (!campaignId || !dealId) return jr({ ok: false, error: "campaign_id_and_deal_id_required" }, 400);
    if (matches.length === 0) return jr({ ok: false, error: "no_matches" }, 400);

    // Carrega managed_playlists candidatas pra enriquecimento (cover/followers/spotify_id).
    // Mesma seleção que o frontend fazia antes: alocações da campanha → fallback curador.
    const { data: camp } = await admin
      .from("campaigns")
      .select("id, curator_id")
      .eq("id", campaignId)
      .maybeSingle();
    const curatorId = (camp as any)?.curator_id ?? null;
    const { data: allocs } = await admin
      .from("campaign_eco_allocations")
      .select("managed_playlist_id")
      .eq("campaign_id", campaignId);
    const managedIds = Array.from(
      new Set((allocs ?? []).map((a: any) => a.managed_playlist_id).filter(Boolean)),
    );
    const managedQ = managedIds.length
      ? admin.from("managed_playlists").select("id, name, spotify_playlist_id, spotify_url, followers, cover_url").in("id", managedIds)
      : curatorId
        ? admin
            .from("managed_playlists")
            .select("id, name, spotify_playlist_id, spotify_url, followers, cover_url")
            .eq("curator_id", curatorId)
            .neq("playlist_type", "ARCHIVED")
            .order("followers", { ascending: false, nullsFirst: false })
            .limit(500)
        : null;
    const { data: managed } = managedQ ? await managedQ : { data: [] as any[] };

    // Enriquecimento opcional via match contra managed (mesmo critério: nome).
    // Esse lookup NÃO decide pertencimento da curator_playlist — apenas anexa
    // metadados (cover/followers) ao registro criado. Decisão de match real fica
    // na RPC `match_curator_playlist` abaixo.
    const norm = (s: string | null | undefined) =>
      String(s ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .trim()
        .toLowerCase();
    const managedByName = new Map((managed ?? []).map((p: any) => [norm(p.name), p]));

    const snapshotRows: any[] = [];

    for (const match of matches) {
      const playlistName = String(match.playlist_name ?? "").trim();
      if (!playlistName) continue;
      const playsValue = Number(match.plays ?? 0);
      const managedMatch = managedByName.get(norm(playlistName)) ?? null;
      const spotifyPlaylistId = managedMatch?.spotify_playlist_id ?? null;

      // Match Oficial — única fonte de verdade.
      const { data: matchData } = await admin.rpc("match_curator_playlist", {
        p_deal_id: dealId,
        p_spotify_playlist_id: spotifyPlaylistId,
        p_playlist_name: playlistName,
        p_song_id: songId,
      });
      const matched = Array.isArray(matchData) ? matchData[0] : null;
      let playlistId: string | null = (matched as any)?.playlist_id ?? null;
      const matchMethod: string = ((matched as any)?.match_method as string) ?? (managedMatch ? "managed_playlist_name" : "ai_name");

      if (playlistId) {
        // Atualiza enriquecimento se for um managed conhecido.
        if (managedMatch) {
          await admin
            .from("curator_playlists")
            .update({
              spotify_url: managedMatch.spotify_url ?? `https://open.spotify.com/playlist/${managedMatch.spotify_playlist_id}`,
              playlist_name: managedMatch.name ?? playlistName,
              followers: managedMatch.followers ?? null,
              spotify_playlist_id: managedMatch.spotify_playlist_id ?? null,
              image_url: managedMatch.cover_url ?? null,
              streams_total: playsValue,
              match_status: "baseline",
              match_reason: "baseline manual por print",
            } as any)
            .eq("id", playlistId);
        }
      } else {
        // Não existe ainda — cria curator_playlist (enriquecida com managed se houver).
        const { data: inserted, error: insertErr } = await admin
          .from("curator_playlists")
          .insert({
            deal_id: dealId,
            song_id: songId,
            spotify_url: managedMatch?.spotify_url ?? "",
            playlist_name: managedMatch?.name ?? playlistName,
            followers: managedMatch?.followers ?? null,
            is_initial_roster: true,
            spotify_playlist_id: managedMatch?.spotify_playlist_id ?? null,
            image_url: managedMatch?.cover_url ?? null,
            streams_total: playsValue,
            match_status: "curator",
            match_reason: "baseline manual por print",
          } as any)
          .select("id")
          .single();
        if (insertErr) return jr({ ok: false, error: insertErr.message }, 500);
        playlistId = inserted!.id as string;
      }

      const idx = Math.max(0, Number(match.source_index ?? 0));
      snapshotRows.push({
        deal_id: dealId,
        song_id: songId,
        playlist_id: playlistId,
        plays: playsValue,
        captured_at: capturedAt,
        print_url: printUrls[idx] ?? printUrls[0] ?? null,
        is_initial_capture: true,
        source: "manual_print",
        match_method: matchMethod,
        ai_raw: match,
      });
    }

    // Dedup por playlist_id — mantém a maior leitura por playlist (idêntico ao
    // que o frontend fazia).
    const dedupMap = new Map<string, any>();
    for (const row of snapshotRows) {
      const key = String(row.playlist_id);
      const prev = dedupMap.get(key);
      if (!prev || Number(row.plays || 0) > Number(prev.plays || 0)) {
        dedupMap.set(key, row);
      }
    }
    const uniqueSnapshotRows = Array.from(dedupMap.values());
    const total = uniqueSnapshotRows.reduce((sum, row) => sum + Number(row.plays || 0), 0);

    const { error: snapErr } = await admin
      .from("curator_deal_snapshots")
      .upsert(uniqueSnapshotRows, { onConflict: "playlist_id,captured_at", ignoreDuplicates: false });
    if (snapErr) return jr({ ok: false, error: snapErr.message }, 500);

    const { error: logErr } = await admin.from("curator_deal_logs").insert({
      deal_id: dealId,
      song_id: songId,
      total_plays: total,
      note: "[manual] baseline por prints",
      is_initial_capture_event: true,
      print_urls: printUrls,
    } as any);
    if (logErr) return jr({ ok: false, error: logErr.message }, 500);

    await admin
      .from("curator_deals")
      .update({
        state: "collecting",
        baseline_captured_at: capturedAt,
        baseline_plays: total,
      } as any)
      .eq("id", dealId);

    return jr({ ok: true, inserted: uniqueSnapshotRows.length, total_plays: total });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
