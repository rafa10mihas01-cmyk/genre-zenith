// run-search — executa um termo via Spotify Web API (direto).
// Substitui a implementação antiga baseada em Apify. Não usa circuit breaker global do Apify.
// - Paginação: até 3 páginas (offset 0/50/100) com 200ms entre páginas.
// - 429: respeita Retry-After uma vez; segundo 429 → log rate_limited e segue.
// - Upsert search_tracks por (genre_id, spotify_track_id).
// - Upsert search_results por (genre_id, spotify_playlist_id).
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getAppToken, spotifyFetch } from "../_shared/spotify-client.ts";
import { deprecationGate } from "../_shared/_deprecation.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  genre_id: string;
  term_id: string;
  search_term: string;
  max_results?: number; // ignorado (kept for back-compat) — usamos paginação fixa
  force?: boolean;
}

// Spotify restringiu /v1/search em ~2026-05: limit MÁX = 10 (antes 50).
// Mantemos 10 como cap rígido — paginação compensa via offset (cap ~1000 total).
const PAGE_SIZE = 10;
const MAX_PAGES = 3;
const PAGE_DELAY_MS = 200;
const MARKET = "BR";

type SpotifySearchResp = {
  tracks?: { items?: any[] };
  playlists?: { items?: any[] };
};

async function spotifySearch(
  token: string,
  term: string,
  offset: number,
  signal: AbortSignal,
): Promise<{ ok: true; data: SpotifySearchResp; status: number } | { ok: false; status: number; retryAfter: number | null; body: string }> {
  const url =
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(term)}` +
    `&type=track,playlist&market=${MARKET}&limit=${PAGE_SIZE}&offset=${offset}`;
  const r = await spotifyFetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (r.status === 429) {
    const ra = Number(r.headers.get("retry-after") ?? "1");
    return { ok: false, status: 429, retryAfter: Number.isFinite(ra) ? ra : 1, body: "" };
  }
  if (!r.ok) {
    const txt = await r.text();
    return { ok: false, status: r.status, retryAfter: null, body: txt.slice(0, 300) };
  }
  return { ok: true, status: r.status, data: await r.json() };
}

function parseReleaseDate(rd: string | null | undefined): string | null {
  // Spotify retorna "YYYY", "YYYY-MM" ou "YYYY-MM-DD".
  if (!rd || typeof rd !== "string") return null;
  if (/^\d{4}$/.test(rd)) return `${rd}-01-01`;
  if (/^\d{4}-\d{2}$/.test(rd)) return `${rd}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(rd)) return rd;
  return null;
}

