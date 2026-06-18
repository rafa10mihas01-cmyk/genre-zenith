// analyze-genre — analisa search_results + search_tracks de um gênero e gera modelo de inteligência
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { classifySubgenre, activeProvider } from "../_shared/ai_service.ts";
import { requireTeamAccess } from "../_shared/auth.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STOPWORDS = new Set([
  "a","o","as","os","um","uma","de","da","do","das","dos","e","em","no","na","nos","nas",
  "para","por","com","sem","que","se","sua","seu","suas","seus","mais","melhor","melhores",
  "the","of","and","to","in","on","for","with","best","top","mix","playlist","playlists",
  "música","musicas","músicas","musica","top","hits","hit","new","novo","nova","novos","novas",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

// 🧬 Distância de Levenshtein (iterativa, O(n*m)). Curto-circuita quando excede `max`.
function levenshtein(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1; // poda — nenhum caminho viável
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// 🔗 Normaliza tokens mesclando typos: para cada token, procura um "canônico" mais
// frequente com distância ≤2. Aplica só se canônico for ≥3× mais frequente
// (evita colapsar palavras válidas distintas como "funk" e "junk").
function buildKeywordNormalizer(tokens: string[]): Map<string, string> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
  const map = new Map<string, string>();
  const MIN_LEN_FOR_FUZZY = 5; // só tenta merge em tokens ≥5 chars (curtos têm muitos vizinhos espúrios)
  const FREQ_RATIO = 3;
  for (const [tok, count] of sorted) {
    if (map.has(tok)) continue;
    if (tok.length < MIN_LEN_FOR_FUZZY) { map.set(tok, tok); continue; }
    // procura canônico já mapeado mais frequente E distante ≤2
    let best: string | null = null;
    for (const [canon, canonCount] of sorted) {
      if (canon === tok) break; // sorted desc — daqui pra frente é menos frequente
      if (canonCount < count * FREQ_RATIO) continue;
      if (canon.length < MIN_LEN_FOR_FUZZY) continue;
      if (levenshtein(tok, canon, 2) <= 2) { best = canon; break; }
    }
    map.set(tok, best ?? tok);
  }
  return map;
}

