// genre-spotify-discover — Esteira UNIFICADA (Spotify API direto).
// Onda 1: aplica o MESMO gate textual / blacklist / Phase-2 gate / quality_score
// usado por run-search. Nenhuma playlist entra com is_valid=true sem passar
// pelos filtros + sem enrich obrigatório.
//
// POST { genre_id: string, max_terms?: number, max_playlists_per_term?: number, max_tracks_per_playlist?: number }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { SpotifyCircuitOpenError } from "../_shared/spotify-client.ts";
import { ccFetch } from "../_shared/catalog-gateway.ts";
import { getPlaylistMeta } from "../_shared/spotify-playlist.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_MS = 300;
import {
  loadGateContext,
  scoreAndGate,
  computeQualityScore,
  phase2Fail,
  QUALITY_SCORE_VERSION,
} from "../_shared/discovery-scoring.ts";
import { classifyOwner } from "../_shared/labels.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const YEAR = new Date().getFullYear();

function defaultTerms(slug: string, nome: string): string[] {
  const base = nome || slug;
  return [
    `${base} ${YEAR}`,
    `${base} atualizada`,
    `${base} top`,
    `${base} as melhores`,
    `${base} mais tocadas`,
    `${base} viral`,
    `${base} hits`,
    `melhor ${base}`,
  ];
}

