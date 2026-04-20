// generate-playlists-briefing — gera 10 playlists prontas para criação com base em dados reais
// Híbrido: algoritmo seleciona conceitos por score, IA refina nomes
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

function j(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ═══════════════ PADRÕES DE FORMATO ═══════════════
const FORMAT_TEMPLATES = [
  { id: "genero_ano", label: "Gênero + Ano", pattern: (g: string) => `${g} 2026` },
  { id: "genero_atualizado", label: "Gênero + Atualizado", pattern: (g: string) => `${g} Atualizado` },
  { id: "genero_contexto", label: "Gênero + Contexto", pattern: (g: string) => `${g} pra Estrada` },
  { id: "genero_emocao", label: "Gênero + Emoção", pattern: (g: string) => `${g} Sofrência` },
  { id: "genero_viral", label: "Gênero + Viral/TikTok", pattern: (g: string) => `${g} Viral` },
  { id: "top_hits", label: "Top/Melhores + Gênero", pattern: (g: string) => `Top ${g}` },
  { id: "genero_subgenero", label: "Gênero + Subgênero", pattern: (g: string) => `${g} Raiz` },
  { id: "genero_festa", label: "Gênero + Festa/Balada", pattern: (g: string) => `${g} pra Festa` },
  { id: "genero_romantico", label: "Gênero + Romântico", pattern: (g: string) => `${g} Romântico` },
  { id: "genero_lancamentos", label: "Gênero + Lançamentos", pattern: (g: string) => `Lançamentos ${g}` },
  { id: "genero_classicos", label: "Gênero + Clássicos", pattern: (g: string) => `Clássicos do ${g}` },
  { id: "genero_relaxar", label: "Gênero + Momento", pattern: (g: string) => `${g} pra Relaxar` },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const start = Date.now();

  let body: { genre_id: string };
  try { body = await req.json(); } catch { return j({ error: "Invalid JSON" }, 400); }
  if (!body.genre_id) return j({ error: "genre_id obrigatório" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // ═══════════════ CARREGAR DADOS ═══════════════
    const [{ data: genre }, { data: model }, { data: history }] = await Promise.all([
      supabase.from("genres").select("id,nome,slug").eq("id", body.genre_id).single(),
      supabase.from("genre_models").select("*").eq("genre_id", body.genre_id).maybeSingle(),
      supabase.from("genre_models_history")
        .select("version,palavras_chave,musicas_recorrentes,playlists_dominantes")
        .eq("genre_id", body.genre_id)
        .order("version", { ascending: false })
        .limit(2),
    ]);

    if (!genre) return j({ error: "Gênero não encontrado" }, 404);
    if (!model) return j({ error: "Sem modelo. Execute analyze-genre primeiro." }, 400);

    const palavrasChave = (model.palavras_chave as any[] ?? []);
    const padroesNome = (model.padroes_nome as any[] ?? []);
    const playlistsDom = (model.playlists_dominantes as any[] ?? []);
    const musicasRec = (model.musicas_recorrentes as any[] ?? []);
    const insights = (model.insights as any) ?? {};

    // ═══════════════ ETAPA 1: PESO DAS KEYWORDS ═══════════════
    const maxFreq = Math.max(1, ...palavrasChave.map((k: any) => k.count ?? 0));
    const topPlaylistNames = playlistsDom.slice(0, 15).map((p: any) => (p.nome ?? "").toLowerCase());

    const keywordsScored = palavrasChave.map((k: any) => {
      const freqNorm = (k.count ?? 0) / maxFreq;
      const inTopPlaylists = topPlaylistNames.filter(n => n.includes(k.value.toLowerCase())).length;
      const presenceScore = Math.min(1, inTopPlaylists / 5);
      const score = freqNorm * 0.6 + presenceScore * 0.4;
      return { value: k.value, count: k.count, score: Math.round(score * 100) };
    }).sort((a: any, b: any) => b.score - a.score);

    // ═══════════════ ETAPA 2: PADRÕES VENCEDORES ═══════════════
    const maxPatFreq = Math.max(1, ...padroesNome.map((p: any) => p.count ?? 0));
    const patternsScored = padroesNome.map((p: any) => {
      const freqNorm = (p.count ?? 0) / maxPatFreq;
      const inBig = playlistsDom.filter((pl: any) =>
        (pl.nome ?? "").toLowerCase().includes(p.value.toLowerCase())
      ).length;
      const bigPresence = Math.min(1, inBig / 3);
      const score = freqNorm * 0.5 + bigPresence * 0.5;
      return { value: p.value, count: p.count, score: Math.round(score * 100) };
    }).sort((a: any, b: any) => b.score - a.score);

    // Match detected patterns to format templates
    const detectedFormats = FORMAT_TEMPLATES.map(fmt => {
      let matchCount = 0;
      const fmtWords = fmt.id.split("_");
      for (const pat of patternsScored.slice(0, 15)) {
        const patLow = pat.value.toLowerCase();
        if (fmtWords.some(w => patLow.includes(w)) || patLow.includes(fmt.label.split("+")[1]?.trim().toLowerCase() ?? "xxx")) {
          matchCount += pat.count;
        }
      }
      // Also check keyword presence
      for (const kw of keywordsScored.slice(0, 20)) {
        if (fmtWords.some(w => kw.value.toLowerCase().includes(w))) {
          matchCount += Math.round(kw.count * 0.5);
        }
      }
      return { ...fmt, matchCount };
    }).sort((a, b) => b.matchCount - a.matchCount);

    // ═══════════════ ETAPA 3: BASE MUSICAL ═══════════════
    const topTracks = musicasRec.slice(0, 30).map((m: any) => ({
      nome: m.nome, artista: m.artista, count: m.count,
    }));

    // Artistas dominantes
    const artistMap = new Map<string, number>();
    for (const t of musicasRec) {
      const a = (t.artista ?? "").trim();
      if (!a) continue;
      artistMap.set(a, (artistMap.get(a) ?? 0) + (t.count ?? 1));
    }
    const topArtists = Array.from(artistMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([nome, count]) => ({ nome, count }));

    // ═══════════════ ETAPA 4: DNA VISUAL (placeholder) ═══════════════
    const dnaCapa = {
      estilo_dominante: "A definir — análise visual não implementada",
      cores: [],
      uso_texto: "A definir",
      estrutura_visual: "A definir",
    };

    // ═══════════════ ETAPA 5: GERAR 10 CONCEITOS ═══════════════
    // Selecionar 10 formatos únicos, distribuindo keywords
    const usedFormats = new Set<string>();
    const concepts: any[] = [];
    const kwPool = [...keywordsScored];

    for (const fmt of detectedFormats) {
      if (concepts.length >= 10) break;
      if (usedFormats.has(fmt.id)) continue;
      usedFormats.add(fmt.id);

      // Selecionar 3-5 keywords relevantes para este formato
      const relevantKw = kwPool.slice(0, 5).map(k => ({ value: k.value, peso: k.score }));
      // Rotate keywords para não repetir
      if (kwPool.length > 3) kwPool.push(kwPool.shift()!);

      // Selecionar tracks base
      const trackSlice = topTracks.slice(concepts.length * 3, concepts.length * 3 + 5);
      if (trackSlice.length === 0) trackSlice.push(...topTracks.slice(0, 3));

      // Frequência deste padrão no corpus
      const totalPatterns = padroesNome.reduce((s: number, p: any) => s + (p.count ?? 0), 0) || 1;
      const patternFreq = Math.round((fmt.matchCount / totalPatterns) * 100);

      // Crescimento: comparar com versão anterior se disponível
      let trend = "estável";
      if (history && history.length >= 2) {
        const prevKw = new Set(((history[1]?.palavras_chave as any[]) ?? []).map((k: any) => k.value));
        const newKw = relevantKw.filter(k => !prevKw.has(k.value));
        if (newKw.length >= 2) trend = "crescimento";
      }

      concepts.push({
        formato_id: fmt.id,
        formato: fmt.label,
        keywords_utilizadas: relevantKw,
        base_musical: {
          top_musicas: trackSlice.map(t => ({ nome: t.nome, artista: t.artista })),
          artistas_principais: topArtists.slice(0, 5).map(a => a.nome),
        },
        dna_capa: dnaCapa,
        justificativa: {
          frequencia_padrao_pct: patternFreq,
          repeticao_em_playlists: fmt.matchCount,
          sinal: trend,
        },
        nome_provisorio: fmt.pattern(genre.nome),
      });
    }

    // Fill up to 10 if needed with remaining formats
    if (concepts.length < 10) {
      for (const fmt of FORMAT_TEMPLATES) {
        if (concepts.length >= 10) break;
        if (usedFormats.has(fmt.id)) continue;
        usedFormats.add(fmt.id);
        concepts.push({
          formato_id: fmt.id,
          formato: fmt.label,
          keywords_utilizadas: kwPool.slice(0, 3).map(k => ({ value: k.value, peso: k.score })),
          base_musical: {
            top_musicas: topTracks.slice(0, 3).map(t => ({ nome: t.nome, artista: t.artista })),
            artistas_principais: topArtists.slice(0, 3).map(a => a.nome),
          },
          dna_capa: dnaCapa,
          justificativa: {
            frequencia_padrao_pct: 0,
            repeticao_em_playlists: 0,
            sinal: "novo",
          },
          nome_provisorio: fmt.pattern(genre.nome),
        });
      }
    }

    // ═══════════════ IA: REFINAR NOMES ═══════════════
    if (LOVABLE_API_KEY) {
      try {
        const conceptsSummary = concepts.map((c, i) => 
          `${i+1}. Formato: ${c.formato} | Keywords: ${c.keywords_utilizadas.map((k: any) => `${k.value}(${k.peso}%)`).join(", ")} | Provisório: "${c.nome_provisorio}"`
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
              { role: "system", content: `Você é um especialista em SEO de playlists do Spotify para o gênero ${genre.nome} no Brasil. Refine os nomes provisórios para soarem naturais, atraentes e otimizados para busca. REGRAS: manter o padrão/formato de cada, usar as keywords de maior peso, NÃO inventar conceitos novos, NÃO copiar playlists existentes textualmente. Responda APENAS JSON válido.` },
              { role: "user", content: `Refine estes 10 nomes de playlists. Para cada, retorne nome_final e forca_nome (0-100, baseado em peso das keywords usadas).\n\nPlaylists dominantes no gênero (referência, NÃO copiar): ${playlistsDom.slice(0, 10).map((p: any) => `"${p.nome}"`).join(", ")}\n\n${conceptsSummary}\n\nResponda JSON: {"playlists": [{"idx": 1, "nome_final": "...", "forca_nome": 85}, ...]}` },
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
                if (idx >= 0 && idx < concepts.length && typeof p.nome_final === "string") {
                  concepts[idx].nome = p.nome_final;
                  concepts[idx].forca_nome = typeof p.forca_nome === "number" ? p.forca_nome : 50;
                }
              }
            }
          } catch { /* fallback to provisório */ }
        }
      } catch (e) {
        console.error("AI name refinement failed:", e);
      }
    }

    // Ensure all have nome and forca_nome
    for (const c of concepts) {
      if (!c.nome) c.nome = c.nome_provisorio;
      if (!c.forca_nome) {
        // Calculate from keyword scores
        const avgKwScore = c.keywords_utilizadas.length > 0
          ? c.keywords_utilizadas.reduce((s: number, k: any) => s + k.peso, 0) / c.keywords_utilizadas.length
          : 30;
        c.forca_nome = Math.round(avgKwScore);
      }
      delete c.nome_provisorio;
    }

    // Sort by forca_nome desc
    concepts.sort((a, b) => b.forca_nome - a.forca_nome);

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
      briefings: concepts,
      metadata: {
        total_keywords_analisadas: keywordsScored.length,
        total_padroes_analisados: patternsScored.length,
        total_playlists_referencia: playlistsDom.length,
        total_tracks_base: musicasRec.length,
        total_artistas_base: topArtists.length,
        generated_at: new Date().toISOString(),
        duration_ms: Date.now() - start,
      },
    });

    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      acao: "generate-briefing",
      status: "sucesso",
      mensagem: `Briefing v${nextVersion} gerado: ${concepts.length} playlists, ${concepts.map(c => c.nome).join(" | ")}`.slice(0, 500),
      duracao_ms: Date.now() - start,
    });

    return j({ ok: true, version: nextVersion, briefings: concepts });
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
    return j({ ok: false, error: msg });
  }
});
