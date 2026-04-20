// generate-playlists-briefing — motor de decisão honesto
// Filtros de qualidade + score transparente + confidence + IA refina nomes
// Retorna entre 0 e 10 playlists (NUNCA força fillers)
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

// ═══════════════ CONFIG ═══════════════
const MIN_FREQ_PCT = 3;        // padrão precisa aparecer em ≥3% do corpus
const MIN_REPETITIONS = 2;     // padrão precisa repetir ≥2 vezes
const MIN_KEYWORDS = 2;        // card precisa de ≥2 keywords válidas
const KW_MIN_PCT = 1.5;        // keyword precisa de ≥1.5% do peso total
const MAX_RESULTS = 10;
const KW_PER_CARD = 3;
const TRACKS_PER_CARD = 5;

function j(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Capitaliza para nomes mais legíveis
function titleCase(s: string): string {
  return s.split(" ").map(w => w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const start = Date.now();

  let body: { genre_id: string };
  try { body = await req.json(); } catch { return j({ error: "Invalid JSON" }, 400); }
  if (!body.genre_id) return j({ error: "genre_id obrigatório" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // ═══════════════ CARREGAR DADOS ═══════════════
    const [{ data: genre }, { data: model }, { data: history }, { count: corpusCount }] = await Promise.all([
      supabase.from("genres").select("id,nome,slug").eq("id", body.genre_id).single(),
      supabase.from("genre_models").select("*").eq("genre_id", body.genre_id).maybeSingle(),
      supabase.from("genre_models_history")
        .select("version,palavras_chave")
        .eq("genre_id", body.genre_id)
        .order("version", { ascending: false })
        .limit(2),
      supabase.from("search_results")
        .select("id", { count: "exact", head: true })
        .eq("genre_id", body.genre_id),
    ]);

    if (!genre) return j({ error: "Gênero não encontrado" }, 404);
    if (!model) return j({ error: "Sem modelo. Execute analyze-genre primeiro." }, 400);

    const palavrasChave = (model.palavras_chave as any[] ?? []);
    const padroesNome = (model.padroes_nome as any[] ?? []);
    const playlistsDom = (model.playlists_dominantes as any[] ?? []);
    const musicasRec = (model.musicas_recorrentes as any[] ?? []);

    // ═══════════════ ENRIQUECER PLAYLISTS DOMINANTES COM METADADOS REAIS ═══════════════
    // Busca seguidores, url, imagem do search_results pra cada playlist dominante
    const domNames = playlistsDom.map((p: any) => p.nome).filter(Boolean);
    const playlistsMetaMap = new Map<string, { seguidores: number; spotify_url: string | null; imagem_url: string | null }>();
    if (domNames.length > 0) {
      const { data: srData } = await supabase
        .from("search_results")
        .select("nome_playlist, seguidores, spotify_url, imagem_url")
        .eq("genre_id", body.genre_id)
        .in("nome_playlist", domNames);
      // Pega o de maior seguidores caso tenha duplicata por nome
      for (const r of srData ?? []) {
        const prev = playlistsMetaMap.get(r.nome_playlist);
        if (!prev || (r.seguidores ?? 0) > (prev.seguidores ?? 0)) {
          playlistsMetaMap.set(r.nome_playlist, {
            seguidores: r.seguidores ?? 0,
            spotify_url: r.spotify_url,
            imagem_url: r.imagem_url,
          });
        }
      }
    }
    const insights = (model.insights as any) ?? {};
    const dnaVisual = insights.dna_visual ?? null;
    const subgeneros: any[] = Array.isArray(insights.subgeneros) ? insights.subgeneros : [];
    // Total real do corpus analisado (não só as dominantes)
    const totalPlaylists = Math.max(corpusCount ?? 0, playlistsDom.length, 1);

    // Helper: classifica um formato/keyword/cards num subgênero
    function classifySub(text: string): { slug: string; nome: string } | null {
      const lower = (text ?? "").toLowerCase();
      for (const s of subgeneros) {
        const slug = String(s.slug ?? s.nome ?? "").toLowerCase();
        if (slug && lower.includes(slug)) return { slug: s.slug, nome: s.nome };
      }
      return null;
    }

    // ═══════════════ KEYWORDS COM PESO % ═══════════════
    const totalKwCount = palavrasChave.reduce((s: number, k: any) => s + (k.count ?? 0), 0) || 1;
    const sortedKw = [...palavrasChave]
      .map((k: any) => ({
        value: String(k.value ?? "").trim(),
        count: k.count ?? 0,
        peso: Math.round(((k.count ?? 0) / totalKwCount) * 1000) / 10, // 1 casa decimal
      }))
      .filter(k => k.value && k.peso >= KW_MIN_PCT)
      .sort((a, b) => b.peso - a.peso);

    // ═══════════════ FORMATOS COM SCORE ═══════════════
    const sortedFormats = [...padroesNome]
      .map((p: any) => ({
        value: String(p.value ?? "").trim(),
        count: p.count ?? 0,
      }))
      .filter(p => p.value)
      .sort((a, b) => b.count - a.count);

    // ═══════════════ BASE MUSICAL ═══════════════
    const allTracks = musicasRec.map((m: any) => ({
      nome: m.nome, artista: m.artista, count: m.count ?? 1,
    }));

    const artistMap = new Map<string, number>();
    for (const t of musicasRec) {
      const a = (t.artista ?? "").trim();
      if (!a) continue;
      artistMap.set(a, (artistMap.get(a) ?? 0) + (t.count ?? 1));
    }
    const allArtists = Array.from(artistMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([nome]) => nome);

    // Histórico p/ trend
    const prevKwSet = new Set(
      ((history?.[1]?.palavras_chave as any[]) ?? []).map((k: any) => k.value)
    );

    // ═══════════════ GERAR CARDS COM ROTAÇÃO POR SUBGÊNERO ═══════════════
    // Pool global (fallback quando não há subgênero detectado)
    const valid: any[] = [];
    const kwLen = sortedKw.length;
    const trackLen = allTracks.length;
    const artistLen = allArtists.length;

    // Pré-monta pools por subgênero (keywords + tracks isoladas, não misturam clusters)
    const subPools = new Map<string, {
      kws: { value: string; peso: number }[];
      tracks: { nome: string; artista: string }[];
      artists: string[];
    }>();
    for (const sg of subgeneros) {
      const tot = (sg.top_keywords ?? []).reduce((s: number, k: any) => s + (k.count ?? 0), 0) || 1;
      const kws = (sg.top_keywords ?? [])
        .map((k: any) => ({
          value: String(k.value ?? "").trim(),
          peso: Math.round(((k.count ?? 0) / tot) * 1000) / 10,
        }))
        .filter((k: any) => k.value);
      const tracks = (sg.top_tracks ?? []).map((t: any) => ({ nome: t.nome, artista: t.artista }));
      const artistMapSg = new Map<string, number>();
      for (const t of (sg.top_tracks ?? [])) {
        const a = (t.artista ?? "").trim();
        if (!a) continue;
        artistMapSg.set(a, (artistMapSg.get(a) ?? 0) + (t.count ?? 1));
      }
      const artists = Array.from(artistMapSg.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([n]) => n);
      subPools.set(String(sg.slug ?? sg.nome).toLowerCase(), { kws, tracks, artists });
    }

    // Contador pra rotação por subgênero (cada sub tem seu próprio offset)
    const subRotation = new Map<string, number>();

    for (let fi = 0; fi < sortedFormats.length && valid.length < MAX_RESULTS; fi++) {
      const fmt = sortedFormats[fi];
      const freq = (fmt.count / totalPlaylists) * 100;
      const rep = fmt.count;

      // 🚨 FILTROS DE QUALIDADE
      if (freq < MIN_FREQ_PCT) continue;
      if (rep < MIN_REPETITIONS) continue;

      // 🏷️ CLASSIFICA SUBGÊNERO do formato
      const subInfo = classifySub(fmt.value);
      const subKey = subInfo ? subInfo.slug.toLowerCase() : "_global";
      const pool = subInfo ? subPools.get(subKey) : null;

      // Decide pools: se há pool do subgênero com keywords/tracks suficientes, usa eles
      // (não mistura mandelão com consciente). Se não, cai no global.
      const useSubPool = !!pool && pool.kws.length >= MIN_KEYWORDS && pool.tracks.length > 0;
      const kwSource = useSubPool ? pool!.kws : sortedKw.map(k => ({ value: k.value, peso: k.peso }));
      const trackSource = useSubPool ? pool!.tracks : allTracks.map(t => ({ nome: t.nome, artista: t.artista }));
      const artistSource = useSubPool ? pool!.artists : allArtists;

      const kwSrcLen = kwSource.length;
      const trkSrcLen = trackSource.length;
      const artSrcLen = artistSource.length;
      if (kwSrcLen < MIN_KEYWORDS) continue;

      // 🔄 ROTAÇÃO independente por subgênero (cards do mesmo sub não repetem keywords)
      const rotIdx = subRotation.get(subKey) ?? 0;
      subRotation.set(subKey, rotIdx + 1);

      const kwStart = (rotIdx * KW_PER_CARD) % kwSrcLen;
      const selectedKw: any[] = [];
      for (let i = 0; i < KW_PER_CARD; i++) selectedKw.push(kwSource[(kwStart + i) % kwSrcLen]);
      const seenK = new Set<string>();
      const uniqKw = selectedKw.filter((k: any) => {
        if (!k?.value || seenK.has(k.value)) return false;
        seenK.add(k.value); return true;
      });
      if (uniqKw.length < MIN_KEYWORDS) continue;

      const tStart = trkSrcLen ? (rotIdx * TRACKS_PER_CARD) % trkSrcLen : 0;
      const tracks: any[] = [];
      for (let i = 0; i < TRACKS_PER_CARD && i < trkSrcLen; i++) tracks.push(trackSource[(tStart + i) % trkSrcLen]);

      const aStart = artSrcLen ? (rotIdx * 3) % artSrcLen : 0;
      const artists: string[] = [];
      for (let i = 0; i < 5 && i < artSrcLen; i++) artists.push(artistSource[(aStart + i) % artSrcLen]);

      // 📊 SCORE
      const score = (freq * 0.5) + (rep * 0.3) + (uniqKw.length * 5);
      const forca_nome = Math.min(100, Math.round(score));

      // 🎯 CONFIDENCE
      let confidence: "alta" | "media" | "baixa" = "baixa";
      if (freq >= 6 && rep >= 5) confidence = "alta";
      else if (freq >= 4 && rep >= 3) confidence = "media";

      // 📈 TREND
      let sinal = "estável";
      if (prevKwSet.size > 0) {
        const novosKw = uniqKw.filter((k: any) => !prevKwSet.has(k.value));
        if (novosKw.length >= 2) sinal = "crescimento";
      } else if (history && history.length === 0) {
        sinal = "novo";
      }

      // 📝 NOME BASE
      const fmtTitle = titleCase(fmt.value);
      const nomeBase = fmtTitle.toLowerCase().includes(genre.nome.toLowerCase())
        ? fmtTitle
        : `${fmtTitle} ${titleCase(genre.nome)}`;

      // 🎯 PLAYLISTS DE REFERÊNCIA: dominantes que casam com o formato
      const fmtLower = fmt.value.toLowerCase();
      const refMatches = playlistsDom
        .filter((p: any) => String(p.nome ?? "").toLowerCase().includes(fmtLower))
        .map((p: any) => {
          const meta = playlistsMetaMap.get(p.nome);
          return {
            nome: p.nome,
            seguidores: meta?.seguidores ?? p.seguidores ?? 0,
            spotify_url: meta?.spotify_url ?? p.spotify_url ?? null,
            imagem_url: meta?.imagem_url ?? p.imagem_url ?? null,
          };
        })
        .sort((a, b) => (b.seguidores ?? 0) - (a.seguidores ?? 0));

      const playlistsRef = (refMatches.length > 0 ? refMatches : playlistsDom.slice(0, 3).map((p: any) => {
        const meta = playlistsMetaMap.get(p.nome);
        return {
          nome: p.nome,
          seguidores: meta?.seguidores ?? p.seguidores ?? 0,
          spotify_url: meta?.spotify_url ?? p.spotify_url ?? null,
          imagem_url: meta?.imagem_url ?? p.imagem_url ?? null,
        };
      })).slice(0, 3);

      const totalSeg = playlistsRef.reduce((s, p) => s + (p.seguidores ?? 0), 0);
      const mediaSeguidores = playlistsRef.length > 0 ? Math.round(totalSeg / playlistsRef.length) : 0;

      valid.push({
        nome: nomeBase,
        nome_provisorio: nomeBase,
        forca_nome,
        formato: fmt.value,
        formato_id: `fmt_${fi}`,
        // 🆕 SUBGÊNERO (null quando não classificável)
        subgenero: subInfo ? { slug: subInfo.slug, nome: subInfo.nome } : null,
        keywords_utilizadas: uniqKw.map((k: any) => ({ value: k.value, peso: k.peso })),
        base_musical: {
          top_musicas: tracks.map(t => ({ nome: t.nome, artista: t.artista })),
          artistas_principais: artists,
        },
        playlists_referencia: playlistsRef,
        metricas: {
          media_seguidores: mediaSeguidores,
          total_referencias: playlistsRef.length,
        },
        dna_capa: dnaVisual,
        justificativa: {
          frequencia_padrao_pct: Math.round(freq * 10) / 10,
          repeticao_em_playlists: rep,
          score: Math.round(score),
          sinal,
        },
        confidence,
      });
    }

    // ═══════════════ IA: REFINAR NOMES (opcional) ═══════════════
    if (LOVABLE_API_KEY && valid.length > 0) {
      try {
        const summary = valid.map((c, i) =>
          `${i + 1}. Formato detectado: "${c.formato}" | Keywords: ${c.keywords_utilizadas.map((k: any) => `${k.value}(${k.peso}%)`).join(", ")} | Nome base: "${c.nome_provisorio}"`
        ).join("\n");

        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: `Você refina nomes de playlists do Spotify para o gênero ${genre.nome} no Brasil. REGRAS ESTRITAS:
- Mantenha o FORMATO DETECTADO de cada item (não invente formatos novos)
- Use as KEYWORDS de maior peso quando fizer sentido
- Soe natural e atraente para SEO no Spotify (PT-BR)
- NÃO copie textualmente nomes de playlists existentes
- NÃO invente conceitos não presentes nas keywords/formato
- Pode usar 1 emoji no máximo por nome (se combinar com o gênero)
- Responda APENAS JSON válido`
              },
              {
                role: "user",
                content: `Refine estes ${valid.length} nomes mantendo o formato detectado de cada um.

Playlists dominantes (referência, NÃO copiar): ${playlistsDom.slice(0, 8).map((p: any) => `"${p.nome}"`).join(", ")}

${summary}

Responda JSON: {"playlists": [{"idx": 1, "nome_final": "..."}, ...]}`
              },
            ],
            response_format: { type: "json_object" },
          }),
        });

        if (aiResp.ok) {
          const aiJson = await aiResp.json();
          const content = aiJson?.choices?.[0]?.message?.content ?? "{}";
          try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed.playlists)) {
              for (const p of parsed.playlists) {
                const idx = (p.idx ?? 0) - 1;
                if (idx >= 0 && idx < valid.length && typeof p.nome_final === "string" && p.nome_final.trim()) {
                  valid[idx].nome = p.nome_final.trim();
                }
              }
            }
          } catch (e) {
            console.error("AI JSON parse failed:", e);
          }
        } else {
          console.error("AI refinement HTTP error:", aiResp.status, await aiResp.text());
        }
      } catch (e) {
        console.error("AI name refinement failed:", e);
      }
    }

    // Limpa nome_provisorio
    for (const c of valid) delete c.nome_provisorio;

    // Ordena por score desc
    valid.sort((a, b) => b.justificativa.score - a.justificativa.score);

    // ═══════════════ SALVAR ═══════════════
    const { data: lastBriefing } = await supabase
      .from("playlist_briefings")
      .select("version")
      .eq("genre_id", body.genre_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = (lastBriefing?.version ?? 0) + 1;

    await supabase.from("playlist_briefings").insert({
      genre_id: body.genre_id,
      version: nextVersion,
      briefings: valid,
      metadata: {
        total_keywords_analisadas: sortedKw.length,
        total_padroes_analisados: sortedFormats.length,
        total_playlists_referencia: totalPlaylists,
        total_tracks_base: musicasRec.length,
        total_artistas_base: allArtists.length,
        cards_gerados: valid.length,
        cards_descartados: sortedFormats.length - valid.length,
        filtros: { MIN_FREQ_PCT, MIN_REPETITIONS, MIN_KEYWORDS, KW_MIN_PCT },
        generated_at: new Date().toISOString(),
        duration_ms: Date.now() - start,
      },
    });

    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      acao: "generate-briefing",
      status: "sucesso",
      mensagem: `Briefing v${nextVersion}: ${valid.length} playlists qualificadas (${sortedFormats.length - valid.length} descartadas por filtro)`,
      duracao_ms: Date.now() - start,
    });

    return j({ ok: true, version: nextVersion, briefings: valid, count: valid.length });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("generate-playlists-briefing error", msg);
    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      acao: "generate-briefing",
      status: "erro",
      mensagem: msg.slice(0, 500),
      duracao_ms: Date.now() - start,
    }).catch(() => {});
    return j({ ok: false, error: msg }, 500);
  }
});
