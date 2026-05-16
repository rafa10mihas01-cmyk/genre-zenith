// fetch-spotify-featured — busca playlists no Spotify Search API (market=BR), filtra
// owner.id='spotify' (oficiais), e insere em search_results JÁ COM owner_type='spotify'
// e followers_source='spotify_api'. Custo Apify: zero.
//
// POST { genre_id: string, queries?: string[], limit?: number } → { ok, found, inserted, ... }
//
// Se queries não vier, usa o nome do gênero + variações editoriais default
// (Top, Viral, Hits, Novidades) — mas pra cobertura melhor passe queries customizadas
// vindas de seed-editorial-terms.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getSpotifyToken } from "../_shared/spotify.ts";
import { classifyOwner } from "../_shared/labels.ts";
import { requireTeamAccess } from "../_shared/auth.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  genre_id: string;
  queries?: string[];
  limit?: number; // por query, max 50
  market?: string; // default BR
  also_user_big?: boolean; // se true, também guarda playlists user com 100k+ (default false — esta fn é específica pra oficiais)
}

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function defaultQueries(genreNome: string): string[] {
  const n = genreNome;
  return [
    `Top ${n}`,
    `${n} Hits`,
    `Viral ${n}`,
    `Novidades ${n}`,
    `${n} Brasil`,
  ];
}

type SpPlaylist = {
  id: string;
  name: string;
  description: string | null;
  external_urls: { spotify?: string };
  images?: { url?: string }[];
  owner: { id: string; display_name?: string };
  followers?: { total?: number };
  tracks?: { total?: number };
};

async function searchPlaylists(token: string, q: string, market: string, limit: number): Promise<SpPlaylist[]> {
  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", q);
  url.searchParams.set("type", "playlist");
  url.searchParams.set("market", market);
  url.searchParams.set("limit", String(Math.min(limit, 50)));
  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) throw new Error("TOKEN_EXPIRED");
  if (r.status === 429) {
    const wait = Number(r.headers.get("Retry-After") ?? "2");
    throw new Error(`RATE_LIMIT:${wait}`);
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Spotify search ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  const items = (j?.playlists?.items ?? []).filter((it: unknown) => it !== null && typeof it === "object");
  return items as SpPlaylist[];
}