Deno.serve(async (req) => {
  const __dep = await deprecationGate(req, "run-search");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  const start = Date.now();
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  if (!body.genre_id || !body.term_id || !body.search_term) {
    return new Response(JSON.stringify({ error: "genre_id, term_id e search_term são obrigatórios" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Cooldown 24h por termo (mesmo do legado)
  const COOLDOWN_HOURS = 24;
  if (!body.force) {
    const { data: termRow } = await supabase
      .from("search_terms")
      .select("ultima_execucao,total_resultados")
      .eq("id", body.term_id)
      .maybeSingle();
    if (termRow?.ultima_execucao && (termRow.total_resultados ?? 0) > 0) {
      const ageH = (Date.now() - new Date(termRow.ultima_execucao).getTime()) / 36e5;
      if (ageH < COOLDOWN_HOURS) {
        await supabase.from("collection_logs").insert({
          genre_id: body.genre_id, term_id: body.term_id,
          acao: "run-search", status: "skipped",
          mensagem: `cooldown: termo "${body.search_term}" executado há ${ageH.toFixed(1)}h (<${COOLDOWN_HOURS}h). Use force=true pra ignorar.`,
          duracao_ms: Date.now() - start,
        });
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "cooldown" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), 130_000);

  try {
    await supabase.from("genres").update({ status: "coletando" }).eq("id", body.genre_id);

    const token = await getAppToken();

    const allTracks: any[] = [];
    const allPlaylists: any[] = [];
    let lastSpotifyStatus = 0;
    let rateLimited = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      let resp = await spotifySearch(token, body.search_term, offset, controller.signal);

      // 429 retry once
      if (!resp.ok && resp.status === 429) {
        const wait = Math.min(60, Math.max(1, resp.retryAfter ?? 1));
        await new Promise((r) => setTimeout(r, wait * 1000));
        resp = await spotifySearch(token, body.search_term, offset, controller.signal);
        if (!resp.ok && resp.status === 429) {
          rateLimited = true;
          lastSpotifyStatus = 429;
          break;
        }
      }

      if (!resp.ok) {
        lastSpotifyStatus = resp.status;
        // Hard error pra essa página — para o termo
        await supabase.from("collection_logs").insert({
          genre_id: body.genre_id, term_id: body.term_id,
          acao: "run-search", status: "erro",
          mensagem: `Spotify ${resp.status}: ${resp.body}`.slice(0, 500),
          duracao_ms: Date.now() - start,
        });
        clearTimeout(timeoutHandle);
        return new Response(
          JSON.stringify({ ok: false, error: `spotify_${resp.status}`, body: resp.body }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      lastSpotifyStatus = resp.status;
      const tItems = resp.data?.tracks?.items ?? [];
      const pItems = (resp.data?.playlists?.items ?? []).filter(Boolean);
      allTracks.push(...tItems);
      allPlaylists.push(...pItems);

      // Se a página veio menor que o limite, encerra
      if (tItems.length < PAGE_SIZE && pItems.length < PAGE_SIZE) break;
      if (page < MAX_PAGES - 1) await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }

    if (rateLimited) {
      await supabase.from("collection_logs").insert({
        genre_id: body.genre_id, term_id: body.term_id,
        acao: "run-search", status: "rate_limited",
        mensagem: `Spotify 429 persistente em "${body.search_term}" após retry. Termo pulado.`,
        duracao_ms: Date.now() - start,
      });
      clearTimeout(timeoutHandle);
      return new Response(JSON.stringify({ ok: false, rate_limited: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============= UPSERT PLAYLISTS =============
    let savedResults = 0;
    let updatedResults = 0;
    const playlistIdToResultId = new Map<string, string>();
    const seenPlaylistIds = new Set<string>();

    for (let i = 0; i < allPlaylists.length; i++) {
      const p = allPlaylists[i];
      if (!p?.id) continue;
      if (seenPlaylistIds.has(p.id)) continue;
      seenPlaylistIds.add(p.id);

      const nomePl = p.name ?? "Sem nome";
      const url = p.external_urls?.spotify ?? `https://open.spotify.com/playlist/${p.id}`;
      const imagem = p.images?.[0]?.url ?? null;
      const descricao = p.description ?? null;
      const totalTracks = p.tracks?.total ?? null;
      const ownerId = p.owner?.id ?? null;
      const ownerType = p.owner?.type ?? null;

      const { data: existing } = await supabase
        .from("search_results")
        .select("id,times_seen")
        .eq("genre_id", body.genre_id)
        .eq("spotify_playlist_id", p.id)
        .maybeSingle();

      if (existing) {
        await supabase.from("search_results").update({
          nome_playlist: nomePl,
          spotify_url: url,
          imagem_url: imagem,
          descricao,
          total_musicas: totalTracks,
          owner_id: ownerId,
          owner_type: ownerType,
          term_id: body.term_id,
          posicao: i + 1,
          times_seen: (existing.times_seen ?? 1) + 1,
          last_seen_at: new Date().toISOString(),
          coletado_em: new Date().toISOString(),
        }).eq("id", existing.id);
        updatedResults++;
        playlistIdToResultId.set(p.id, existing.id);
      } else {
        const { data: ins, error: insErr } = await supabase
          .from("search_results")
          .insert({
            genre_id: body.genre_id,
            term_id: body.term_id,
            nome_playlist: nomePl,
            posicao: i + 1,
            spotify_url: url,
            spotify_playlist_id: p.id,
            seguidores: null, // /v1/search não retorna; enrich-playlists preenche.
            imagem_url: imagem,
            descricao,
            total_musicas: totalTracks,
            owner_id: ownerId,
            owner_type: ownerType,
            times_seen: 1,
            needs_enrich: true,
            followers_source: null,
            followers_verified_at: null,
            is_valid: true,
            validation_reason: "pre_enrich",
          })
          .select("id")
          .single();
        if (!insErr && ins) {
          savedResults++;
          playlistIdToResultId.set(p.id, ins.id);
        } else if (insErr) {
          console.error("insert search_results err", insErr);
        }
      }
    }

    // ============= UPSERT TRACKS =============
    // result_id = qualquer search_results desse gênero (informativo). Pega o primeiro recente.
    let fallbackResultId: string | null = null;
    {
      const firstPid = [...playlistIdToResultId.values()][0];
      if (firstPid) fallbackResultId = firstPid;
      else {
        const { data: anyRow } = await supabase
          .from("search_results")
          .select("id")
          .eq("genre_id", body.genre_id)
          .order("coletado_em", { ascending: false })
          .limit(1)
          .maybeSingle();
        fallbackResultId = anyRow?.id ?? null;
      }
    }

    let savedTracks = 0;
    const seenTrackIds = new Set<string>();
    const trackRows: any[] = [];
    const nowIso = new Date().toISOString();

    for (const t of allTracks) {
      if (!t?.id) continue;
      if (seenTrackIds.has(t.id)) continue;
      seenTrackIds.add(t.id);

      const artistsArr: any[] = Array.isArray(t.artists) ? t.artists : [];
      const artista = artistsArr.map((a) => a?.name).filter(Boolean).join(", ") || "Desconhecido";
      const cover = t.album?.images?.[0]?.url ?? null;
      const releaseDate = parseReleaseDate(t.album?.release_date);

      trackRows.push({
        genre_id: body.genre_id,
        result_id: fallbackResultId, // informativo (nullable conceitualmente)
        nome_musica: t.name ?? "Desconhecida",
        artista,
        spotify_track_id: t.id,
        album: t.album?.name ?? null,
        cover_url: cover,
        release_date: releaseDate,
        popularity: typeof t.popularity === "number" ? t.popularity : null,
        duration_ms: typeof t.duration_ms === "number" ? t.duration_ms : null,
        coletado_em: nowIso,
      });
    }

    if (trackRows.length > 0) {
      // Upsert em chunks
      const CHUNK = 100;
      for (let i = 0; i < trackRows.length; i += CHUNK) {
        const slice = trackRows.slice(i, i + CHUNK);
        const { error: upErr } = await supabase
          .from("search_tracks")
          .upsert(slice, { onConflict: "genre_id,spotify_track_id" });
        if (upErr) console.error("upsert search_tracks err", upErr);
        else savedTracks += slice.length;
      }

      // Backfill: garante que NENHUMA row deste gênero fique com result_id NULL.
      // (Upsert do supabase-js sobrescreve campos — se fallbackResultId vier null
      // numa execução, pode zerar result_id de rows antigas. Esse passo restaura.)
      if (fallbackResultId) {
        const { error: bfErr } = await supabase
          .from("search_tracks")
          .update({ result_id: fallbackResultId })
          .eq("genre_id", body.genre_id)
          .is("result_id", null);
        if (bfErr) console.error("backfill result_id err", bfErr);
      }
    }

    // Atualiza term
    await supabase
      .from("search_terms")
      .update({
        executado: true,
        total_resultados: savedResults + updatedResults,
        ultima_execucao: new Date().toISOString(),
      })
      .eq("id", body.term_id);

    // Atualiza contagens do gênero
    const [{ count: pCount }, { count: tCount }] = await Promise.all([
      supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id),
      supabase.from("search_tracks").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id),
    ]);
    await supabase.from("genres").update({
      total_playlists: pCount ?? 0,
      total_musicas: tCount ?? 0,
      ultima_coleta: new Date().toISOString(),
      status: "coletando",
    }).eq("id", body.genre_id);

    const diag =
      `"${body.search_term}" via Spotify API | ` +
      `${savedResults} novas playlists, ${updatedResults} atualizadas, ${savedTracks} tracks upsertados ` +
      `(de ${allPlaylists.length} playlists/${allTracks.length} tracks brutos)`;

    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      term_id: body.term_id,
      acao: "run-search",
      status: "sucesso",
      mensagem: diag.slice(0, 4000),
      duracao_ms: Date.now() - start,
    });

    clearTimeout(timeoutHandle);
    return new Response(
      JSON.stringify({
        ok: true,
        provider: "spotify",
        spotify_search_status: lastSpotifyStatus,
        savedResults,
        updatedResults,
        savedTracks,
        playlists_seen: allPlaylists.length,
        tracks_seen: allTracks.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    clearTimeout(timeoutHandle);
    const msg = (e as Error).message ?? String(e);
    console.error("run-search error", msg);
    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      term_id: body.term_id,
      acao: "run-search",
      status: "erro",
      mensagem: msg.slice(0, 500),
      duracao_ms: Date.now() - start,
    });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
