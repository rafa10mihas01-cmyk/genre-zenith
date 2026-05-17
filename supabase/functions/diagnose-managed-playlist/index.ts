// diagnose-managed-playlist — analisa uma playlist gerenciada contra o
// genre_model + benchmarks + concorrentes + ecosystem_score e gera:
// - sugestão de nome
// - sugestões de faixas a adicionar (do nicho, não presentes na playlist)
// - classificação faixa-a-faixa (keep | remove | promote | demote)
// - artistas faltando (presentes nos concorrentes mas não na playlist)
// - resumo de saturação + tamanho vs benchmark
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getSpotifyToken } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------- helpers ----------

async function syncTracks(authHeader: string, playlistId: string) {
  // Chama a função pública sync-managed-playlist-tracks com a mesma auth
  // (replace-all snapshot em public.managed_playlist_tracks).
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
  let j: any = {};
  try { j = JSON.parse(txt); } catch { /* ignore */ }
  return { ok: r.ok && j?.ok !== false, status: r.status, body: j, raw: txt };
}

function normName(s: any): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniq<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }

// ---------- handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const playlistId: string = body?.playlist_id;
    if (!playlistId) return jr({ ok: false, error: "playlist_id obrigatório" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: pl, error: plErr } = await supabase
      .from("managed_playlists")
      .select("*")
      .eq("id", playlistId)
      .maybeSingle();
    if (plErr || !pl) return jr({ ok: false, error: plErr?.message ?? "playlist não encontrada" }, 404);

    // 1) Snapshot fresco das faixas atuais (best-effort — se falhar, segue com cache)
    const authHeader = req.headers.get("Authorization") ?? `Bearer ${SERVICE_KEY}`;
    const syncRes = await syncTracks(authHeader, pl.id).catch((e) => ({ ok: false, error: String(e) }));

    // 2) Carrega modelo, benchmark, concorrentes, faixas atuais e ecosystem scores
    let model: any = null;
    let benchmark: any = null;
    let competitors: any[] = [];
    let genreRecurrence: Map<string, { count: number; track_name: string | null; artist_name: string | null }> = new Map();
    let genreArtistsTop: { artist: string; count: number }[] = [];

    if (pl.genre_id) {
      const [{ data: m }, { data: b }, { data: comps }, { data: srTracks }] = await Promise.all([
        supabase.from("genre_models")
          .select("palavras_chave, padroes_nome, musicas_recorrentes, insights")
          .eq("genre_id", pl.genre_id).maybeSingle(),
        supabase.from("genre_benchmarks")
          .select("followers_p50,followers_p75,followers_p90,tracks_p50,tracks_p75,tracks_p90,sample_size")
          .eq("genre_id", pl.genre_id).maybeSingle(),
        supabase.from("playlists")
          .select("spotify_playlist_id,name,followers,cover_url")
          .eq("genre_id", pl.genre_id)
          .eq("ownership", "external")
          .eq("monitored", true)
          .not("followers", "is", null)
          .order("followers", { ascending: false })
          .limit(10),
        supabase.from("search_tracks")
          .select("spotify_track_id, nome_musica, artista")
          .eq("genre_id", pl.genre_id)
          .not("spotify_track_id", "is", null)
          .limit(5000),
      ]);
      model = m;
      benchmark = b;
      competitors = (comps ?? []).map((c: any) => ({
        spotify_playlist_id: c.spotify_playlist_id,
        name: c.name,
        followers: c.followers,
        cover_url: c.cover_url,
      }));

      // Recorrência por track_id no nicho
      for (const t of srTracks ?? []) {
        if (!t.spotify_track_id) continue;
        const cur = genreRecurrence.get(t.spotify_track_id);
        if (cur) cur.count++;
        else genreRecurrence.set(t.spotify_track_id, {
          count: 1,
          track_name: t.nome_musica ?? null,
          artist_name: t.artista ?? null,
        });
      }
      // Top artistas do nicho (por nº de aparições)
      const artistCount = new Map<string, number>();
      for (const t of srTracks ?? []) {
        if (!t.artista) continue;
        // pode vir "A, B, C" — pega só o primeiro pra reduzir ruído
        const main = String(t.artista).split(",")[0].trim();
        if (!main) continue;
        artistCount.set(main, (artistCount.get(main) ?? 0) + 1);
      }
      genreArtistsTop = Array.from(artistCount.entries())
        .map(([artist, count]) => ({ artist, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30);
    }

    // 3) Faixas atuais da playlist gerenciada
    const { data: currentTracks } = await supabase
      .from("managed_playlist_tracks")
      .select("spotify_track_id, track_name, artist_name, position, added_at")
      .eq("playlist_id", pl.id)
      .order("position", { ascending: true });

    const trackIds = (currentTracks ?? []).map((t: any) => t.spotify_track_id).filter(Boolean);

    // 3.b) Denominador de saturação = nº de playlists do nicho varridas
    let nichePlaylistCount = 0;
    if (pl.genre_id) {
      const { count } = await supabase
        .from("search_results")
        .select("id", { count: "exact", head: true })
        .eq("genre_id", pl.genre_id);
      nichePlaylistCount = count ?? 0;
    }

    // 3.c) Busca sinais públicos do Spotify (popularity, release_date, artistas)
    type SpotMeta = {
      popularity: number | null;
      release_date: string | null;
      artist_id: string | null;
    };
    const spotMeta = new Map<string, SpotMeta>();
    const artistMeta = new Map<string, { popularity: number | null; followers: number | null }>();

    if (trackIds.length > 0) {
      try {
        const token = await getSpotifyToken();
        // /v1/tracks?ids= (até 50)
        for (let i = 0; i < trackIds.length; i += 50) {
          const ids = trackIds.slice(i, i + 50);
          const r = await fetch(`https://api.spotify.com/v1/tracks?ids=${ids.join(",")}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!r.ok) continue;
          const j = await r.json();
          for (const tr of j.tracks ?? []) {
            if (!tr?.id) continue;
            spotMeta.set(tr.id, {
              popularity: typeof tr.popularity === "number" ? tr.popularity : null,
              release_date: tr.album?.release_date ?? null,
              artist_id: tr.artists?.[0]?.id ?? null,
            });
          }
        }
        // /v1/artists?ids= (até 50)
        const artistIds = uniq(
          Array.from(spotMeta.values()).map((m) => m.artist_id).filter(Boolean) as string[],
        );
        for (let i = 0; i < artistIds.length; i += 50) {
          const ids = artistIds.slice(i, i + 50);
          const r = await fetch(`https://api.spotify.com/v1/artists?ids=${ids.join(",")}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!r.ok) continue;
          const j = await r.json();
          for (const ar of j.artists ?? []) {
            if (!ar?.id) continue;
            artistMeta.set(ar.id, {
              popularity: typeof ar.popularity === "number" ? ar.popularity : null,
              followers: ar.followers?.total ?? null,
            });
          }
        }
      } catch (_e) {
        // segue sem metadados — classificador degrada gracefully
      }
    }

    // 4) Classificação por faixa — sinais 100% públicos
    const totalTracks = (currentTracks ?? []).length;
    const TOP_POS = 10;
    const NOW = Date.now();

    const tracksAnalysis = (currentTracks ?? []).map((t: any) => {
      const meta = spotMeta.get(t.spotify_track_id);
      const rec = genreRecurrence.get(t.spotify_track_id);
      const recurrence = rec?.count ?? 0;
      const popularity = meta?.popularity ?? null;
      const releaseDate = meta?.release_date ?? null;
      const artist = meta?.artist_id ? artistMeta.get(meta.artist_id) : undefined;
      const artistPop = artist?.popularity ?? null;
      const artistFollowers = artist?.followers ?? null;
      const pos: number = t.position ?? 0;

      // saturation = % das playlists do nicho que tocam essa faixa
      const saturationPct = nichePlaylistCount > 0
        ? Math.min(100, Math.round((recurrence / nichePlaylistCount) * 100))
        : 0;

      // idade na playlist (dias) — se sem added_at, assume velha
      const addedAt = t.added_at ? new Date(t.added_at).getTime() : null;
      const ageDays = addedAt ? Math.floor((NOW - addedAt) / 86400000) : null;

      // idade do release (anos)
      const releaseAgeYears = releaseDate
        ? Math.max(0, (NOW - new Date(releaseDate).getTime()) / (365 * 86400000))
        : null;

      let status: "keep" | "remove" | "promote" | "demote" = "keep";
      const reasons: string[] = [];

      // 1) REMOVER saturada — todo mundo já toca, e ainda assim você enterrou ela
      if (saturationPct >= 70 && pos >= 20) {
        status = "remove";
        reasons.push(`saturada no nicho (${saturationPct}% das playlists tocam)`);
        reasons.push(`em #${pos + 1} — ocupando slot sem gerar diferencial`);
      }
      // 2) REMOVER frio — sem tração + sem recorrência + já testou tempo suficiente
      else if (popularity != null && popularity < 30 && recurrence === 0 && (ageDays == null || ageDays > 30)) {
        status = "remove";
        reasons.push(`baixa popularity (${popularity}) e ninguém no nicho toca`);
        if (ageDays != null) reasons.push(`já está há ${ageDays}d na playlist`);
      }
      // 3) PROMOVER — mercado percebeu e você ainda não
      else if (popularity != null && popularity >= 60 && recurrence >= 3 && pos >= 15) {
        status = "promote";
        reasons.push(`popularity ${popularity} + ${recurrence}× no nicho`);
        reasons.push(`enterrada em #${pos + 1} — subir pra vitrine`);
      }
      // 4) REBAIXAR — está na vitrine mas é fraca
      else if (popularity != null && popularity < 40 && pos < TOP_POS) {
        status = "demote";
        reasons.push(`na vitrine (#${pos + 1}) com popularity baixa (${popularity})`);
      }
      // 5) KEEP — explica o porquê
      else {
        if (popularity != null && popularity >= 70) reasons.push(`hit (popularity ${popularity})`);
        else if (recurrence >= 5) reasons.push(`recorrente no nicho (${recurrence}×)`);
        else if (releaseAgeYears != null && releaseAgeYears < 0.5 && popularity != null && popularity >= 50)
          reasons.push("lançamento recente em ascensão");
        else if (popularity == null) reasons.push("sem metadado do Spotify");
        else reasons.push(`estável (popularity ${popularity})`);
      }

      return {
        spotify_track_id: t.spotify_track_id,
        track_name: t.track_name,
        artist_name: t.artist_name,
        position: pos,
        status,
        reasons,
        recurrence_in_genre: recurrence,
        saturation_pct: saturationPct,
        popularity,
        artist_popularity: artistPop,
        artist_followers: artistFollowers,
        release_date: releaseDate,
        age_days_in_playlist: ageDays,
        // legacy fields (mantidos null pra compat)
        streams_28d: null,
        growth_28d_pct: null,
        saturation_index: nichePlaylistCount > 0 ? saturationPct / 100 : null,
        momentum: null,
        confidence: popularity != null ? 1 : null,
      };
    });

    // 5) Artistas presentes na playlist
    const presentArtists = new Set<string>(
      (currentTracks ?? [])
        .map((t: any) => String(t.artist_name ?? "").split(",")[0].trim().toLowerCase())
        .filter(Boolean),
    );
    const missingArtists = genreArtistsTop
      .filter((a) => !presentArtists.has(a.artist.toLowerCase()))
      .slice(0, 10);

    // 6) Resumo
    const counts = {
      total: totalTracks,
      keep: tracksAnalysis.filter((x) => x.status === "keep").length,
      remove: tracksAnalysis.filter((x) => x.status === "remove").length,
      promote: tracksAnalysis.filter((x) => x.status === "promote").length,
      demote: tracksAnalysis.filter((x) => x.status === "demote").length,
    };
    const saturatedCount = tracksAnalysis.filter((x) => x.saturation_pct >= 70).length;
    const noDataCount = tracksAnalysis.filter((x) => x.popularity == null).length;

    const tracksSummary = {
      ...counts,
      saturated: saturatedCount,
      saturated_pct: totalTracks ? Math.round((saturatedCount / totalTracks) * 100) : 0,
      no_data: noDataCount,
      missing_artists: missingArtists,
      niche_playlist_count: nichePlaylistCount,
    };

    // 7) Sugestões de faixas a ADICIONAR — do nicho, ainda não presentes na playlist
    //    Boost: faixas de artistas faltando ganham prioridade
    const currentIds = new Set(trackIds);
    const missingArtistSet = new Set(missingArtists.map((a) => a.artist.toLowerCase()));
    const N_SUGGEST = 15;

    const ranked = Array.from(genreRecurrence.entries())
      .filter(([id]) => !currentIds.has(id))
      .map(([id, v]) => {
        const mainArtist = String(v.artist_name ?? "").split(",")[0].trim().toLowerCase();
        const fromMissing = mainArtist && missingArtistSet.has(mainArtist);
        // score: recorrência + bônus se preenche artista faltando
        const score = v.count + (fromMissing ? 5 : 0);
        return {
          spotify_track_id: id,
          nome: v.track_name ?? "—",
          artista: v.artist_name ?? "—",
          count: v.count,
          from_missing_artist: !!fromMissing,
          score,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, N_SUGGEST);

    // Posições sugeridas: insere no topo (1, 2, 3...) — faixas mais quentes vão pra vitrine
    const tracksSuggestions = ranked.map((t, i) => ({
      ...t,
      suggested_position: i + 1,
    }));

    // Adiciona contagem ao summary pra UI exibir KPI "ADICIONAR"
    (tracksSummary as any).add = tracksSuggestions.length;
    (tracksSummary as any).add_from_missing = tracksSuggestions.filter((t) => t.from_missing_artist).length;


    // 8) Análise de nome (igual ao anterior)
    const nameLower = (pl.name ?? "").toLowerCase();
    const keywords: string[] = Array.isArray(model?.palavras_chave)
      ? model.palavras_chave
          .map((k: any) => (typeof k === "string" ? k : (k?.value ?? k?.termo ?? "")))
          .filter(Boolean)
      : [];
    const topKeywords = keywords.slice(0, 10);
    const present = topKeywords.filter((k) => nameLower.includes(k.toLowerCase()));
    const missing = topKeywords.filter((k) => !nameLower.includes(k.toLowerCase())).slice(0, 8);
    const nameScore = topKeywords.length > 0 ? Math.round((present.length / topKeywords.length) * 100) : null;
    const nameReasons: any[] = missing.map((k) => ({ type: "missing_keyword", value: k }));
    if (benchmark?.tracks_p50 && totalTracks > 0) {
      if (totalTracks > benchmark.tracks_p90) {
        nameReasons.push({ type: "too_many_tracks", value: totalTracks, benchmark_p90: benchmark.tracks_p90 });
      } else if (totalTracks < benchmark.tracks_p50 / 2) {
        nameReasons.push({ type: "too_few_tracks", value: totalTracks, benchmark_p50: benchmark.tracks_p50 });
      }
    }
    const nameSuggestion = missing.length > 0
      ? `${pl.name} ${missing.slice(0, 2).map((k) => k.toUpperCase()).join(" ")}`
      : null;

    // 9) Persiste diagnóstico
    const { data: diag, error: dErr } = await supabase
      .from("playlist_diagnoses")
      .insert({
        playlist_id: pl.id,
        created_by: guard.via === "user" ? guard.userId : null,
        name_score: nameScore,
        name_current: pl.name,
        name_suggestion: nameSuggestion,
        name_reasons: nameReasons,
        tracks_suggestions: tracksSuggestions,
        tracks_analysis: tracksAnalysis,
        tracks_summary: tracksSummary,
        cover_suggestion: model?.insights?.cover ?? model?.insights?.dna_visual ?? {},
        competitors,
        raw: {
          model_present: !!model,
          benchmark,
          top_keywords: topKeywords,
          present_keywords: present,
          sync_ok: syncRes?.ok ?? false,
          sync_error: syncRes?.ok ? null : (syncRes as any)?.body?.error ?? (syncRes as any)?.error ?? null,
        },
      })
      .select()
      .single();

    if (!dErr) {
      await supabase.from("managed_playlists")
        .update({ last_diagnosis_at: new Date().toISOString() })
        .eq("id", pl.id);
    }

    return jr({ ok: true, diagnosis: diag, error: dErr?.message, sync: syncRes });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