// Hidrata followers/tracks pra oficiais Spotify (search retorna sem followers)
async function hydratePlaylist(token: string, id: string): Promise<{ followers: number | null; tracks: number | null } | null> {
  const r = await fetch(`https://api.spotify.com/v1/playlists/${id}?fields=followers(total),tracks(total)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const j = await r.json();
  return { followers: j?.followers?.total ?? null, tracks: j?.tracks?.total ?? null };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

Deno.serve(async (req) => {
  const __dep = await deprecationGate(req, "fetch-spotify-featured");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  let body: Body;
  try { body = await req.json(); } catch { return jr({ error: "invalid json" }, 400); }
  if (!body.genre_id) return jr({ error: "genre_id required" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const start = Date.now();

  const { data: genre } = await supabase
    .from("genres").select("id,nome,slug").eq("id", body.genre_id).maybeSingle();
  if (!genre) return jr({ error: "genre not found" }, 404);

  const queries = (body.queries && body.queries.length > 0)
    ? body.queries
    : defaultQueries(genre.nome);
  const market = body.market ?? "BR";
  const limit = Math.min(Math.max(body.limit ?? 20, 5), 50);
  const alsoUserBig = body.also_user_big === true;

  let token = await getSpotifyToken();
  const seen = new Set<string>(); // dedup por playlist_id dentro deste run
  const candidates: Array<{ playlist: SpPlaylist; query: string }> = [];
  const queryStats: Array<{ q: string; total: number; oficiais: number }> = [];

  for (const q of queries) {
    let attempts = 0;
    let items: SpPlaylist[] = [];
    while (attempts < 3) {
      attempts++;
      try {
        items = await searchPlaylists(token, q, market, limit);
        break;
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "TOKEN_EXPIRED") { token = await getSpotifyToken(true); continue; }
        if (msg.startsWith("RATE_LIMIT:")) {
          await sleep((Number(msg.split(":")[1]) || 2) * 1000);
          continue;
        }
        console.error(`[fetch-featured] erro em "${q}":`, msg);
        items = [];
        break;
      }
    }
    let oficiais = 0;
    for (const it of items) {
      if (!it?.id || seen.has(it.id)) continue;
      const ownerCls = classifyOwner(it.owner?.id);
      // tier 1: oficiais Spotify OU selos majors (filtr.br, somlivre, digster_brasil, ...)
      const isTier1 = ownerCls === "spotify" || ownerCls === "label";
      if (!isTier1 && !alsoUserBig) continue;
      seen.add(it.id);
      candidates.push({ playlist: it, query: q });
      if (isTier1) oficiais++;
    }
    queryStats.push({ q, total: items.length, oficiais });
  }

  if (candidates.length === 0) {
    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      acao: "fetch-spotify-featured",
      status: "sucesso",
      mensagem: `0 oficiais encontradas em ${queries.length} queries (mercado ${market})`,
      duracao_ms: Date.now() - start,
    });
    return jr({ ok: true, found: 0, inserted: 0, query_stats: queryStats, message: "Nenhuma playlist oficial encontrada para essas queries." });
  }

  // Hidrata followers + tracks (1 chamada por candidata, paralelizado em batch de 5)
  const hydrated: Array<{ playlist: SpPlaylist; query: string; followers: number | null; tracks: number | null }> = [];
  const BATCH = 5;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async (c) => {
      let h = await hydratePlaylist(token, c.playlist.id);
      if (h === null) {
        // Tenta refresh token + retry
        token = await getSpotifyToken(true);
        h = await hydratePlaylist(token, c.playlist.id);
      }
      return { ...c, followers: h?.followers ?? null, tracks: h?.tracks ?? null };
    }));
    hydrated.push(...results);
  }

  // Insert (UPSERT por spotify_playlist_id + genre_id — usa where pra detectar e atualizar)
  let inserted = 0;
  let updated = 0;
  const verifiedAt = new Date().toISOString();

  for (const c of hydrated) {
    const playlistId = c.playlist.id;
    const ownerId = c.playlist.owner?.id ?? null;
    const ownerType = classifyOwner(ownerId); // spotify | label | user
    const followers = c.followers;
    const tracks = c.tracks;
    const spotifyUrl = c.playlist.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlistId}`;
    const imagem = c.playlist.images?.[0]?.url ?? null;

    // quality_score básico — mesma fórmula do enrich-playlists (versão simples)
    let q = 0;
    const f = followers ?? 0;
    if (f >= 100_000) q += 50;
    else if (f >= 10_000) q += 40;
    else if (f >= 1_000) q += 30;
    else if (f >= 100) q += 15;
    else if (f > 0) q += 5;
    const t = tracks ?? 0;
    if (t >= 100) q += 30;
    else if (t >= 50) q += 20;
    else if (t >= 30) q += 12;
    else if (t >= 10) q += 5;
    if (imagem && imagem.length > 10) q += 10;
    if (c.playlist.description && c.playlist.description.trim().length >= 20) q += 10;
    const qualityScore = Math.min(100, Math.max(0, q));

    // Existe?
    const { data: existing } = await supabase
      .from("search_results")
      .select("id,times_seen")
      .eq("genre_id", body.genre_id)
      .eq("spotify_playlist_id", playlistId)
      .maybeSingle();

    if (existing) {
      await supabase.from("search_results").update({
        owner_id: ownerId,
        owner_type: ownerType,
        seguidores: followers,
        total_musicas: tracks,
        followers_source: "spotify_api",
        followers_verified_at: verifiedAt,
        enrich_failed: false,
        needs_enrich: false,
        is_valid: true,
        validation_reason: null,
        quality_score: qualityScore,
        last_seen_at: verifiedAt,
        times_seen: (existing.times_seen ?? 1) + 1,
        imagem_url: imagem,
        descricao: c.playlist.description ?? null,
        nome_playlist: c.playlist.name,
      }).eq("id", existing.id);
      updated++;
    } else {
      const { error: iErr } = await supabase.from("search_results").insert({
        genre_id: body.genre_id,
        nome_playlist: c.playlist.name,
        descricao: c.playlist.description ?? null,
        spotify_url: spotifyUrl,
        spotify_playlist_id: playlistId,
        imagem_url: imagem,
        seguidores: followers,
        total_musicas: tracks,
        owner_id: ownerId,
        owner_type: ownerType,
        followers_source: "spotify_api",
        followers_verified_at: verifiedAt,
        enrich_failed: false,
        needs_enrich: false,
        is_valid: true,
        quality_score: qualityScore,
        posicao: 0,
        times_seen: 1,
        first_seen_at: verifiedAt,
        last_seen_at: verifiedAt,
        coletado_em: verifiedAt,
        apify_run_id: null,
        term_id: null,
        score: null,
      });
      if (iErr) {
        console.error(`[fetch-featured] insert falhou pra ${playlistId}:`, iErr.message);
        continue;
      }
      inserted++;
    }
  }

  // Atualiza total_playlists do gênero
  const { count: totalGenre } = await supabase
    .from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id);
  await supabase.from("genres").update({ total_playlists: totalGenre ?? 0 }).eq("id", body.genre_id);

  await supabase.from("collection_logs").insert({
    genre_id: body.genre_id,
    acao: "fetch-spotify-featured",
    status: "sucesso",
    mensagem: `${inserted} novas + ${updated} atualizadas • ${candidates.length} oficiais via search (${queries.length} queries, mercado ${market})`,
    duracao_ms: Date.now() - start,
  });

  return jr({
    ok: true,
    genre: genre.nome,
    queries_used: queries,
    found: candidates.length,
    inserted,
    updated,
    query_stats: queryStats,
  });
});
