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

    // 3.a) CAMPANHAS ATIVAS NA PLAYLIST — faixas com deal em andamento entram em estado PROTEGIDO.
    // O analisador NÃO pode recomendar remover, rebaixar ou promover uma faixa em campanha ativa:
    // ela tem meta + obrigação operacional. Só ajustes suaves dentro da própria zona.
    type ProtectedTrack = {
      campaign_id: string;
      campaign_status: string;
      planned_streams: number;
      allocation_status: string;
    };
    const protectedTracks = new Map<string, ProtectedTrack>();
    {
      const { data: protRows } = await supabase
        .from("campaign_eco_allocations")
        .select("campaign_id, planned_streams, status, campaigns!inner(id, spotify_track_id, status)")
        .eq("managed_playlist_id", pl.id)
        .in("status", ["pending", "dispatched", "active"])
        .in("campaigns.status", ["draft", "active", "paused"]);
      for (const row of (protRows ?? []) as any[]) {
        const tid = row.campaigns?.spotify_track_id;
        if (!tid) continue;
        // Se a mesma faixa tiver várias allocations, mantém a mais "forte"
        const prev = protectedTracks.get(tid);
        const cur: ProtectedTrack = {
          campaign_id: row.campaign_id,
          campaign_status: row.campaigns.status,
          planned_streams: Number(row.planned_streams ?? 0),
          allocation_status: row.status,
        };
        if (!prev || cur.planned_streams > prev.planned_streams) protectedTracks.set(tid, cur);
      }
    }

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

      let status: "keep" | "remove" | "promote" | "demote" | "protected" = "keep";
      const reasons: string[] = [];
      const protectedInfo = protectedTracks.get(t.spotify_track_id);

      // 0) PROTEGIDA — faixa com campanha ativa. Tem meta + obrigação operacional.
      //    Não pode ser removida nem rebaixada automaticamente.
      if (protectedInfo) {
        status = "protected";
        const statusLabel = protectedInfo.campaign_status === "active" ? "ativa"
          : protectedInfo.campaign_status === "draft" ? "em rascunho"
          : "pausada";
        reasons.push(`campanha ${statusLabel} entregando meta nesta faixa`);
        if (protectedInfo.planned_streams > 0) {
          reasons.push(`${protectedInfo.planned_streams.toLocaleString("pt-BR")} streams planejados nesta playlist`);
        }
        reasons.push("não pode ser removida ou rebaixada enquanto a campanha rodar");
      }
      // 1) REMOVER saturada — todo mundo já toca, e ainda assim você enterrou ela
      else if (saturationPct >= 70 && pos >= 20) {
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
        // campaign protection
        is_protected: !!protectedInfo,
        protected_campaign_id: protectedInfo?.campaign_id ?? null,
        protected_campaign_status: protectedInfo?.campaign_status ?? null,
        protected_planned_streams: protectedInfo?.planned_streams ?? null,
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
      protected: tracksAnalysis.filter((x) => x.status === "protected").length,
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

    // 8.b) Sugestão de DESCRIÇÃO — combina template do nicho + palavras faltando
    const descLower = (pl.description ?? "").toLowerCase();
    const missingInDesc = topKeywords
      .filter((k) => !descLower.includes(k.toLowerCase()))
      .slice(0, 5);
    const descTemplate: string | null = model?.insights?.descricao_padrao
      ?? model?.insights?.descricao
      ?? null;
    let suggestedDescription: string | null = null;
    if (descTemplate) {
      suggestedDescription = String(descTemplate);
    } else if (missingInDesc.length > 0) {
      // Template genérico: nome do nicho + palavras quentes + chamada
      const hot = missingInDesc.slice(0, 4).join(" · ");
      suggestedDescription = `As ${totalTracks} mais tocadas · ${hot} · atualizada toda semana`;
    }

    // 8.c) target_position para PROMOTE/DEMOTE
    //      Promote: empurra pra top 10 (posições baseadas em popularity rank)
    //      Demote: empurra pra meio/fim (posições 40+)
    const promoteCandidates = tracksAnalysis
      .filter((t) => t.status === "promote")
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    promoteCandidates.forEach((t, i) => {
      (t as any).target_position = Math.min(10, 3 + i); // #3, #4, #5...
    });
    const demoteCandidates = tracksAnalysis
      .filter((t) => t.status === "demote")
      .sort((a, b) => (a.popularity ?? 0) - (b.popularity ?? 0));
    demoteCandidates.forEach((t, i) => {
      (t as any).target_position = Math.max(30, totalTracks - 20 + i);
    });

    // 8.d) market_insights — usa benchmark + genreRecurrence + genreArtistsTop
    const topRecurringTracks = Array.from(genreRecurrence.entries())
      .map(([id, v]) => ({
        spotify_track_id: id,
        title: v.track_name,
        artist: v.artist_name,
        niche_playlists_count: v.count,
      }))
      .sort((a, b) => b.niche_playlists_count - a.niche_playlists_count)
      .slice(0, 8);

    const marketInsights = {
      ideal_track_count_range: benchmark
        ? [benchmark.tracks_p50, benchmark.tracks_p90].filter((x: any) => x != null)
        : null,
      followers_p50: benchmark?.followers_p50 ?? null,
      followers_p75: benchmark?.followers_p75 ?? null,
      followers_p90: benchmark?.followers_p90 ?? null,
      avg_saturation_pct: tracksAnalysis.length
        ? Math.round(tracksAnalysis.reduce((a, t) => a + (t.saturation_pct ?? 0), 0) / tracksAnalysis.length)
        : null,
      top_artists: genreArtistsTop.slice(0, 8).map((a) => ({
        name: a.artist,
        plays_in_niche: a.count,
      })),
      top_recurring_tracks: topRecurringTracks,
      leader_playlists: competitors.slice(0, 6),
      niche_playlist_count: nichePlaylistCount,
    };

    // 8.e) health_status — derivado de saturação + tamanho + sinais
    let healthStatus: "aquecido" | "saudavel" | "frio" = "saudavel";
    const removeRatio = counts.total > 0 ? counts.remove / counts.total : 0;
    if (removeRatio >= 0.25 || (saturatedCount / Math.max(1, counts.total)) >= 0.5) {
      healthStatus = "frio";
    } else if (counts.promote > 0 && removeRatio < 0.1) {
      healthStatus = "aquecido";
    }

    // 8.f) niche_rank — posição entre concorrentes do mesmo gênero por followers
    let nicheRank: number | null = null;
    let nicheTotal: number | null = null;
    if (pl.genre_id) {
      const { count: ahead } = await supabase
        .from("playlists")
        .select("id", { count: "exact", head: true })
        .eq("genre_id", pl.genre_id)
        .gt("followers", pl.followers ?? 0);
      const { count: total } = await supabase
        .from("playlists")
        .select("id", { count: "exact", head: true })
        .eq("genre_id", pl.genre_id);
      nicheRank = (ahead ?? 0) + 1;
      nicheTotal = total ?? null;
    }

    // 8.g) CAMADA EDITORIAL — cooldowns ativos + estado curatorial
    const { data: cdRows } = await supabase.rpc("get_active_cooldowns", { _playlist_id: pl.id });
    const activeCooldowns = ((cdRows ?? []) as any[]).map((c) => ({
      action_type: c.action_type,
      cooldown_until: c.cooldown_until,
      days_remaining: Number(c.days_remaining ?? 0),
      reason: c.reason ?? null,
    }));
    const hasCooldown = (a: string) => activeCooldowns.some((c) => c.action_type === a);
    const maxChangePctConfig: number = Number(pl.max_change_pct ?? 5);
    const saturatedRatio = counts.total > 0 ? saturatedCount / counts.total : 0;

    // 8.h) Decisão de modo — primeiro pergunta se vale a pena mexer
    let mode: "hold" | "light" | "moderate" | "structural" = "hold";
    const justifications: string[] = [];
    const tracksFullCooled = hasCooldown("structural") || hasCooldown("tracks_recycle");
    const tracksLightCooled = hasCooldown("tracks_light");
    const allCooled = tracksFullCooled && tracksLightCooled && hasCooldown("cover") && hasCooldown("description");

    if (allCooled) {
      mode = "hold";
      justifications.push("Todas as frentes estão em janela de observação. Aguardando maturação das últimas mudanças antes de qualquer nova intervenção.");
    } else if (removeRatio >= 0.25 || saturatedRatio >= 0.5) {
      mode = tracksFullCooled ? "light" : "structural";
      if (tracksFullCooled) {
        justifications.push(`Sinais críticos detectados (${Math.round(removeRatio * 100)}% das faixas pedem saída, ${Math.round(saturatedRatio * 100)}% saturadas), mas reciclagem está em cooldown. Recomendando apenas ajustes pontuais até a janela liberar.`);
      } else {
        justifications.push(`Sinais críticos: ${Math.round(removeRatio * 100)}% das faixas pedem saída e ${Math.round(saturatedRatio * 100)}% estão saturadas no nicho. Reciclagem estrutural justificada.`);
      }
    } else if (removeRatio >= 0.12 || saturatedRatio >= 0.3 || counts.promote >= 3) {
      mode = tracksFullCooled ? "light" : "moderate";
      justifications.push(`Sinais moderados: ${counts.remove} faixa(s) para remover, ${counts.promote} para promover. Intervenção controlada para preservar o algoritmo.`);
    } else if ((counts.remove + counts.promote + counts.demote) > 0) {
      mode = "light";
      justifications.push(`Apenas ${counts.remove + counts.promote + counts.demote} faixa(s) com sinal claro. Ajustes leves e pontuais, sem mexer na estrutura.`);
    } else {
      mode = "hold";
      justifications.push("Playlist madura e estável. Nenhuma alteração recomendada — manter como está e observar impacto.");
    }

    // 8.i) Aplica caps por modo + max_change_pct configurado
    const modeCapPct: Record<typeof mode, number> = { hold: 0, light: 5, moderate: 10, structural: 15 };
    const effectivePct = Math.min(maxChangePctConfig, modeCapPct[mode]);
    const maxChanges = Math.max(0, Math.floor(totalTracks * effectivePct / 100));

    let cappedSuggestions = tracksSuggestions;
    if (mode === "hold" || tracksFullCooled) {
      cappedSuggestions = [];
      if (tracksFullCooled && mode !== "hold") {
        const cd = activeCooldowns.find((c) => c.action_type === "tracks_recycle" || c.action_type === "structural");
        justifications.push(`Cooldown de reciclagem ativo (${Math.ceil(cd?.days_remaining ?? 0)}d restantes). Adições suprimidas.`);
      }
    } else if (maxChanges < tracksSuggestions.length) {
      cappedSuggestions = tracksSuggestions.slice(0, maxChanges);
      justifications.push(`Limitando a ${maxChanges} adições (${effectivePct}% das ${totalTracks} faixas) para preservar estabilidade do algoritmo.`);
    }

    const recommendedRemove = (tracksFullCooled || mode === "hold") ? 0 : Math.min(counts.remove, maxChanges);
    const recommendedPromote = (tracksLightCooled || mode === "hold") ? 0 : Math.min(counts.promote, maxChanges);
    const recommendedDemote = (tracksLightCooled || mode === "hold") ? 0 : Math.min(counts.demote, maxChanges);

    // Cooldowns de capa / descrição / nome (estrutural cobre nome)
    const coverSuggestion = hasCooldown("cover")
      ? {}
      : (model?.insights?.cover ?? model?.insights?.dna_visual ?? {});
    const finalNameSuggestion = hasCooldown("structural") ? null : nameSuggestion;
    const finalDescriptionSuggestion = hasCooldown("description") ? null : suggestedDescription;
    if (hasCooldown("cover")) justifications.push("Capa em cooldown — sugestão visual suspensa.");
    if (hasCooldown("description")) justifications.push("Descrição em cooldown — texto atual mantido.");

    const editorialJustification = justifications.join(" ");

    // 8.j) Atualiza estado curatorial da playlist
    const nextState =
      mode === "hold" && tracksFullCooled ? "cooldown" :
      mode === "hold" ? "saudavel" :
      mode === "light" ? "leve" :
      mode === "moderate" ? "moderada" :
      "estrutural";

    await supabase.from("managed_playlists")
      .update({
        curatorial_state: nextState,
        recommended_change_count: maxChanges,
      })
      .eq("id", pl.id);

    // 9) Persiste diagnóstico
    const { data: diag, error: dErr } = await supabase
      .from("playlist_diagnoses")
      .insert({
        playlist_id: pl.id,
        created_by: guard.via === "user" ? guard.userId : null,
        name_score: nameScore,
        name_current: pl.name,
        name_suggestion: finalNameSuggestion,
        name_reasons: nameReasons,
        tracks_suggestions: cappedSuggestions,
        tracks_analysis: tracksAnalysis,
        tracks_summary: tracksSummary,
        cover_suggestion: coverSuggestion,
        competitors,
        raw: {
          model_present: !!model,
          benchmark,
          top_keywords: topKeywords,
          present_keywords: present,
          sync_ok: syncRes?.ok ?? false,
          sync_error: syncRes?.ok ? null : (syncRes as any)?.body?.error ?? (syncRes as any)?.error ?? null,
          suggested_description: finalDescriptionSuggestion,
          description_current: pl.description ?? null,
          missing_keywords: missing,
          missing_in_description: missingInDesc,
          market_insights: marketInsights,
          health_status: healthStatus,
          niche_rank: nicheRank,
          niche_total: nicheTotal,
          // === Sprint 2 — camada editorial ===
          recommendation_mode: mode,
          editorial_justification: editorialJustification,
          curatorial_state: nextState,
          applied_caps: {
            max_change_pct: effectivePct,
            max_change_pct_config: maxChangePctConfig,
            max_changes: maxChanges,
            recommended_remove: recommendedRemove,
            recommended_promote: recommendedPromote,
            recommended_demote: recommendedDemote,
            capped_suggestions: cappedSuggestions.length,
            original_suggestions: tracksSuggestions.length,
          },
          active_cooldowns: activeCooldowns,
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