async function searchSpotify(url: string): Promise<any> {
  // Lê via Catalog Gateway (CC pool NexEngine 05/10). Preserva tratamento de 429
  // que o wrapper anterior tinha (lança erro pra cima — caller decide).
  let r: Response;
  try {
    r = await ccFetch(url, "genre-spotify-discover");
  } catch (e) {
    if (e instanceof SpotifyCircuitOpenError) throw e;
    throw e;
  }
  if (r.status === 429) {
    const txt = await r.text().catch(() => "");
    throw new Error(`spotify 429: ${txt.slice(0, 180)}`);
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`spotify ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const genreId: string = body?.genre_id;
    const maxTerms = Math.min(Math.max(Number(body?.max_terms ?? 8), 1), 20);
    const maxPlsPerTerm = Math.min(Math.max(Number(body?.max_playlists_per_term ?? 20), 1), 50);
    const maxTracksPerPl = Math.min(Math.max(Number(body?.max_tracks_per_playlist ?? 40), 1), 100);

    if (!genreId) return jr({ ok: false, error: "genre_id obrigatório" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: genre } = await supabase
      .from("genres")
      .select("id, slug, nome")
      .eq("id", genreId)
      .maybeSingle();
    if (!genre) return jr({ ok: false, error: "gênero não encontrado" }, 404);

    const stats = {
      genre: { id: genre.id, slug: genre.slug, nome: genre.nome },
      terms_used: 0,
      playlists_seen: 0,
      playlists_upserted: 0,
      playlists_rejected_gate: 0,
      playlists_phase2_failed: 0,
      tracks_upserted: 0,
      errors: [] as string[],
    };

    // 1) Termos: do banco ou defaults.
    let { data: termRows } = await supabase
      .from("search_terms")
      .select("id, termo")
      .eq("genre_id", genreId)
      .limit(maxTerms);

    if (!termRows || termRows.length === 0) {
      const defaults = defaultTerms(genre.slug, genre.nome);
      const inserted: { id: string; termo: string }[] = [];
      for (const termo of defaults.slice(0, maxTerms)) {
        const { data: ins, error: insErr } = await supabase
          .from("search_terms")
          .insert({ genre_id: genreId, termo, tipo: "auto" })
          .select("id, termo")
          .single();
        if (insErr) stats.errors.push(`insert term "${termo}": ${insErr.message}`);
        if (ins) inserted.push(ins);
      }
      termRows = inserted;
    }
    stats.terms_used = termRows.length;

    // Token gerenciado pelo Catalog Gateway.
    const gateCtx = await loadGateContext(supabase, genreId);

    const seenPlaylistIds = new Set<string>();

    for (let ti = 0; ti < termRows.length; ti++) {
      if (ti > 0) await sleep(THROTTLE_MS);
      const term = termRows[ti];
      try {
        const url = `https://api.spotify.com/v1/search?type=playlist&limit=${maxPlsPerTerm}&q=${encodeURIComponent(term.termo)}`;
        const data = await searchSpotify(url);
        const items = data?.playlists?.items ?? [];
        const ctxForTerm = { ...gateCtx, termLower: term.termo.toLowerCase() };

        for (let i = 0; i < items.length; i++) {
          const p = items[i];
          if (!p || !p.id) continue;
          stats.playlists_seen++;
          if (seenPlaylistIds.has(p.id)) continue;
          seenPlaylistIds.add(p.id);

          const nomePl = p.name ?? "(sem nome)";
          const followers = p.followers?.total ?? null;
          const totalTracks = p.tracks?.total ?? null;
          const img = p.images?.[0]?.url ?? null;
          const descricao = p.description ?? null;

          // ====== GATE UNIFICADO (mesmo do run-search) ======
          const gate = scoreAndGate(ctxForTerm, { nomePl, descricao, followers });
          if (gate.hardBlock) {
            stats.playlists_rejected_gate++;
            continue;
          }

          // ====== ENRICH OBRIGATÓRIO (Spotify detail) ======
          let detailFollowers = followers;
          let detailTracks = totalTracks;
          let ownerId: string | null = null;
          let ownerType: string | null = null;
          let trackItems: any[] = [];
          try {
            const meta = await getPlaylistMeta(p.id, token, {
              fields: `followers(total),tracks(total,items(track(id,name,artists(name)))),owner(id)`,
            });
            const detail = meta.raw;
            if (detail?.followers?.total != null) detailFollowers = detail.followers.total;
            if (detail?.tracks?.total != null) detailTracks = detail.tracks.total;
            ownerId = detail?.owner?.id ?? null;
            ownerType = ownerId ? classifyOwner(ownerId) : null;
            trackItems = detail?.tracks?.items ?? [];
          } catch (e) {
            stats.errors.push(`detail ${p.id}: ${(e as Error).message}`);
          }

          // Phase-2 gate
          const failed = phase2Fail(detailFollowers, detailTracks);
          const qScore = computeQualityScore({
            followers: detailFollowers,
            totalTracks: detailTracks,
            descricao,
            imagem: img,
          });
          if (failed) stats.playlists_phase2_failed++;

          const verifiedAt = new Date().toISOString();
          const payload: Record<string, unknown> = {
            genre_id: genreId,
            term_id: term.id,
            nome_playlist: nomePl,
            posicao: i + 1,
            spotify_url: p.external_urls?.spotify ?? `https://open.spotify.com/playlist/${p.id}`,
            spotify_playlist_id: p.id,
            seguidores: detailFollowers,
            imagem_url: img,
            descricao,
            total_musicas: detailTracks,
            followers_source: "spotify_api",
            followers_verified_at: verifiedAt,
            enriched_at: verifiedAt,
            quality_score: qScore,
            quality_score_version: QUALITY_SCORE_VERSION,
            quality_flag: failed || qScore < 40 ? "low_quality" : null,
            quality_flagged_at: failed || qScore < 40 ? verifiedAt : null,
            is_valid: !failed,
            validation_reason: failed ? "low_quality_post_enrich" : null,
            needs_enrich: false,
            enrich_failed: false,
            score: gate.score,
            owner_id: ownerId,
            owner_type: ownerType,
            last_seen_at: verifiedAt,
          };

          const { data: existing } = await supabase
            .from("search_results")
            .select("id, times_seen")
            .eq("spotify_playlist_id", p.id)
            .eq("genre_id", genreId)
            .maybeSingle();

          let resultId: string | null = null;
          if (existing) {
            await supabase
              .from("search_results")
              .update({ ...payload, times_seen: (existing.times_seen ?? 1) + 1 })
              .eq("id", existing.id);
            resultId = existing.id;
          } else {
            const { data: ins } = await supabase
              .from("search_results")
              .insert({ ...payload, times_seen: 1 })
              .select("id")
              .single();
            if (ins) {
              stats.playlists_upserted++;
              resultId = ins.id;
            }
          }

          // Tracks
          if (resultId && trackItems.length > 0) {
            const trackRows = trackItems
              .map((it: any, idx: number) => {
                const t = it?.track;
                if (!t || !t.id) return null;
                return {
                  genre_id: genreId,
                  result_id: resultId!,
                  nome_musica: t.name ?? "",
                  artista: (t.artists ?? []).map((a: any) => a.name).filter(Boolean).join(", "),
                  spotify_track_id: t.id,
                  posicao_na_playlist: idx + 1,
                };
              })
              .filter(Boolean) as any[];
            if (trackRows.length > 0) {
              await supabase.from("search_tracks").delete().eq("result_id", resultId);
              const { error: tErr } = await supabase.from("search_tracks").insert(trackRows);
              if (!tErr) stats.tracks_upserted += trackRows.length;
            }
          }
        }
      } catch (e) {
        stats.errors.push(`term "${term.termo}": ${(e as Error).message}`);
      }
    }

    return jr({ ok: true, ...stats });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
