// generate-playlists-briefing — motor de decisão honesto
// Filtros de qualidade + score transparente + confidence + IA refina nomes
// Retorna entre 0 e 10 playlists (NUNCA força fillers)
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateBriefing, validate, activeProvider } from "../_shared/ai_service.ts";

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

// 🚧 PISOS ABSOLUTOS (mesmo em modo expansão — nunca aceitar lixo)
const HARD_MIN_FREQ_PCT = 1;     // < 1% nunca entra, nem em expansão
const HARD_MIN_REP = 1;          // < 1 repetição nunca entra
const HARD_MIN_TRACKS = 2;       // < 2 músicas relevantes nunca entra
const SCORE_MIN_EXPANSAO = 15;   // score mínimo pra card expansão sobreviver

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

  let body: { genre_id: string; survival_mode?: boolean };
  try { body = await req.json(); } catch { return j({ error: "Invalid JSON" }, 400); }
  if (!body.genre_id) return j({ error: "genre_id obrigatório" }, 400);
  const survivalMode = body.survival_mode === true;
  // 🛟 Modo sobrevivência: filtros relaxados (mas mantém HARD_MIN_TRACKS)
  const effMinFreqPct = survivalMode ? 2 : MIN_FREQ_PCT;
  const effMinReps = survivalMode ? 1 : MIN_REPETITIONS;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // ═══════════════ CARREGAR DADOS ═══════════════
    const [{ data: genre }, { data: model }, { data: history }, { count: corpusCount }, { data: filters }] = await Promise.all([
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
      supabase.from("genre_filters")
        .select("briefing_mode")
        .eq("genre_id", body.genre_id)
        .maybeSingle(),
    ]);

    // 🎛️ MODO DE DISTRIBUIÇÃO: 'strict' (padrão) ou 'expansao'
    const briefingMode: "strict" | "expansao" =
      (filters?.briefing_mode === "expansao") ? "expansao" : "strict";

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

    // Helper: classifica por nome (formato/keyword)
    function classifySub(text: string): { slug: string; nome: string } | null {
      const lower = (text ?? "").toLowerCase();
      for (const s of subgeneros) {
        const slug = String(s.slug ?? s.nome ?? "").toLowerCase();
        if (slug && lower.includes(slug)) return { slug: s.slug, nome: s.nome };
      }
      return null;
    }

    // ═══ MAPAS DE INFERÊNCIA POR TRACKS/ARTISTAS ═══
    // Para cada subgênero, monta sets de "trackKey" e "artista" dominantes
    const norm = (s: string) => (s ?? "").toLowerCase().trim();
    const trackKeyOf = (n: string, a: string) => `${norm(n)}||${norm(a)}`;
    const subToTracks = new Map<string, Set<string>>();
    const subToArtists = new Map<string, Set<string>>();
    const subInfoBySlug = new Map<string, { slug: string; nome: string }>();
    for (const sg of subgeneros) {
      const slug = String(sg.slug ?? sg.nome ?? "").toLowerCase();
      if (!slug) continue;
      subInfoBySlug.set(slug, { slug: sg.slug, nome: sg.nome });
      const tset = new Set<string>();
      const aset = new Set<string>();
      for (const t of (sg.top_tracks ?? [])) {
        if (t?.nome && t?.artista) tset.add(trackKeyOf(t.nome, t.artista));
        if (t?.artista) aset.add(norm(t.artista));
      }
      subToTracks.set(slug, tset);
      subToArtists.set(slug, aset);
    }

    // Infere subgênero a partir de uma lista de tracks (≥60% pertencem ao cluster)
    function inferSubFromTracks(tracks: { nome: string; artista: string }[]): { slug: string; nome: string } | null {
      if (!tracks.length || subInfoBySlug.size === 0) return null;
      const scores = new Map<string, number>();
      for (const t of tracks) {
        const tk = trackKeyOf(t.nome, t.artista);
        const ar = norm(t.artista);
        for (const [slug] of subInfoBySlug) {
          let hit = 0;
          if (subToTracks.get(slug)?.has(tk)) hit += 1;
          else if (subToArtists.get(slug)?.has(ar)) hit += 0.6;
          if (hit > 0) scores.set(slug, (scores.get(slug) ?? 0) + hit);
        }
      }
      if (scores.size === 0) return null;
      const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
      const [bestSlug, bestScore] = ranked[0];
      const ratio = bestScore / tracks.length;
      if (ratio >= 0.6) return subInfoBySlug.get(bestSlug) ?? null;
      // fallback: maioria simples se pelo menos 40% e gap ≥ 1.5x sobre o segundo
      if (ratio >= 0.4 && (!ranked[1] || bestScore >= ranked[1][1] * 1.5)) {
        return subInfoBySlug.get(bestSlug) ?? null;
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

    // ═══ COTAS POR SUBGÊNERO (balanceamento + priorização) ═══
    const subsRanked = [...subgeneros]
      .filter((s: any) => s.slug || s.nome)
      .sort((a: any, b: any) => (b.total_playlists ?? 0) - (a.total_playlists ?? 0));
    const subQuota = new Map<string, { max: number; min: number; count: number }>();
    for (let i = 0; i < subsRanked.length; i++) {
      const slug = String(subsRanked[i].slug ?? subsRanked[i].nome).toLowerCase();
      // STRICT: prioriza volume — top1=4, top2=3, top3-4=2, resto=1, sem mínimo
      // EXPANSAO: distribuição mais plana + mínimo 1-2 por sub detectado
      let max: number, min: number;
      if (briefingMode === "expansao") {
        max = i === 0 ? 3 : 2;
        min = i < 2 ? 2 : 1; // garante 1-2 cards mesmo em subs fracos
      } else {
        max = i === 0 ? 4 : i === 1 ? 3 : i < 4 ? 2 : 1;
        min = 0;
      }
      subQuota.set(slug, { max, min, count: 0 });
    }

    // ═══════════════ PASS BUILDER ═══════════════
    // Constrói cards numa pass (strict ou expansao). Retorna candidatos válidos.
    function buildCards(pass: "strict" | "expansao", skipFormatIdx: Set<number>): any[] {
      const out: any[] = [];

      // Limites por pass (survival_mode relaxa pisos do strict pass)
      const minFreq = pass === "expansao" ? HARD_MIN_FREQ_PCT : effMinFreqPct;
      const minRep = pass === "expansao" ? HARD_MIN_REP : effMinReps;

      for (let fi = 0; fi < sortedFormats.length; fi++) {
        if (skipFormatIdx.has(fi)) continue;
        if (valid.length + out.length >= MAX_RESULTS) break;

        const fmt = sortedFormats[fi];
        const freq = (fmt.count / totalPlaylists) * 100;
        const rep = fmt.count;

        // 🚨 FILTROS DE FREQUÊNCIA / REPETIÇÃO
        if (freq < minFreq) continue;
        if (rep < minRep) continue;

        // 🏷️ CLASSIFICAÇÃO OBRIGATÓRIA
        let subInfo = classifySub(fmt.value);
        const hasClusters = subInfoBySlug.size > 0;
        if (hasClusters && !subInfo) {
          const sampleTracks = allTracks.slice(0, 8).map(t => ({ nome: t.nome, artista: t.artista }));
          subInfo = inferSubFromTracks(sampleTracks);
          if (!subInfo) continue;
        }

        const subKey = subInfo ? subInfo.slug.toLowerCase() : "_global";

        // 📏 RESPEITA COTA
        const quota = subQuota.get(subKey);
        if (quota && quota.count >= quota.max) continue;

        const pool = subInfo ? subPools.get(subKey) : null;
        const useSubPool = !!subInfo;
        if (useSubPool && (!pool || pool.kws.length < MIN_KEYWORDS || pool.tracks.length === 0)) {
          continue;
        }
        const kwSource = useSubPool ? pool!.kws : sortedKw.map(k => ({ value: k.value, peso: k.peso }));
        const trackSource = useSubPool ? pool!.tracks : allTracks.map(t => ({ nome: t.nome, artista: t.artista }));
        const artistSource = useSubPool ? pool!.artists : allArtists;

        const kwSrcLen = kwSource.length;
        const trkSrcLen = trackSource.length;
        const artSrcLen = artistSource.length;
        if (kwSrcLen < MIN_KEYWORDS) continue;

        // 🚧 PISO ABSOLUTO: precisa de ao menos HARD_MIN_TRACKS músicas
        if (trkSrcLen < HARD_MIN_TRACKS) continue;

        // 🔄 ROTAÇÃO independente por subgênero
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

        // 🚧 PISO ABSOLUTO no card final também
        if (tracks.length < HARD_MIN_TRACKS) continue;

        const aStart = artSrcLen ? (rotIdx * 3) % artSrcLen : 0;
        const artists: string[] = [];
        for (let i = 0; i < 5 && i < artSrcLen; i++) artists.push(artistSource[(aStart + i) % artSrcLen]);

        // 🔬 RECONFIRMAÇÃO via tracks reais
        if (subInfo && hasClusters) {
          const reInfer = inferSubFromTracks(tracks);
          if (reInfer && reInfer.slug.toLowerCase() !== subInfo.slug.toLowerCase()) {
            continue;
          }
        }

        // 📊 SCORE
        const subPesoPct = subInfo
          ? (subgeneros.find((s: any) => String(s.slug).toLowerCase() === subKey)?.peso_pct ?? 0)
          : 0;
        const subBoost = Math.min(20, subPesoPct * 0.5);
        const score = (freq * 0.5) + (rep * 0.3) + (uniqKw.length * 5) + subBoost;
        const forca_nome = Math.min(100, Math.round(score));

        // 🚧 PISO DE SCORE EM EXPANSÃO: descarta lixo mesmo respeitando frequência
        if (pass === "expansao" && score < SCORE_MIN_EXPANSAO) continue;

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

        // 🎯 PLAYLISTS DE REFERÊNCIA
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

        // ✅ Incrementa cota e marca format consumido
        if (quota) quota.count += 1;
        skipFormatIdx.add(fi);

        out.push({
          nome: nomeBase,
          nome_provisorio: nomeBase,
          forca_nome,
          formato: fmt.value,
          formato_id: `fmt_${fi}`,
          subgenero: subInfo ? { slug: subInfo.slug, nome: subInfo.nome } : null,
          origem: pass, // 🏷️ TAG DE CONTROLE: "strict" ou "expansao"
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
            subgenero_peso_pct: subPesoPct || null,
          },
          confidence,
        });
      }
      return out;
    }

    // ═══════════════ EXECUÇÃO EM 2 PASSES ═══════════════
    // PASS 1 (sempre): STRICT — só playlists confiáveis primeiro
    const consumed = new Set<number>();
    const strictCards = buildCards("strict", consumed);
    valid.push(...strictCards);

    // PASS 2 (só em modo expansão): preenche com exploratórias respeitando piso
    if (briefingMode === "expansao" && valid.length < MAX_RESULTS) {
      const expansaoCards = buildCards("expansao", consumed);
      valid.push(...expansaoCards);
    }

    // 🛡️ GARANTIA FINAL: zero subgenero=null quando há clusters detectados
    if (subInfoBySlug.size > 0) {
      for (let i = valid.length - 1; i >= 0; i--) {
        if (!valid[i].subgenero) valid.splice(i, 1);
      }
    }

    // ═══════════════ IA: BRIEFING + VALIDAÇÃO (ai_service) ═══════════════
    const aiStats = { briefing_ok: 0, briefing_fail: 0, validated: 0, incoerente_ajustado: 0, incoerente_descartado: 0, provider: activeProvider() };

    for (let i = valid.length - 1; i >= 0; i--) {
      const c = valid[i];

      // 1) Validação pré-decisão (somente confidence baixa OU origem expansao)
      const needsValidate = c.confidence === "baixa" || c.origem === "expansao";
      if (needsValidate) {
        try {
          const v = await validate({
            genero: genre.nome,
            subgenero: c.subgenero?.nome ?? null,
            formato: c.formato,
            keywords: c.keywords_utilizadas.map((k: any) => k.value),
            top_tracks: c.base_musical.top_musicas,
          });
          aiStats.validated += 1;
          c.ai_validation = { status: v.status, motivo: v.motivo, provider: aiStats.provider };
          if (v.status === "incoerente") {
            if (v.ajuste?.subgenero && subInfoBySlug.has(String(v.ajuste.subgenero).toLowerCase())) {
              const newSub = subInfoBySlug.get(String(v.ajuste.subgenero).toLowerCase())!;
              c.subgenero = { slug: newSub.slug, nome: newSub.nome };
              aiStats.incoerente_ajustado += 1;
            } else {
              valid.splice(i, 1);
              aiStats.incoerente_descartado += 1;
              continue;
            }
          }
        } catch (e) {
          console.error("validate failed:", (e as Error).message);
        }
      }

      // 2) Briefing estruturado (sempre)
      try {
        const brief = await generateBriefing({
          formato: c.formato,
          nome_base: c.nome_provisorio,
          genero: genre.nome,
          subgenero: c.subgenero?.nome ?? null,
          keywords: c.keywords_utilizadas,
          top_tracks: c.base_musical.top_musicas,
          artistas: c.base_musical.artistas_principais,
          playlists_referencia: (c.playlists_referencia ?? []).map((p: any) => p.nome),
          dna_visual: dnaVisual,
        });
        if (brief.nome) c.nome = brief.nome;
        c.briefing_ai = {
          regras_nome: brief.regras_nome,
          capa_instrucao: brief.capa_instrucao,
          descricao: brief.descricao,
          regras_obrigatorias: brief.regras_obrigatorias,
          provider: aiStats.provider,
        };
        c.origem_ia = true;
        aiStats.briefing_ok += 1;
      } catch (e) {
        console.error("generateBriefing failed:", (e as Error).message);
        aiStats.briefing_fail += 1;
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
        subgeneros_detectados: subgeneros.map((s: any) => ({
          slug: s.slug, nome: s.nome, total_playlists: s.total_playlists, peso_pct: s.peso_pct,
        })),
        cards_por_subgenero: valid.reduce((acc: Record<string, number>, c: any) => {
          const k = c.subgenero?.slug ?? "_sem_classificacao";
          acc[k] = (acc[k] ?? 0) + 1; return acc;
        }, {}),
        filtros: { MIN_FREQ_PCT, MIN_REPETITIONS, MIN_KEYWORDS, KW_MIN_PCT, HARD_MIN_FREQ_PCT, HARD_MIN_REP, HARD_MIN_TRACKS, SCORE_MIN_EXPANSAO },
        cards_por_origem: valid.reduce((acc: Record<string, number>, c: any) => {
          const k = c.origem ?? "strict";
          acc[k] = (acc[k] ?? 0) + 1; return acc;
        }, {}),
        briefing_mode: briefingMode,
        survival_mode: survivalMode,
        ...(survivalMode ? { apify_blocked: true, data_freshness: "stale", effective_filters: { MIN_FREQ_PCT: effMinFreqPct, MIN_REPETITIONS: effMinReps, HARD_MIN_TRACKS } } : {}),
        ai: aiStats,
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
