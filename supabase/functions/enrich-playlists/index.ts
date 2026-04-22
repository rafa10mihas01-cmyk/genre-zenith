// enrich-playlists — busca followers reais via Spotify Web API + tracks via Apify
// Logs granulares por playlist + retry com backoff em 429/5xx + telemetria completa.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getSpotifyToken } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY")!;
const APIFY_ACTOR = "automation-lab~spotify-scraper";

interface Body {
  genre_id?: string;
  limit?: number;
  fetch_tracks?: boolean;
  prioritize?: boolean; // ordena por posição/relevância
  keyword?: string;     // keyword principal pra boost
  result_ids?: string[]; // modo seletivo: enriquecer apenas estes IDs (ignora prioritize/keyword)
}

function extractPlaylistId(url: string): string | null {
  const m = url.match(/playlist\/([A-Za-z0-9]+)/);
  return m?.[1] ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ============ PHASE 2 (POST-ENRICH VALIDATION) ============
// Avalia qualidade APÓS termos números reais do Spotify.
// Fontes da verdade: followers + total_musicas vindos da Spotify Web API.
const PHASE2_MIN_FOLLOWERS = 100;
const PHASE2_MIN_TRACKS = 20;

function computeQualityScore(opts: {
  followers: number | null;
  totalTracks: number | null;
  descricao: string | null;
  imagem: string | null;
}): number {
  const { followers, totalTracks, descricao, imagem } = opts;
  let q = 0;
  const f = followers ?? 0;
  if (f >= 100_000) q += 50;
  else if (f >= 10_000) q += 40;
  else if (f >= 1_000) q += 30;
  else if (f >= 100) q += 15;
  else if (f > 0) q += 5;

  const t = totalTracks ?? 0;
  if (t >= 100) q += 30;
  else if (t >= 50) q += 20;
  else if (t >= 30) q += 12;
  else if (t >= 10) q += 5;

  if (imagem && imagem.length > 10) q += 10;
  if (descricao && descricao.trim().length >= 20) q += 10;

  return Math.min(100, Math.max(0, q));
}

type SpotifyResp = { followers: number | null; total: number | null; status: number };

async function fetchSpotifyPlaylist(id: string, token: string): Promise<SpotifyResp> {
  const url = `https://api.spotify.com/v1/playlists/${id}?fields=followers(total),tracks(total)`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) { await r.text().catch(() => ""); throw new Error("TOKEN_EXPIRED"); }
  if (r.status === 429) {
    const retry = Number(r.headers.get("Retry-After") ?? "2");
    await r.text().catch(() => "");
    throw new Error(`RATE_LIMIT:${retry}`);
  }
  if (r.status === 404) { await r.text().catch(() => ""); return { followers: null, total: null, status: 404 }; }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Spotify ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return {
    followers: j?.followers?.total ?? null,
    total: j?.tracks?.total ?? null,
    status: 200,
  };
}