function topN<T extends string>(arr: T[], n: number): { value: T; count: number }[] {
  const map = new Map<T, number>();
  for (const v of arr) map.set(v, (map.get(v) ?? 0) + 1);
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

Deno.serve(async (req) => {
  const __dep = await deprecationGate(req, "analyze-genre");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  const start = Date.now();
  let body: { genre_id: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body.genre_id) {
    return new Response(JSON.stringify({ error: "genre_id obrigatório" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const MIN_QUALITY = 40;

    const [{ data: genre }, { data: results }, { data: tracks }, { data: terms }] = await Promise.all([
      supabase.from("genres").select("id,nome,slug").eq("id", body.genre_id).single(),
      // ONDA 1: somente playlists enriquecidas, válidas, com followers reais, quality_score mínimo,
      // não duplicadas. Nunca usar followers=NULL no ranking.
      supabase
        .from("search_results")
        .select("id,nome_playlist,seguidores,spotify_url,imagem_url,descricao,total_musicas,term_id,followers_source,followers_verified_at,quality_score,winner_score,winner_breakdown,enriched_at,is_valid,duplicate_of,times_seen,owner_id")
        .eq("genre_id", body.genre_id)
        .eq("is_valid", true)
        .eq("followers_source", "spotify_api")
        .not("followers_verified_at", "is", null)
        .not("enriched_at", "is", null)
        .not("seguidores", "is", null)
        .gte("quality_score", MIN_QUALITY)
        .is("duplicate_of", null)
        .limit(2000),
      supabase.from("search_tracks").select("nome_musica,artista,result_id").eq("genre_id", body.genre_id).limit(10000),
      supabase.from("search_terms").select("id,termo").eq("genre_id", body.genre_id),
    ]);

    if (!genre) throw new Error("Gênero não encontrado");

    const playlistNames = (results ?? []).map(r => r.nome_playlist).filter(Boolean) as string[];
    const rawTokens = playlistNames.flatMap(tokenize);

    // 🔗 Normalização: mescla typos via Levenshtein (≤2). Construído UMA vez sobre todo o universo
    // de tokens do gênero — usado tanto pra palavras_chave globais quanto pros subgêneros.
    const tokenNormalizer = buildKeywordNormalizer(rawTokens);
    const normalize = (tk: string) => tokenNormalizer.get(tk) ?? tk;
    const normalizedTokens = rawTokens.map(normalize);
    const palavras_chave = topN(normalizedTokens, 30);
    const mergedKeywordsCount = Array.from(tokenNormalizer.entries())
      .filter(([k, v]) => k !== v).length;
    if (mergedKeywordsCount > 0) {
      console.log(`[normalize] ${mergedKeywordsCount} typos mesclados em canônicos`);
    }

    // Padrões de nome: bigramas (com tokens normalizados — funde typos antes de contar)
    const bigrams: string[] = [];
    for (const name of playlistNames) {
      const t = tokenize(name).map(normalize);
      for (let i = 0; i < t.length - 1; i++) bigrams.push(`${t[i]} ${t[i+1]}`);
    }
    const padroes_nome = topN(bigrams, 20);

    // Playlists dominantes — RANKING WINNER SCORE v2 (Onda 2):
    //   primary: winner_score (composto), fallback quality_score, depois followers/freshness
    const seen = new Set<string>();
    const playlists_dominantes = (results ?? [])
      .filter(r => r.seguidores != null && r.spotify_url && !seen.has(r.spotify_url) && (seen.add(r.spotify_url), true))
      .sort((a, b) => {
        const wa = a.winner_score == null ? -1 : Number(a.winner_score);
        const wb = b.winner_score == null ? -1 : Number(b.winner_score);
        if (wa !== wb) return wb - wa;
        const qa = Number(a.quality_score ?? 0);
        const qb = Number(b.quality_score ?? 0);
        if (qa !== qb) return qb - qa;
        const fa = a.seguidores ?? 0;
        const fb = b.seguidores ?? 0;
        if (fa !== fb) return fb - fa;
        const ra = a.times_seen ?? 1;
        const rb = b.times_seen ?? 1;
        if (ra !== rb) return rb - ra;
        const ea = new Date(a.enriched_at ?? 0).getTime();
        const eb = new Date(b.enriched_at ?? 0).getTime();
        return eb - ea;
      })
      .slice(0, 25)
      .map(r => ({
        nome: r.nome_playlist,
        seguidores: r.seguidores ?? 0,
        url: r.spotify_url,
        imagem: r.imagem_url,
        total_musicas: r.total_musicas,
        quality_score: r.quality_score,
        winner_score: r.winner_score,
        winner_breakdown: r.winner_breakdown,
      }));

    // Músicas recorrentes
    const trackKey = (t: any) => `${(t.nome_musica ?? "").toLowerCase().trim()}||${(t.artista ?? "").toLowerCase().trim()}`;
    const trackMap = new Map<string, { nome: string; artista: string; count: number }>();
    for (const t of (tracks ?? [])) {
      const k = trackKey(t);
      if (!k || k === "||") continue;
      const cur = trackMap.get(k);
      if (cur) cur.count++;
      else trackMap.set(k, { nome: t.nome_musica, artista: t.artista, count: 1 });
    }
    const musicas_recorrentes = Array.from(trackMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);

    // ============ CLUSTERIZAÇÃO POR SUBGÊNERO ============
    // Subgênero = palavra extra que vem junto do gênero principal nos termos de busca
    // Ex: para "funk", os termos "funk mandelão", "funk consciente" → subs: mandelão, consciente
    const slugToken = tokenize(genre.slug ?? "")[0] ?? "";
    const nomeToken = tokenize(genre.nome ?? "")[0] ?? "";
    const baseTokens = new Set([slugToken, nomeToken].filter(Boolean));
    const NON_SUB = new Set([
      "2025","2026","2024","2023","tiktok","tik","tok","viral","top","mix","hits",
      "playlist","spotify","brasil","novo","novos","nova","novas","atualizado",
      "atualizada","lancamentos","melhores","melhor","tocadas","mais",
      "para","pra","com","sem","feat","official","oficial","radio","abril","maio",
    ]);

    // term_id → tokens extras (subgênero candidato) — normalizados
    const termIdToSubs = new Map<string, string[]>();
    for (const t of (terms ?? [])) {
      const toks = tokenize(t.termo ?? "").map(normalize);
      const extras = toks.filter(tk => !baseTokens.has(tk) && !NON_SUB.has(tk));
      termIdToSubs.set(t.id, extras);
    }
    // Universo de subs candidatos (vindos dos termos do kit)
    const allSubsFromTerms = new Set<string>();
    for (const arr of termIdToSubs.values()) for (const s of arr) allSubsFromTerms.add(s);

    const subWeight = new Map<string, number>();
    const subPlaylists = new Map<string, Set<string>>();
    const subKwBag = new Map<string, Map<string, number>>();
    const subTrackBag = new Map<string, Map<string, { nome: string; artista: string; count: number }>>();

    for (const r of (results ?? [])) {
      const fromTerm = termIdToSubs.get(r.term_id ?? "") ?? [];
      const nameToks = tokenize(r.nome_playlist ?? "").map(normalize);
      const descToks = tokenize((r as any).descricao ?? "").map(normalize);
      const cloud = new Set([...nameToks, ...descToks]);
      const candidates = new Set<string>(fromTerm);
      for (const s of allSubsFromTerms) if (cloud.has(s)) candidates.add(s);
      for (const sub of candidates) {
        if (!sub) continue;
        subWeight.set(sub, (subWeight.get(sub) ?? 0) + 1);
        if (!subPlaylists.has(sub)) subPlaylists.set(sub, new Set());
        subPlaylists.get(sub)!.add(r.id);
        if (!subKwBag.has(sub)) subKwBag.set(sub, new Map());
        const kbag = subKwBag.get(sub)!;
        for (const tk of nameToks) {
          if (baseTokens.has(tk) || NON_SUB.has(tk) || tk === sub) continue;
          kbag.set(tk, (kbag.get(tk) ?? 0) + 1);
        }
      }
    }

    // Distribui tracks por sub via result_id
    const resultIdToSubs = new Map<string, string[]>();
    for (const [sub, ids] of subPlaylists) {
      for (const id of ids) {
        if (!resultIdToSubs.has(id)) resultIdToSubs.set(id, []);
        resultIdToSubs.get(id)!.push(sub);
      }
    }
    for (const t of (tracks ?? [])) {
      const subs = resultIdToSubs.get((t as any).result_id ?? "") ?? [];
      for (const sub of subs) {
        if (!subTrackBag.has(sub)) subTrackBag.set(sub, new Map());
        const tbag = subTrackBag.get(sub)!;
        const k = trackKey(t);
        if (!k || k === "||") continue;
        const cur = tbag.get(k);
        if (cur) cur.count++;
        else tbag.set(k, { nome: t.nome_musica, artista: t.artista, count: 1 });
      }
    }

    const totalRes = results?.length ?? 0;
    const minPlaylistsForSub = Math.max(3, Math.floor(totalRes * 0.02));
    const subgeneros = Array.from(subWeight.entries())
      .filter(([, w]) => w >= minPlaylistsForSub)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([sub, w]) => {
        const kbag = subKwBag.get(sub) ?? new Map();
        const top_keywords = Array.from(kbag.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([value, count]) => ({ value, count }));
        const tbag = subTrackBag.get(sub) ?? new Map();
        const top_tracks = Array.from(tbag.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 8);
        return {
          slug: sub,
          nome: sub,
          total_playlists: w,
          peso_pct: totalRes > 0 ? Math.round((w / totalRes) * 1000) / 10 : 0,
          top_keywords,
          top_tracks,
        };
      });

    // ═══════════════ FALLBACK DE IA: SUBGÊNEROS INSUFICIENTES ═══════════════
    const ai_subgenres_added: any[] = [];
    let ai_meta: any = null;
    if (subgeneros.length < 2 && (results?.length ?? 0) >= 5) {
      try {
        const sample = (results ?? [])
          .filter(r => r.nome_playlist)
          .sort((a, b) => (b.seguidores ?? 0) - (a.seguidores ?? 0))
          .slice(0, 20);
        const tracksByResult = new Map<string, { nome: string; artista: string }[]>();
        for (const t of (tracks ?? [])) {
          const rid = (t as any).result_id;
          if (!rid) continue;
          if (!tracksByResult.has(rid)) tracksByResult.set(rid, []);
          const arr = tracksByResult.get(rid)!;
          if (arr.length < 8) arr.push({ nome: t.nome_musica, artista: t.artista });
        }
        const known = subgeneros.map(s => s.nome);
        const ai = await classifySubgenre(
          genre.nome,
          known,
          sample.map(r => ({
            id: r.id,
            nome: r.nome_playlist,
            descricao: (r as any).descricao ?? "",
            top_tracks: tracksByResult.get(r.id) ?? [],
          })),
        );
        const groups = new Map<string, { ids: string[] }>();
        for (const c of ai) {
          if (!c.subgenero || c.confidence === "baixa") continue;
          const k = c.subgenero.toLowerCase();
          if (!groups.has(k)) groups.set(k, { ids: [] });
          groups.get(k)!.ids.push(c.id);
        }
        for (const [slug, g] of groups) {
          if (g.ids.length < 2) continue;
          const grpResults = (results ?? []).filter(r => g.ids.includes(r.id));
          const kbag = new Map<string, number>();
          for (const r of grpResults) {
            for (const tk of tokenize(r.nome_playlist ?? "").map(normalize)) {
              if (baseTokens.has(tk) || NON_SUB.has(tk) || tk === slug) continue;
              kbag.set(tk, (kbag.get(tk) ?? 0) + 1);
            }
          }
          const tbag = new Map<string, { nome: string; artista: string; count: number }>();
          for (const r of grpResults) {
            for (const t of (tracksByResult.get(r.id) ?? [])) {
              const k = trackKey(t);
              if (!k || k === "||") continue;
              const cur = tbag.get(k);
              if (cur) cur.count++;
              else tbag.set(k, { nome: t.nome, artista: t.artista, count: 1 });
            }
          }
          ai_subgenres_added.push({
            slug,
            nome: slug,
            total_playlists: g.ids.length,
            peso_pct: totalRes > 0 ? Math.round((g.ids.length / totalRes) * 1000) / 10 : 0,
            top_keywords: Array.from(kbag.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([value, count]) => ({ value, count })),
            top_tracks: Array.from(tbag.values()).sort((a, b) => b.count - a.count).slice(0, 8),
            origem_ia: true,
          });
        }
        if (ai_subgenres_added.length > 0) subgeneros.push(...ai_subgenres_added);
        ai_meta = {
          provider: activeProvider(),
          playlists_classificadas: ai.length,
          subgeneros_inferidos: ai_subgenres_added.length,
        };
      } catch (e) {
        console.error("AI subgenre fallback failed:", (e as Error).message);
        ai_meta = { provider: activeProvider(), error: (e as Error).message };
      }
    }

    // 🔒 PRESERVA campos de outras funções (analyze-visual-dna, genre-insights)
    // que escrevem em `insights` antes/depois desta função no pipeline.
    // Sem isso, este update sobrescreve dna_visual / dna_visual_subgeneros / ai.
    const { data: existing } = await supabase
      .from("genre_models")
      .select("id,insights")
      .eq("genre_id", body.genre_id)
      .maybeSingle();

    const prevInsights = (existing?.insights as any) ?? {};
    const insights = {
      ...prevInsights, // preserva dna_visual, dna_visual_subgeneros, ai (genre-insights), etc.
      total_playlists_analisadas: results?.length ?? 0,
      total_tracks_analisadas: tracks?.length ?? 0,
      media_seguidores: results?.length
        ? Math.round((results.reduce((s, r) => s + (r.seguidores ?? 0), 0) / results.length))
        : 0,
      maior_playlist: playlists_dominantes[0] ?? null,
      diversidade_tracks: trackMap.size,
      subgeneros,
      ai_classification: ai_meta,
    };

    const payload = {
      genre_id: body.genre_id,
      palavras_chave,
      padroes_nome,
      playlists_dominantes,
      musicas_recorrentes,
      insights,
      ultima_analise: new Date().toISOString(),
    };

    if (existing) {
      await supabase.from("genre_models").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("genre_models").insert(payload);
    }

    // ============ HISTÓRICO ============
    // 1. Buscar última versão do gênero
    const { data: lastVersion } = await supabase
      .from("genre_models_history")
      .select("version,palavras_chave,musicas_recorrentes,playlists_dominantes")
      .eq("genre_id", body.genre_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = (lastVersion?.version ?? 0) + 1;

    // 2. Calcular diffs vs versão anterior
    const diff_keywords: any = { added: [], removed: [] };
    const diff_tracks: any = { added: [], removed: [] };
    const diff_playlists: any = { added: [], removed: [] };

    if (lastVersion) {
      const prevKw = new Set(((lastVersion.palavras_chave as any[]) ?? []).map((k: any) => k.value));
      const newKw = new Set(palavras_chave.map(k => k.value));
      diff_keywords.added = [...newKw].filter(k => !prevKw.has(k));
      diff_keywords.removed = [...prevKw].filter(k => !newKw.has(k));

      const trackKey2 = (t: any) => `${(t.nome ?? "").toLowerCase()}||${(t.artista ?? "").toLowerCase()}`;
      const prevTr = new Set(((lastVersion.musicas_recorrentes as any[]) ?? []).map(trackKey2));
      const newTr = new Set(musicas_recorrentes.map(trackKey2));
      diff_tracks.added = [...newTr].filter(k => !prevTr.has(k));
      diff_tracks.removed = [...prevTr].filter(k => !newTr.has(k));

      const prevPl = new Set(((lastVersion.playlists_dominantes as any[]) ?? []).map((p: any) => p.url));
      const newPl = new Set(playlists_dominantes.map(p => p.url));
      diff_playlists.added = [...newPl].filter(k => !prevPl.has(k));
      diff_playlists.removed = [...prevPl].filter(k => !newPl.has(k));
    }

    // 3. Métricas
    const totalPlaylistsCount = results?.length ?? 0;
      const enrichedCount = (results ?? []).filter(r => r.followers_source === "spotify_api" && r.followers_verified_at && (r.seguidores ?? 0) >= 0).length;
    const coverage = totalPlaylistsCount > 0 ? (enrichedCount / totalPlaylistsCount) * 100 : 0;

    // 4. Inserir snapshot no histórico
    await supabase.from("genre_models_history").insert({
      genre_id: body.genre_id,
      version: nextVersion,
      palavras_chave,
      padroes_nome,
      playlists_dominantes,
      musicas_recorrentes,
      insights,
      ai_summary: null,
      ai_insights: null,
      ai_suggestions: null,
      total_playlists: totalPlaylistsCount,
      total_enriched: enrichedCount,
      coverage_percent: Math.round(coverage * 100) / 100,
      diff_keywords,
      diff_tracks,
      diff_playlists,
    });
    // ============ /HISTÓRICO ============

    await supabase.from("genres").update({ status: "analisado" }).eq("id", body.genre_id);

    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      acao: "analyze-genre",
      status: "sucesso",
      mensagem: `Modelo gerado: ${palavras_chave.length} palavras-chave (${mergedKeywordsCount} typos mesclados), ${musicas_recorrentes.length} músicas recorrentes`,
      duracao_ms: Date.now() - start,
    });

    return new Response(JSON.stringify({ ok: true, insights }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("analyze-genre error", msg);
    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      acao: "analyze-genre",
      status: "erro",
      mensagem: msg.slice(0, 500),
      duracao_ms: Date.now() - start,
    });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
