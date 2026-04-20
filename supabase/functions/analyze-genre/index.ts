// analyze-genre — analisa search_results + search_tracks de um gênero e gera modelo de inteligência
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

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

function topN<T extends string>(arr: T[], n: number): { value: T; count: number }[] {
  const map = new Map<T, number>();
  for (const v of arr) map.set(v, (map.get(v) ?? 0) + 1);
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
    const [{ data: genre }, { data: results }, { data: tracks }] = await Promise.all([
      supabase.from("genres").select("id,nome").eq("id", body.genre_id).single(),
      supabase.from("search_results").select("nome_playlist,seguidores,spotify_url,imagem_url,descricao,total_musicas").eq("genre_id", body.genre_id).limit(2000),
      supabase.from("search_tracks").select("nome_musica,artista").eq("genre_id", body.genre_id).limit(10000),
    ]);

    if (!genre) throw new Error("Gênero não encontrado");

    const playlistNames = (results ?? []).map(r => r.nome_playlist).filter(Boolean) as string[];
    const allTokens = playlistNames.flatMap(tokenize);
    const palavras_chave = topN(allTokens, 30);

    // Padrões de nome: bigramas
    const bigrams: string[] = [];
    for (const name of playlistNames) {
      const t = tokenize(name);
      for (let i = 0; i < t.length - 1; i++) bigrams.push(`${t[i]} ${t[i+1]}`);
    }
    const padroes_nome = topN(bigrams, 20);

    // Playlists dominantes: rank por seguidores DESC; fallback para total_musicas; dedup por url
    const seen = new Set<string>();
    const playlists_dominantes = (results ?? [])
      .filter(r => r.spotify_url && !seen.has(r.spotify_url) && (seen.add(r.spotify_url), true))
      .sort((a, b) => {
        const af = a.seguidores ?? -1;
        const bf = b.seguidores ?? -1;
        if (af !== bf) return bf - af; // followers DESC
        return (b.total_musicas ?? 0) - (a.total_musicas ?? 0); // fallback
      })
      .slice(0, 25)
      .map(r => ({
        nome: r.nome_playlist,
        seguidores: r.seguidores ?? 0,
        url: r.spotify_url,
        imagem: r.imagem_url,
        total_musicas: r.total_musicas,
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

    const insights = {
      total_playlists_analisadas: results?.length ?? 0,
      total_tracks_analisadas: tracks?.length ?? 0,
      media_seguidores: results?.length
        ? Math.round((results.reduce((s, r) => s + (r.seguidores ?? 0), 0) / results.length))
        : 0,
      maior_playlist: playlists_dominantes[0] ?? null,
      diversidade_tracks: trackMap.size,
    };

    // Upsert genre_models
    const { data: existing } = await supabase
      .from("genre_models")
      .select("id")
      .eq("genre_id", body.genre_id)
      .maybeSingle();

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

    await supabase.from("genres").update({ status: "analisado" }).eq("id", body.genre_id);

    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      acao: "analyze-genre",
      status: "sucesso",
      mensagem: `Modelo gerado: ${palavras_chave.length} palavras-chave, ${musicas_recorrentes.length} músicas recorrentes`,
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