async function fetchApifyTracks(playlistUrl: string): Promise<any[]> {
  const apifyUrl = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=120`;
  const r = await fetch(apifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "urls", urls: [playlistUrl], proxy: { useApifyProxy: true } }),
  });
  if (!r.ok) { await r.text().catch(() => ""); return []; }
  const items = await r.json();
  if (!Array.isArray(items) || !items[0]) return [];
  return Array.isArray(items[0].tracks) ? items[0].tracks : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const start = Date.now();
  let body: Body = {};
  try { body = await req.json(); } catch { /* default */ }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const samples: any[] = [];
  const errorSamples: any[] = [];

  try {
    const limit = Math.min(body.limit ?? 50, 100);
    // 💰 Fase 1: tracks via Apify DESLIGADO por padrão (custo ~70% do enrich).
    // Tracks reais agora vêm via fetch-tracks-spotify (on-demand, custo zero Apify).
    // Mantido como opt-in pra compatibilidade, mas NÃO recomendado.
    const fetchTracks = body.fetch_tracks === true;

    // Pega playlists pendentes — modo seletivo (result_ids) tem prioridade
    // 🛡️ filtra enrich_failed=false sempre — zumbis nunca são reprocessadas
    // 🛡️ filtra enrich_attempted_at < (agora - 1h) — evita retry em loop dentro da mesma janela
    const RETRY_COOLDOWN_MS = 60 * 60 * 1000; // 1h
    const MAX_ENRICH_ATTEMPTS = 3;
    const cooldownIso = new Date(Date.now() - RETRY_COOLDOWN_MS).toISOString();

    let pending: any[] | null = null;
    if (body.result_ids && body.result_ids.length > 0) {
      const { data, error: pErr } = await supabase
        .from("search_results")
        .select("id,genre_id,spotify_url,nome_playlist,posicao,enrich_attempts,descricao,imagem_url")
        .in("id", body.result_ids.slice(0, limit))
        .eq("enrich_failed", false)
        .is("seguidores", null)
        .not("spotify_url", "is", null);
      if (pErr) throw pErr;
      pending = data;
    } else {
      let q = supabase
        .from("search_results")
        .select("id,genre_id,spotify_url,nome_playlist,posicao,enrich_attempts,descricao,imagem_url")
        .eq("enrich_failed", false)
        .is("seguidores", null)
        .not("spotify_url", "is", null)
        .or(`enrich_attempted_at.is.null,enrich_attempted_at.lt.${cooldownIso}`);
      if (body.genre_id) q = q.eq("genre_id", body.genre_id);
      q = body.prioritize
        ? q.order("posicao", { ascending: true }).limit(limit)
        : q.order("coletado_em", { ascending: false }).limit(limit);
      const { data, error: pErr } = await q;
      if (pErr) throw pErr;
      pending = data;

      // Boost: se keyword fornecida, sobe quem tem keyword no nome pro topo
      if (pending && body.keyword) {
        const kw = body.keyword.toLowerCase();
        pending = [...pending].sort((a, b) => {
          const aHas = (a.nome_playlist ?? "").toLowerCase().includes(kw) ? 0 : 1;
          const bHas = (b.nome_playlist ?? "").toLowerCase().includes(kw) ? 0 : 1;
          return aHas - bHas;
        });
      }
    }

    console.log(`[enrich] genre=${body.genre_id ?? "all"} pending=${pending?.length ?? 0} limit=${limit}`);

    if (!pending || pending.length === 0) {
      // Conta quantas playlists totais existem pra esse gênero pra dar contexto
      let context: any = {};
      if (body.genre_id) {
        const { count: total } = await supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id);
        const { count: semUrl } = await supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id).is("spotify_url", null);
        const { count: jaEnriq } = await supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id).not("seguidores", "is", null);
        context = { total_no_genero: total, sem_spotify_url: semUrl, ja_enriquecidas: jaEnriq };
      }
      return new Response(
        JSON.stringify({ ok: true, message: "Nenhuma playlist para enriquecer", enriched: 0, processed: 0, context }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let token = await getSpotifyToken();
    let enriched = 0, tracksSaved = 0, errors = 0, skipped = 0, phase2Flagged = 0, phase2Cleared = 0;
    const CONCURRENCY = 5;
    let zombiesMarked = 0;

    // Helper: registra tentativa (attempted_at + attempts++); se atingir teto, marca como zumbi.
    async function markAttempt(p: any, opts: { failed?: boolean; reason?: string } = {}) {
      const nextAttempts = (p.enrich_attempts ?? 0) + 1;
      const shouldZombify = opts.failed && nextAttempts >= MAX_ENRICH_ATTEMPTS;
      const patch: Record<string, unknown> = {
        enrich_attempted_at: new Date().toISOString(),
        enrich_attempts: nextAttempts,
      };
      if (shouldZombify) {
        patch.enrich_failed = true;
        zombiesMarked++;
      }
      await supabase.from("search_results").update(patch).eq("id", p.id);
      if (shouldZombify) {
        console.log(`[enrich] 🧟 zumbi: ${p.nome_playlist} (${nextAttempts} tent, motivo=${opts.reason ?? "?"})`);
      }
    }

    // Processa uma única playlist (Spotify + Apify tracks). Mutações de contadores via refs.
    async function processOne(p: any) {
      const id = p.spotify_url ? extractPlaylistId(p.spotify_url) : null;
      if (!id) {
        skipped++;
        await markAttempt(p, { failed: true, reason: "no_playlist_id" });
        return;
      }

      // Spotify followers + total — com retry para 429/token
      let info: SpotifyResp | null = null;
      let attempts = 0;
      let permanentError: string | null = null;
      while (attempts < 3 && !info) {
        attempts++;
        try {
          info = await fetchSpotifyPlaylist(id, token);
        } catch (e) {
          const msg = (e as Error).message;
          if (msg === "TOKEN_EXPIRED") {
            console.log(`[enrich] token expirado, refresh (tent ${attempts})`);
            token = await getSpotifyToken(true);
            continue;
          }
          if (msg.startsWith("RATE_LIMIT:")) {
            const wait = (Number(msg.split(":")[1]) || 2) * 1000;
            console.log(`[enrich] rate limit, esperando ${wait}ms`);
            await sleep(wait);
            continue;
          }
          errors++;
          permanentError = msg;
          if (errorSamples.length < 5) errorSamples.push({ playlist: p.nome_playlist, id, error: msg.slice(0, 200) });
          console.error(`[enrich] erro permanente em ${p.nome_playlist}:`, msg);
          break;
        }
      }
      if (!info) {
        await markAttempt(p, { failed: true, reason: permanentError ?? "spotify_unreachable" });
        return;
      }

      // 404 do Spotify — playlist deletada/privada → vira zumbi imediato
      if (info.status === 404) {
        await markAttempt(p, { failed: true, reason: "spotify_404" });
        skipped++;
        return;
      }

      const hasData = info.followers !== null || info.total !== null;
      if (hasData) {
        const update: Record<string, unknown> = {
          enrich_attempted_at: new Date().toISOString(),
          enrich_attempts: (p.enrich_attempts ?? 0) + 1,
        };
        if (info.followers !== null) update.seguidores = info.followers;
        if (info.total !== null) update.total_musicas = info.total;

        // ============ PHASE 2 (POST-ENRICH VALIDATION) ============
        // Agora temos números reais → escreve is_valid + validation_reason DEFINITIVOS.
        // Regra: followers < MIN_FOLLOWERS OU tracks < MIN_TRACKS
        //        → is_valid=false, validation_reason="low_quality_post_enrich", quality_flag="low_quality"
        // Caso contrário: is_valid=true, validation_reason=null, quality_flag=null
        const effFollowers = info.followers;
        const effTracks = info.total;
        const phase2Fail =
          (effFollowers != null && effFollowers < PHASE2_MIN_FOLLOWERS) ||
          (effTracks != null && effTracks < PHASE2_MIN_TRACKS);
        const qualityScore = computeQualityScore({
          followers: effFollowers,
          totalTracks: effTracks,
          descricao: p.descricao ?? null,
          imagem: p.imagem_url ?? null,
        });
        update.quality_score = qualityScore;
        update.needs_enrich = false; // já enriquecida → sai da fila

        if (phase2Fail) {
          update.is_valid = false;
          update.validation_reason = "low_quality_post_enrich";
          update.quality_flag = "low_quality";
          update.quality_flagged_at = new Date().toISOString();
          phase2Flagged++;
        } else {
          update.is_valid = true;
          update.validation_reason = null;
          // Mantém flag por quality_score<40 (vitalidade), independente do gate Phase 2
          if (qualityScore < 40) {
            update.quality_flag = "low_quality";
            update.quality_flagged_at = new Date().toISOString();
          } else {
            update.quality_flag = null;
            update.quality_flagged_at = null;
          }
          phase2Cleared++;
        }

        const { error: uErr } = await supabase.from("search_results").update(update).eq("id", p.id);
        if (uErr) {
          errors++;
          console.error(`[enrich] update DB falhou em ${p.nome_playlist}:`, uErr.message);
          await markAttempt(p, { failed: true, reason: "db_update_failed" });
          return;
        }
        enriched++;
        if (samples.length < 3) samples.push({
          playlist: p.nome_playlist,
          followers: info.followers,
          total: info.total,
          quality_score: qualityScore,
          is_valid: !phase2Fail,
          validation_reason: phase2Fail ? "low_quality_post_enrich" : null,
        });
      } else {
        skipped++;
        await markAttempt(p, { failed: true, reason: "spotify_empty" });
        return;
      }

      // Tracks via Apify (apenas se solicitado) — esta é a chamada mais lenta (~10s)
      if (fetchTracks && p.genre_id) {
        try {
          const tracks = await fetchApifyTracks(p.spotify_url!);
          if (tracks.length > 0) {
            await supabase.from("search_tracks").delete().eq("result_id", p.id);
            const rows = tracks.slice(0, 100).map((t: any, idx: number) => ({
              genre_id: p.genre_id,
              result_id: p.id,
              nome_musica: t.title ?? t.name ?? "Desconhecida",
              artista: t.artists ?? t.artist ?? "Desconhecido",
              spotify_track_id: t.trackId ?? t.id ?? null,
              posicao_na_playlist: idx + 1,
            }));
            const { error: tErr } = await supabase.from("search_tracks").insert(rows);
            if (!tErr) tracksSaved += rows.length;
            else console.error(`[enrich] insert tracks falhou:`, tErr.message);
          }
        } catch (e) {
          console.error(`[enrich] apify tracks falhou em ${p.nome_playlist}:`, (e as Error).message);
        }
      }
    }

    // Roda em batches paralelos de CONCURRENCY playlists
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(processOne));
    }

    // Atualiza totais do gênero processado
    if (body.genre_id) {
      const [{ count: pCount }, { count: tCount }] = await Promise.all([
        supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id),
        supabase.from("search_tracks").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id),
      ]);
      await supabase.from("genres").update({
        total_playlists: pCount ?? 0,
        total_musicas: tCount ?? 0,
      }).eq("id", body.genre_id);
    }

    const status = errors === 0 ? "sucesso" : (enriched > 0 ? "parcial" : "erro");
    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id ?? null,
      acao: "enrich-playlists",
      status,
      mensagem: `Enriquecidas ${enriched}/${pending.length} • ${tracksSaved} tracks • ${errors} erros • ${skipped} ignoradas • ${zombiesMarked} zumbis • phase2: ${phase2Flagged} low_quality / ${phase2Cleared} ok${errorSamples.length ? " • ex: " + errorSamples[0].error.slice(0, 80) : ""}`,
      duracao_ms: Date.now() - start,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        processed: pending.length,
        enriched,
        tracks_saved: tracksSaved,
        errors,
        skipped,
        zombies_marked: zombiesMarked,
        phase2_flagged_low_quality: phase2Flagged,
        phase2_passed: phase2Cleared,
        samples,
        error_samples: errorSamples,
        remaining_estimate: pending.length === limit ? "≥ próximo lote" : 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("enrich-playlists fatal", msg);
    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id ?? null,
      acao: "enrich-playlists",
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
