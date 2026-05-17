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

    // 3) Faixas atuais da playlist gerenciada + ecosystem scores
    const { data: currentTracks } = await supabase
      .from("managed_playlist_tracks")
      .select("spotify_track_id, track_name, artist_name, position, added_at")
      .eq("playlist_id", pl.id)
      .order("position", { ascending: true });

    const trackIds = (currentTracks ?? []).map((t: any) => t.spotify_track_id).filter(Boolean);
    let scoreMap = new Map<string, any>();
    if (trackIds.length > 0) {
      const { data: scores } = await supabase
        .from("track_ecosystem_score")
        .select("spotify_track_id, streams_28d, growth_28d_pct, acceleration, saturation_index, momentum_class, confidence")
        .in("spotify_track_id", trackIds);
      for (const s of scores ?? []) scoreMap.set(s.spotify_track_id, s);
    }

    // 4) Classificação por faixa
    const TOP_POS = 10;            // posições "vitrine"
    const SATURATION_HIGH = 0.7;   // satura excessiva
    const totalTracks = (currentTracks ?? []).length;

    const tracksAnalysis = (currentTracks ?? []).map((t: any) => {
      const sc = scoreMap.get(t.spotify_track_id) ?? null;
      const rec = genreRecurrence.get(t.spotify_track_id);
      const recurrence = rec?.count ?? 0;
      const growth = sc?.growth_28d_pct != null ? Number(sc.growth_28d_pct) : null;
      const saturation = sc?.saturation_index != null ? Number(sc.saturation_index) : null;
      const momentum: string | null = sc?.momentum_class ?? null;
      const pos: number = t.position ?? 0;

      // Default
      let status: "keep" | "remove" | "promote" | "demote" = "keep";
      const reasons: string[] = [];

      // REMOVE: 0 ocorrências no nicho E (caindo OU saturada)
      const declining = (growth != null && growth < -10) || momentum === "encolhendo" || momentum === "morta";
      if (recurrence === 0 && (declining || (saturation != null && saturation > SATURATION_HIGH))) {
        status = "remove";
        if (recurrence === 0) reasons.push("não aparece em nenhuma playlist concorrente do nicho");
        if (declining) reasons.push(`em declínio (${growth != null ? growth.toFixed(0) + "% 28d" : momentum})`);
        if (saturation != null && saturation > SATURATION_HIGH) reasons.push(`saturada no ecossistema (${(saturation * 100).toFixed(0)}%)`);
      }
      // PROMOTE: fora do topo + crescendo forte + recorrente no nicho
      else if (pos >= TOP_POS && recurrence >= 3 && (momentum === "crescendo" || (growth != null && growth > 20))) {
        status = "promote";
        reasons.push(`top performer em posição #${pos + 1}`);
        if (recurrence >= 3) reasons.push(`recorrente em ${recurrence} concorrentes`);
        if (growth != null) reasons.push(`+${growth.toFixed(0)}% 28d`);
      }
      // DEMOTE: na vitrine mas com momentum caindo
      else if (pos < TOP_POS && (momentum === "encolhendo" || (growth != null && growth < -5))) {
        status = "demote";
        reasons.push(`na vitrine (#${pos + 1}) mas perdendo força`);
        if (growth != null) reasons.push(`${growth.toFixed(0)}% 28d`);
      }
      // KEEP: tudo o resto
      else {
        if (recurrence >= 5) reasons.push(`alta recorrência no nicho (${recurrence}×)`);
        else if (momentum === "crescendo") reasons.push("momentum positivo");
        else if (!sc) reasons.push("sem dados de performance ainda");
        else reasons.push("performance estável");
      }

      return {
        spotify_track_id: t.spotify_track_id,
        track_name: t.track_name,
        artist_name: t.artist_name,
        position: pos,
        status,
        reasons,
        recurrence_in_genre: recurrence,
        streams_28d: sc?.streams_28d ?? null,
        growth_28d_pct: growth,
        saturation_index: saturation,
        momentum: momentum,
        confidence: sc?.confidence ?? null,
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
    const saturatedCount = tracksAnalysis.filter((x) => x.saturation_index != null && x.saturation_index > SATURATION_HIGH).length;
    const noDataCount = tracksAnalysis.filter((x) => x.confidence == null).length;

    const tracksSummary = {
      ...counts,
      saturated: saturatedCount,
      saturated_pct: totalTracks ? Math.round((saturatedCount / totalTracks) * 100) : 0,
      no_data: noDataCount,
      missing_artists: missingArtists,
    };

    // 7) Sugestões de faixas a ADICIONAR — do nicho, ainda não presentes na playlist
    const currentIds = new Set(trackIds);
    const tracksSuggestions = Array.from(genreRecurrence.entries())
      .filter(([id]) => !currentIds.has(id))
      .map(([id, v]) => ({
        spotify_track_id: id,
        nome: v.track_name ?? "—",
        artista: v.artist_name ?? "—",
        count: v.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

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
