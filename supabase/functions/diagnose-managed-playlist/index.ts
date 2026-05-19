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

// ---------- IA editorial (Lovable AI Gateway) ----------

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

type EditorialCopy = {
  titles: string[];
  descriptions: string[];
  reasoning: string;
};

async function generateEditorialCopy(ctx: {
  currentName: string;
  currentDescription: string | null;
  genreName: string | null;
  topKeywords: string[];
  missingKeywords: string[];
  topArtists: string[];
  topRecurringTracks: { title: string; artist: string }[];
  benchmarkSize: number | null;
  currentSize: number;
  competitors: { name: string }[];
}): Promise<EditorialCopy | null> {
  if (!LOVABLE_API_KEY) return null;

  const system = [
    `Você é um editor musical sênior do Spotify, especializado em curadoria do nicho "${ctx.genreName ?? "música brasileira"}".`,
    `Escreva como um curador humano de verdade: natural, contextual, com identidade própria.`,
    `Referências mentais: RapCaviar, Esquenta Sertanejo, Fluxo das Quebradas, Piseiro Bom Demais — playlists editoriais reais.`,
    ``,
    `REGRAS DURAS:`,
    `- Distribua keywords de forma NATURAL no título e descrição. NUNCA em MAIÚSCULAS artificiais.`,
    `- NUNCA use concatenação feia tipo "Playlist FESTA 2024 HITS".`,
    `- NUNCA use emoji.`,
    `- NUNCA use linguagem motivacional, publicitária ou genérica de IA ("Descubra o melhor de...", "Embarque numa jornada...", "As mais tocadas...", "Atualizada toda semana").`,
    `- NUNCA comece descrição com "As N mais" ou "Playlist com".`,
    `- Descrição deve ter no MÁXIMO 180 caracteres, idealmente 80-140.`,
    `- Título deve ter no MÁXIMO 40 caracteres.`,
    `- Sempre em português brasileiro.`,
    `- Soe como playlist editorial real do Spotify — personalidade, contexto musical, identidade de nicho.`,
    ``,
    `RETORNE APENAS JSON VÁLIDO neste formato exato:`,
    `{"titles":["t1","t2","t3"],"descriptions":["d1","d2"],"reasoning":"frase curta"}`,
  ].join("\n");

  const userPayload = {
    nome_atual: ctx.currentName,
    descricao_atual: ctx.currentDescription,
    nicho: ctx.genreName,
    palavras_chave_prioritarias: ctx.topKeywords.slice(0, 10),
    palavras_chave_faltando: ctx.missingKeywords.slice(0, 6),
    artistas_dominantes_nicho: ctx.topArtists.slice(0, 8),
    faixas_mais_recorrentes_nicho: ctx.topRecurringTracks.slice(0, 6),
    tamanho_atual_faixas: ctx.currentSize,
    tamanho_ideal_nicho: ctx.benchmarkSize,
    playlists_lideres_nicho: ctx.competitors.slice(0, 5).map((c) => c.name),
    instrucao: "Gere 3 títulos editoriais alternativos e 2 descrições editoriais, mais o reasoning curto explicando como cobre keywords + aproxima do padrão do nicho.",
  };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12_000);

  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
    });

    if (!r.ok) {
      throw new Error(`gateway_${r.status}`);
    }
    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content;
    if (!raw) throw new Error("empty_content");
    const parsed = JSON.parse(raw);
    const titles = Array.isArray(parsed.titles) ? parsed.titles.filter((x: unknown) => typeof x === "string" && x.trim().length > 0) : [];
    const descriptions = Array.isArray(parsed.descriptions) ? parsed.descriptions.filter((x: unknown) => typeof x === "string" && x.trim().length > 0) : [];
    if (titles.length === 0 && descriptions.length === 0) throw new Error("no_outputs");
    return {
      titles: titles.slice(0, 3),
      descriptions: descriptions.slice(0, 2),
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch (e) {
    console.warn("[diagnose] editorial AI falhou:", (e as Error).message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

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

    // 4) Classificação por faixa — ZONAS EDITORIAIS
    //
    // A playlist é tratada como uma vitrine com 4 zonas, cada uma com função própria:
    //   - anchor    (pos 1-2)  : fachada. Só hits dominantes.
    //   - premium   (pos 3-6)  : zona principal de impulsionamento (campanhas e crescimento).
    //   - support   (pos 7-12) : sustentação, retenção, equilíbrio.
    //   - tail      (pos 13+)  : profundidade, descoberta, rotatividade leve.
    //
    // Cada faixa recebe scores por zona; o "melhor zone fit" determina onde ela DEVIA estar.
    // Status passa a ser "essa música faz sentido AQUI?", não "essa música é forte/fraca?".
    type Zone = "anchor" | "premium" | "support" | "tail";
    const ZONE_RANGES: Record<Zone, [number, number]> = {
      anchor:  [0, 1],   // posições 1-2
      premium: [2, 5],   // posições 3-6
      support: [6, 11],  // posições 7-12
      tail:    [12, 9999],
    };
    const ZONE_ORDER: Zone[] = ["anchor", "premium", "support", "tail"];
    const ZONE_LABELS: Record<Zone, string> = {
      anchor: "Fachada",
      premium: "Premium",
      support: "Sustentação",
      tail: "Cauda",
    };
    const totalTracks = (currentTracks ?? []).length;
    const NOW = Date.now();

    function zoneFromPos(pos: number): Zone {
      if (pos <= ZONE_RANGES.anchor[1]) return "anchor";
      if (pos <= ZONE_RANGES.premium[1]) return "premium";
      if (pos <= ZONE_RANGES.support[1]) return "support";
      return "tail";
    }
    function zoneMiddle(zone: Zone): number {
      const [a, b] = ZONE_RANGES[zone];
      const end = zone === "tail" ? Math.max(a, totalTracks - 1) : b;
      return Math.floor((a + end) / 2);
    }

    type TrackScores = {
      anchor: number; premium: number; support: number; tail: number;
      anchorEligible: boolean;
    };

    // Top-3 artistas dominantes do nicho — recebem boost de elegibilidade pra fachada.
    // Regra: se o artista domina o nicho (top 3 por recorrência), ele entra na fachada
    // mesmo com popularity 55-69, porque a leitura editorial vem do nicho, não do número absoluto.
    const dominantArtists = new Set(
      genreArtistsTop.slice(0, 3).map((a) => a.artist.toLowerCase()),
    );

    // Pré-calcula sinais e scores de zona
    const rawTracks = (currentTracks ?? []).map((t: any) => {
      const meta = spotMeta.get(t.spotify_track_id);
      const rec = genreRecurrence.get(t.spotify_track_id);
      const recurrence = rec?.count ?? 0;
      const popularity = meta?.popularity ?? null;
      const releaseDate = meta?.release_date ?? null;
      const artist = meta?.artist_id ? artistMeta.get(meta.artist_id) : undefined;
      const artistPop = artist?.popularity ?? null;
      const artistFollowers = artist?.followers ?? null;
      const pos: number = t.position ?? 0;
      const saturationPct = nichePlaylistCount > 0
        ? Math.min(100, Math.round((recurrence / nichePlaylistCount) * 100))
        : 0;
      const addedAt = t.added_at ? new Date(t.added_at).getTime() : null;
      const ageDays = addedAt ? Math.floor((NOW - addedAt) / 86400000) : null;
      const releaseAgeYears = releaseDate
        ? Math.max(0, (NOW - new Date(releaseDate).getTime()) / (365 * 86400000))
        : null;

      // Normalizações 0-100
      const pop = popularity ?? 0;
      const aPop = artistPop ?? 0;
      const recNorm = Math.min(100, recurrence * 12); // 8× no nicho ≈ 96
      const freshness = releaseAgeYears == null ? 40
        : releaseAgeYears < 0.25 ? 100
        : releaseAgeYears < 1 ? 75
        : releaseAgeYears < 3 ? 50
        : 20;
      const stability = ageDays == null ? 50
        : ageDays > 90 ? 90
        : ageDays > 30 ? 70
        : 40;

      // Artista dominante no nicho (top 3 por recorrência)?
      const artistNameLower = String(t.artist_name ?? "").split(",")[0].trim().toLowerCase();
      const isDominantArtist = artistNameLower.length > 0 && dominantArtists.has(artistNameLower);
      const dominantBoost = isDominantArtist ? 20 : 0;

      // Score por zona — pesos refletem a função.
      // Artistas dominantes do nicho ganham +20 no anchorScore (leitura editorial > pop absoluto).
      const anchorScore  = Math.round(pop * 0.5  + aPop * 0.3  + recNorm * 0.2) + dominantBoost;
      const premiumScore = Math.round(pop * 0.4  + recNorm * 0.35 + freshness * 0.25);
      const supportScore = Math.round(recNorm * 0.5 + pop * 0.3 + stability * 0.2);
      const tailScore    = Math.round(freshness * 0.5 + Math.max(0, 60 - pop) * 0.3 + recNorm * 0.2);

      // Floor da fachada:
      //  - regra padrão: pop ≥ 70 E (artista forte OU muito recorrente), OU
      //  - regra dominante: artista top-3 do nicho com pop ≥ 55 (cultura do nicho > pop absoluto)
      const anchorEligible =
        (popularity != null && popularity >= 70 && (aPop >= 70 || recurrence >= 5)) ||
        (isDominantArtist && popularity != null && popularity >= 55);

      return {
        t, recurrence, popularity, releaseDate, artistPop, artistFollowers,
        pos, saturationPct, ageDays, releaseAgeYears, isDominantArtist,
        scores: { anchor: anchorScore, premium: premiumScore, support: supportScore, tail: tailScore, anchorEligible } as TrackScores,
      };
    });

    // Até 2 candidatas reais à fachada: top anchorScore que passam no floor.
    // Artistas dominantes do nicho vão na frente (mesmo critério, mas o boost +20 já os empurra).
    const anchorSet = new Set(
      rawTracks
        .filter(x => x.scores.anchorEligible && !protectedTracks.has(x.t.spotify_track_id))
        .sort((a, b) => {
          // Dominante > não-dominante; depois por anchorScore
          if (a.isDominantArtist !== b.isDominantArtist) return a.isDominantArtist ? -1 : 1;
          return b.scores.anchor - a.scores.anchor;
        })
        .slice(0, 2)
        .map(x => x.t.spotify_track_id),
    );

    function pickBestZone(x: typeof rawTracks[number]): Zone {
      const s = x.scores;
      const candidates: { z: Zone; v: number }[] = [
        { z: "premium", v: s.premium },
        { z: "support", v: s.support },
        { z: "tail",    v: s.tail },
      ];
      if (anchorSet.has(x.t.spotify_track_id)) {
        candidates.push({ z: "anchor", v: s.anchor + 5 }); // pequeno bias
      }
      candidates.sort((a, b) => b.v - a.v);
      return candidates[0].z;
    }

    const tracksAnalysis = rawTracks.map((x) => {
      const { t, recurrence, popularity, releaseDate, artistPop, artistFollowers, pos, saturationPct, ageDays, scores } = x;
      const currentZone = zoneFromPos(pos);
      const bestZone = pickBestZone(x);
      const bestZoneScore = scores[bestZone];

      let status: "keep" | "remove" | "promote" | "demote" | "protected" = "keep";
      const reasons: string[] = [];
      let targetPosition: number | null = null;
      const protectedInfo = protectedTracks.get(t.spotify_track_id);

      // 0) PROTEGIDA — campanha ativa. Não pode ser tocada automaticamente.
      if (protectedInfo) {
        status = "protected";
        const statusLabel = protectedInfo.campaign_status === "active" ? "ativa"
          : protectedInfo.campaign_status === "draft" ? "em rascunho"
          : "pausada";
        reasons.push(`campanha ${statusLabel} entregando meta nesta faixa`);
        if (protectedInfo.planned_streams > 0) {
          reasons.push(`${protectedInfo.planned_streams.toLocaleString("pt-BR")} streams planejados nesta playlist`);
        }
        reasons.push("zona reservada · só ajustes suaves dentro do bloco da campanha");
      }
      // 1) REMOVER saturada — enterrada e sem função em zona nenhuma
      else if (saturationPct >= 70 && pos >= 20 && bestZoneScore < 45) {
        status = "remove";
        reasons.push(`saturada no nicho (${saturationPct}%) e enterrada em #${pos + 1}`);
        reasons.push("não cumpre função em nenhuma zona");
      }
      // 2) REMOVER frio — sem força em zona nenhuma + sem recorrência + tempo de teste
      else if (popularity != null && popularity < 30 && recurrence === 0 && (ageDays == null || ageDays > 30) && bestZoneScore < 25) {
        status = "remove";
        reasons.push(`popularity ${popularity} e zero presença no nicho`);
        if (ageDays != null) reasons.push(`${ageDays}d sem cumprir função editorial`);
      }
      // 3) MOVER PRA ZONA CERTA — análise por função, não por número absoluto
      else if (bestZone !== currentZone) {
        const goingUp = ZONE_ORDER.indexOf(bestZone) < ZONE_ORDER.indexOf(currentZone);
        status = goingUp ? "promote" : "demote";
        targetPosition = zoneMiddle(bestZone);

        // Regra dura da fachada (pos 1-2):
        //   • só rebaixa se a faixa for realmente lixo (pop < 40 E recorrência 0)
        //   • caso contrário, fachada se mantém — só campanha GRANDE consegue reposicionar
        //     (campanhas grandes já chegam aqui via protectedInfo, então não é decidido aqui)
        if (currentZone === "anchor" && !scores.anchorEligible) {
          const isTrash = (popularity != null && popularity < 40) && recurrence === 0;
          if (isTrash) {
            status = "demote";
            targetPosition = zoneMiddle("premium");
            reasons.push(`na fachada (#${pos + 1}) sem força mínima — pop ${popularity ?? "—"} e zero recorrência no nicho`);
            reasons.push("fachada exige hit dominante ou artista top do nicho");
          } else {
            // mantém na fachada: faixa não é ideal mas não é trash; só campanha grande move
            status = "keep";
            targetPosition = null;
            reasons.push(`fachada preservada · pop ${popularity ?? "—"}${artistPop != null ? ` · artista ${artistPop}` : ""}`);
            reasons.push("posição 1-2 só muda por campanha grande ou faixa sem força mínima");
          }
        } else if (goingUp) {
          reasons.push(`função melhor em ${ZONE_LABELS[bestZone]} (score ${bestZoneScore})`);
          reasons.push(`hoje em ${ZONE_LABELS[currentZone]} (#${pos + 1}) — subir pra zona ${ZONE_LABELS[bestZone]}`);
        } else {
          reasons.push(`hoje em ${ZONE_LABELS[currentZone]} (#${pos + 1}) — não cumpre função desta zona`);
          reasons.push(`mover pra ${ZONE_LABELS[bestZone]} (score ${bestZoneScore})`);
        }
      }
      // 4) KEEP — faixa cumpre função da zona em que está
      else {
        if (currentZone === "anchor") {
          reasons.push(`âncora forte · popularity ${popularity ?? "—"}${artistPop != null ? ` · artista ${artistPop}` : ""}`);
        } else if (currentZone === "premium") {
          reasons.push(`encaixa em Premium (score ${scores.premium})`);
        } else if (currentZone === "support") {
          reasons.push(`sustenta o fluxo · ${recurrence}× no nicho`);
        } else {
          reasons.push(`profundidade da playlist · cauda saudável`);
        }
      }

      return {
        spotify_track_id: t.spotify_track_id,
        track_name: t.track_name,
        artist_name: t.artist_name,
        position: pos,
        status,
        reasons,
        // zona editorial
        current_zone: currentZone,
        best_zone: bestZone,
        zone_scores: scores,
        anchor_eligible: scores.anchorEligible,
        target_position: targetPosition,
        // sinais
        recurrence_in_genre: recurrence,
        saturation_pct: saturationPct,
        popularity,
        artist_popularity: artistPop,
        artist_followers: artistFollowers,
        release_date: releaseDate,
        age_days_in_playlist: ageDays,
        // proteção
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

    // Distribuição editorial por zona (atual vs. ideal)
    const zoneCurrent = { anchor: 0, premium: 0, support: 0, tail: 0 } as Record<Zone, number>;
    const zoneBest    = { anchor: 0, premium: 0, support: 0, tail: 0 } as Record<Zone, number>;
    for (const tr of tracksAnalysis) {
      zoneCurrent[tr.current_zone as Zone]++;
      zoneBest[tr.best_zone as Zone]++;
    }
    const anchorHasEligible = tracksAnalysis.some(
      (tr) => tr.current_zone === "anchor" && tr.anchor_eligible,
    );
    const anchorMisuse = tracksAnalysis.filter(
      (tr) => tr.current_zone === "anchor" && !tr.anchor_eligible && tr.status !== "protected",
    ).length;

    const tracksSummary = {
      ...counts,
      saturated: saturatedCount,
      saturated_pct: totalTracks ? Math.round((saturatedCount / totalTracks) * 100) : 0,
      no_data: noDataCount,
      missing_artists: missingArtists,
      niche_playlist_count: nichePlaylistCount,
      zone_current: zoneCurrent,
      zone_best: zoneBest,
      anchor_has_eligible: anchorHasEligible,
      anchor_misuse: anchorMisuse,
    };

    // 7) Sugestões de faixas a ADICIONAR — CAMADA 3: por FUNÇÃO EDITORIAL, não popularidade pura.
    //    A lógica passa de "o que tá quente no nicho" para "o que cumpre a função de cada zona".
    //    Cada sugestão carrega:
    //      - target_zone: em qual zona ela deveria entrar
    //      - function_role: qual papel ela cumpre (fachada, impulsionamento, sustentação, descoberta)
    //      - replaces_track_id/name: se é substituição direta de uma faixa que está saindo
    //      - suggested_position: posição calculada pela zona-alvo
    const currentIds = new Set(trackIds);
    const missingArtistSet = new Set(missingArtists.map((a) => a.artist.toLowerCase()));
    // Pool de sugestões — escala quando a playlist está subdimensionada vs benchmark do nicho
    const benchP50Pool = Number(benchmark?.tracks_p50 ?? 0);
    const undersizeGapPool = benchP50Pool > 0 ? Math.max(0, benchP50Pool - totalTracks) : 0;
    const N_SUGGEST = Math.max(15, Math.min(undersizeGapPool + 5, 40));

    // 7.a) Top candidatas brutas (por recorrência) — limitamos antes de gastar API Spotify
    const rawCandidates = Array.from(genreRecurrence.entries())
      .filter(([id]) => !currentIds.has(id))
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 80);

    // 7.b) Busca meta Spotify dos candidatos (popularity + artista) pra calcular zone scores
    const candMeta = new Map<string, { popularity: number | null; artistPop: number | null; cover: string | null }>();
    const coverMap = new Map<string, string>();
    if (rawCandidates.length > 0) {
      try {
        const token = await getSpotifyToken();
        const candArtistIds = new Map<string, string>(); // trackId → artistId
        for (let i = 0; i < rawCandidates.length; i += 50) {
          const ids = rawCandidates.slice(i, i + 50).map((c) => c.id);
          const r = await fetch(`https://api.spotify.com/v1/tracks?ids=${ids.join(",")}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!r.ok) continue;
          const j = await r.json();
          for (const tr of j.tracks ?? []) {
            if (!tr?.id) continue;
            const imgs = tr.album?.images ?? [];
            const cover = imgs[0]?.url ?? imgs[imgs.length - 1]?.url ?? null;
            if (cover) coverMap.set(tr.id, cover);
            candMeta.set(tr.id, {
              popularity: typeof tr.popularity === "number" ? tr.popularity : null,
              artistPop: null,
              cover,
            });
            if (tr.artists?.[0]?.id) candArtistIds.set(tr.id, tr.artists[0].id);
          }
        }
        const uniqueArtistIds = uniq(Array.from(candArtistIds.values()));
        const artistPopMap = new Map<string, number | null>();
        for (let i = 0; i < uniqueArtistIds.length; i += 50) {
          const ids = uniqueArtistIds.slice(i, i + 50);
          const r = await fetch(`https://api.spotify.com/v1/artists?ids=${ids.join(",")}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!r.ok) continue;
          const j = await r.json();
          for (const ar of j.artists ?? []) {
            if (!ar?.id) continue;
            artistPopMap.set(ar.id, typeof ar.popularity === "number" ? ar.popularity : null);
          }
        }
        for (const [tid, aid] of candArtistIds.entries()) {
          const cur = candMeta.get(tid);
          if (cur) cur.artistPop = artistPopMap.get(aid) ?? null;
        }
      } catch (_e) { /* degrade gracefully */ }
    }

    // 7.c) Calcula scores por zona pra cada candidato (mesma fórmula da camada 2)
    type Candidate = {
      spotify_track_id: string;
      nome: string;
      artista: string;
      count: number;
      from_missing_artist: boolean;
      popularity: number | null;
      artist_popularity: number | null;
      cover_url: string | null;
      zone_scores: { anchor: number; premium: number; support: number; tail: number };
      anchor_eligible: boolean;
      target_zone: Zone;
      function_role: string;
      score: number;
    };
    const ROLE_LABEL: Record<Zone, string> = {
      anchor: "fachada · hit dominante",
      premium: "impulsionamento · zona principal",
      support: "sustentação · retenção",
      tail: "descoberta · catálogo",
    };
    const candidates: Candidate[] = rawCandidates.map((c) => {
      const m = candMeta.get(c.id);
      const popularity = m?.popularity ?? null;
      const artistPop = m?.artistPop ?? null;
      const pop = popularity ?? 0;
      const aPop = artistPop ?? 0;
      const recNorm = Math.min(100, c.count * 12);
      // Sem release_date para candidatos — assumimos freshness neutra
      const freshness = 50;
      const stability = 50;
      const mainArtist = String(c.artist_name ?? "").split(",")[0].trim().toLowerCase();
      const isDominantArtist = mainArtist.length > 0 && dominantArtists.has(mainArtist);
      const dominantBoost = isDominantArtist ? 20 : 0;
      const anchorScore  = Math.round(pop * 0.5  + aPop * 0.3  + recNorm * 0.2) + dominantBoost;
      const premiumScore = Math.round(pop * 0.4  + recNorm * 0.35 + freshness * 0.25);
      const supportScore = Math.round(recNorm * 0.5 + pop * 0.3 + stability * 0.2);
      const tailScore    = Math.round(freshness * 0.5 + Math.max(0, 60 - pop) * 0.3 + recNorm * 0.2);
      // Mesmo critério do tracksAnalysis: dominante do nicho passa com pop ≥ 55
      const anchorEligible =
        (popularity != null && popularity >= 70 && (aPop >= 70 || c.count >= 5)) ||
        (isDominantArtist && popularity != null && popularity >= 55);

      const zonePool: { z: Zone; v: number }[] = [
        { z: "premium", v: premiumScore },
        { z: "support", v: supportScore },
        { z: "tail",    v: tailScore },
      ];
      if (anchorEligible) zonePool.push({ z: "anchor", v: anchorScore + 5 });
      zonePool.sort((a, b) => b.v - a.v);
      const targetZone = zonePool[0].z;

      const fromMissing = !!(mainArtist && missingArtistSet.has(mainArtist));
      // Score global combinando função + recorrência + boost de artista faltando + boost dominante
      const composite = Math.round(zonePool[0].v * 0.7 + recNorm * 0.3)
        + (fromMissing ? 8 : 0)
        + (isDominantArtist ? 10 : 0);

      return {
        spotify_track_id: c.id,
        nome: c.track_name ?? "—",
        artista: c.artist_name ?? "—",
        count: c.count,
        from_missing_artist: fromMissing,
        popularity,
        artist_popularity: artistPop,
        cover_url: m?.cover ?? null,
        zone_scores: { anchor: anchorScore, premium: premiumScore, support: supportScore, tail: tailScore },
        anchor_eligible: anchorEligible,
        target_zone: targetZone,
        function_role: ROLE_LABEL[targetZone],
        score: composite,
      };
    });

    // 7.d) Pareia substituições — cada faixa que SAI (remove/demote) ganha a melhor candidata
    //      que cumpre a MESMA função na zona-alvo da saída.
    const exitSlots = tracksAnalysis
      .filter((t) => t.status === "remove" || t.status === "demote")
      .map((t) => ({
        track_id: t.spotify_track_id,
        track_name: t.track_name,
        artist_name: t.artist_name,
        position: t.position,
        // Para remove: vaga na zona atual. Para demote: a vaga liberada também é na zona atual.
        slot_zone: t.current_zone as Zone,
      }));

    const usedCandidateIds = new Set<string>();
    const substitutions = exitSlots.map((slot) => {
      // Candidatas que se encaixam na MESMA zona que ficou vaga, ordenadas pelo score daquela zona
      const fit = candidates
        .filter((c) => !usedCandidateIds.has(c.spotify_track_id) && c.target_zone === slot.slot_zone)
        .sort((a, b) => b.zone_scores[slot.slot_zone] - a.zone_scores[slot.slot_zone]);
      const pick = fit[0] ?? null;
      if (pick) usedCandidateIds.add(pick.spotify_track_id);
      return {
        replaces_track_id: slot.track_id,
        replaces_track_name: slot.track_name,
        replaces_artist_name: slot.artist_name,
        replaces_position: slot.position,
        slot_zone: slot.slot_zone,
        slot_zone_label: ZONE_LABELS[slot.slot_zone],
        candidate: pick ? {
          spotify_track_id: pick.spotify_track_id,
          nome: pick.nome,
          artista: pick.artista,
          cover_url: pick.cover_url,
          popularity: pick.popularity,
          recurrence_in_genre: pick.count,
          zone_fit_score: pick.zone_scores[slot.slot_zone],
          function_role: pick.function_role,
          from_missing_artist: pick.from_missing_artist,
          suggested_position: slot.position, // assume a vaga liberada
        } : null,
      };
    });

    // 7.e) Sugestões restantes — distribui pelo DEFICIT de cada zona
    //      ideal: anchor=2, premium=4, support=6, tail = max(0, total-12)
    const zoneIdeal: Record<Zone, number> = {
      anchor: 2,
      premium: 4,
      support: 6,
      tail: Math.max(0, totalTracks - 12),
    };
    const deficits: Record<Zone, number> = {
      anchor: Math.max(0, zoneIdeal.anchor - (zoneCurrent.anchor ?? 0)),
      premium: Math.max(0, zoneIdeal.premium - (zoneCurrent.premium ?? 0)),
      support: Math.max(0, zoneIdeal.support - (zoneCurrent.support ?? 0)),
      tail: Math.max(0, zoneIdeal.tail - (zoneCurrent.tail ?? 0)),
    };

    const remainingCandidates = candidates
      .filter((c) => !usedCandidateIds.has(c.spotify_track_id))
      .sort((a, b) => b.score - a.score);

    const extraSuggestions: any[] = [];
    const remainingByZone: Record<Zone, Candidate[]> = { anchor: [], premium: [], support: [], tail: [] };
    for (const c of remainingCandidates) remainingByZone[c.target_zone].push(c);

    for (const zone of ZONE_ORDER) {
      const need = deficits[zone];
      if (!need) continue;
      const picks = remainingByZone[zone].slice(0, need);
      for (const p of picks) {
        usedCandidateIds.add(p.spotify_track_id);
        extraSuggestions.push({
          spotify_track_id: p.spotify_track_id,
          nome: p.nome,
          artista: p.artista,
          cover_url: p.cover_url,
          count: p.count,
          popularity: p.popularity,
          from_missing_artist: p.from_missing_artist,
          target_zone: zone,
          target_zone_label: ZONE_LABELS[zone],
          function_role: p.function_role,
          zone_fit_score: p.zone_scores[zone],
          suggested_position: zoneMiddle(zone),
          fills_deficit: true,
          score: p.score,
        });
      }
    }

    // 7.f) Completa até N_SUGGEST com top score livre, mantendo função
    if (extraSuggestions.length + substitutions.filter((s) => s.candidate).length < N_SUGGEST) {
      const stillNeed = N_SUGGEST - extraSuggestions.length - substitutions.filter((s) => s.candidate).length;
      const fillers = candidates
        .filter((c) => !usedCandidateIds.has(c.spotify_track_id))
        .sort((a, b) => b.score - a.score)
        .slice(0, stillNeed);
      for (const p of fillers) {
        usedCandidateIds.add(p.spotify_track_id);
        extraSuggestions.push({
          spotify_track_id: p.spotify_track_id,
          nome: p.nome,
          artista: p.artista,
          cover_url: p.cover_url,
          count: p.count,
          popularity: p.popularity,
          from_missing_artist: p.from_missing_artist,
          target_zone: p.target_zone,
          target_zone_label: ZONE_LABELS[p.target_zone],
          function_role: p.function_role,
          zone_fit_score: p.zone_scores[p.target_zone],
          suggested_position: zoneMiddle(p.target_zone),
          fills_deficit: false,
          score: p.score,
        });
      }
    }

    // Lista final consolidada (substituições + adições por deficit/score)
    const tracksSuggestions = [
      ...substitutions
        .filter((s) => s.candidate)
        .map((s) => ({
          spotify_track_id: s.candidate!.spotify_track_id,
          nome: s.candidate!.nome,
          artista: s.candidate!.artista,
          cover_url: s.candidate!.cover_url,
          count: s.candidate!.recurrence_in_genre,
          popularity: s.candidate!.popularity,
          from_missing_artist: s.candidate!.from_missing_artist,
          target_zone: s.slot_zone,
          target_zone_label: s.slot_zone_label,
          function_role: s.candidate!.function_role,
          zone_fit_score: s.candidate!.zone_fit_score,
          suggested_position: s.candidate!.suggested_position,
          replaces_track_id: s.replaces_track_id,
          replaces_track_name: s.replaces_track_name,
          replaces_artist_name: s.replaces_artist_name,
          fills_deficit: false,
          is_substitution: true,
          score: s.candidate!.zone_fit_score,
        })),
      ...extraSuggestions,
    ];

    // Adiciona contagem ao summary pra UI exibir KPI "ADICIONAR"
    (tracksSummary as any).add = tracksSuggestions.length;
    (tracksSummary as any).add_from_missing = tracksSuggestions.filter((t: any) => t.from_missing_artist).length;
    (tracksSummary as any).substitutions = substitutions.filter((s) => s.candidate).length;
    (tracksSummary as any).zone_deficits = deficits;
    (tracksSummary as any).zone_ideal = zoneIdeal;


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

    // 8.b.AI) Refino editorial via Lovable AI — gera título e descrição naturais.
    // Algoritmo acima vira baseline/fallback automático.
    const algoName = nameSuggestion;
    const algoDescription = suggestedDescription;
    let aiCopy: EditorialCopy | null = null;
    let aiError: string | null = null;
    try {
      aiCopy = await generateEditorialCopy({
        currentName: pl.name,
        currentDescription: pl.description ?? null,
        genreName: (model?.insights?.nicho_nome ?? model?.insights?.nicho ?? null) as string | null,
        topKeywords,
        missingKeywords: missing,
        topArtists: genreArtistsTop.slice(0, 8).map((a) => a.artist),
        topRecurringTracks: Array.from(genreRecurrence.entries())
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 6)
          .map(([, v]) => ({ title: v.track_name ?? "", artist: v.artist_name ?? "" })),
        benchmarkSize: benchmark?.tracks_p50 ?? null,
        currentSize: totalTracks,
        competitors: competitors.slice(0, 6).map((c) => ({ name: c.name })),
      });
    } catch (e) {
      aiError = (e as Error).message;
    }
    const editorialName = aiCopy?.titles?.[0] ?? algoName;
    const editorialDescription = aiCopy?.descriptions?.[0] ?? algoDescription;


    // 8.c) target_position — agora vem direto da zona-alvo (calculada no passo 4),
    //      então não há mais override por popularity rank.

    // 8.d) market_insights — usa benchmark + genreRecurrence + genreArtistsTop
    const topRecurringRaw = Array.from(genreRecurrence.entries())
      .map(([id, v]) => ({
        spotify_track_id: id,
        title: v.track_name,
        artist: v.artist_name,
        niche_playlists_count: v.count,
      }))
      .sort((a, b) => b.niche_playlists_count - a.niche_playlists_count)
      .slice(0, 8);

    // Enriquece com capas — usa coverMap (já preenchido pelos candidatos);
    // pra IDs faltantes, faz UMA call extra ao /v1/tracks.
    const missingCoverIds = topRecurringRaw
      .map((t) => t.spotify_track_id)
      .filter((id) => id && !coverMap.has(id)) as string[];
    if (missingCoverIds.length > 0) {
      try {
        const token = await getSpotifyToken();
        for (let i = 0; i < missingCoverIds.length; i += 50) {
          const ids = missingCoverIds.slice(i, i + 50);
          const r = await fetch(`https://api.spotify.com/v1/tracks?ids=${ids.join(",")}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!r.ok) continue;
          const j = await r.json();
          for (const tr of j.tracks ?? []) {
            if (!tr?.id) continue;
            const imgs = tr.album?.images ?? [];
            const cover = imgs[0]?.url ?? imgs[imgs.length - 1]?.url ?? null;
            if (cover) coverMap.set(tr.id, cover);
          }
        }
      } catch { /* segue sem capas extras */ }
    }
    const topRecurringTracks = topRecurringRaw.map((t) => ({
      ...t,
      cover_url: t.spotify_track_id ? coverMap.get(t.spotify_track_id) ?? null : null,
    }));

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

    // === Undersize override ===
    // Se a playlist está abaixo do tamanho de mercado (benchmark.tracks_p50),
    // o cap de % deixa de fazer sentido pra ADIÇÕES PURAS — uma playlist com
    // 51 faixas num nicho que pede 112+ precisa CRESCER. Substituições continuam
    // capadas (mexem em faixa existente = risco algorítmico).
    // Cap absoluto por ciclo: 30 adições — mantém ritmo seguro de crescimento.
    const benchP50 = Number(benchmark?.tracks_p50 ?? 0);
    const undersizeGap = benchP50 > 0 ? Math.max(0, benchP50 - totalTracks) : 0;
    const ADD_CAP_PER_CYCLE = 30;
    const additionsCap = mode === "hold"
      ? 0
      : Math.max(maxChanges, Math.min(undersizeGap, ADD_CAP_PER_CYCLE));

    let cappedSuggestions = tracksSuggestions;
    if (mode === "hold" || tracksFullCooled) {
      cappedSuggestions = [];
      if (tracksFullCooled && mode !== "hold") {
        const cd = activeCooldowns.find((c) => c.action_type === "tracks_recycle" || c.action_type === "structural");
        justifications.push(`Cooldown de reciclagem ativo (${Math.ceil(cd?.days_remaining ?? 0)}d restantes). Adições suprimidas.`);
      }
    } else {
      // Separa substituições (risco) de adições puras (crescimento)
      const subs = tracksSuggestions.filter((t: any) => t.is_substitution);
      const adds = tracksSuggestions.filter((t: any) => !t.is_substitution);
      const cappedSubs = subs.slice(0, maxChanges);
      const cappedAdds = adds.slice(0, additionsCap);
      cappedSuggestions = [...cappedSubs, ...cappedAdds];

      if (undersizeGap > 0 && additionsCap > maxChanges) {
        justifications.push(
          `Playlist subdimensionada: ${totalTracks} faixa(s) vs ${benchP50} ideais no nicho (gap de ${undersizeGap}). ` +
          `Cap de % suspenso para adições — liberadas ${cappedAdds.length} faixa(s) novas neste ciclo` +
          (cappedSubs.length > 0 ? ` + ${cappedSubs.length} substituição(ões)` : "") + ".",
        );
      } else if (maxChanges < tracksSuggestions.length) {
        justifications.push(`Limitando a ${maxChanges} adições (${effectivePct}% das ${totalTracks} faixas) para preservar estabilidade do algoritmo.`);
      }
    }

    const recommendedRemove = (tracksFullCooled || mode === "hold") ? 0 : Math.min(counts.remove, maxChanges);
    const recommendedPromote = (tracksLightCooled || mode === "hold") ? 0 : Math.min(counts.promote, maxChanges);
    const recommendedDemote = (tracksLightCooled || mode === "hold") ? 0 : Math.min(counts.demote, maxChanges);

    // Cooldowns de capa / descrição / nome (estrutural cobre nome)
    const coverSuggestion = hasCooldown("cover")
      ? {}
      : (model?.insights?.cover ?? model?.insights?.dna_visual ?? {});
    const finalNameSuggestion = hasCooldown("structural") ? null : editorialName;
    const finalDescriptionSuggestion = hasCooldown("description") ? null : editorialDescription;
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
          // === Camada 3 — substituições por função editorial ===
          substitutions: substitutions,
          zone_deficits: deficits,
          zone_ideal: zoneIdeal,
          // === Camada IA editorial ===
          ai_used: !!aiCopy,
          ai_error: aiError,
          ai_titles: aiCopy?.titles ?? null,
          ai_descriptions: aiCopy?.descriptions ?? null,
          ai_reasoning: aiCopy?.reasoning ?? null,
          algo_name_baseline: algoName,
          algo_description_baseline: algoDescription,
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
