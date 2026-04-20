// cluster-playlists — agrupa playlists de um gênero em subgrupos por similaridade de nome + termo
// Retorna clusters estáveis (mesma entrada → mesma saída) sem alterar schema.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MIN_CLUSTER_SIZE = 3;
const MAX_CLUSTERS = 6;

const STOPWORDS = new Set([
  "a","o","as","os","um","uma","de","da","do","das","dos","e","em","no","na","nos","nas",
  "para","por","com","sem","que","se","sua","seu","mais","melhor","melhores","the","of","and",
  "to","in","on","for","with","best","top","mix","playlist","playlists","música","musicas",
  "músicas","musica","hits","hit","new","novo","nova","novos","novas","2024","2025","2026",
]);

function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

function j(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let body: { genre_id: string };
  try { body = await req.json(); } catch { return j({ error: "Invalid JSON" }, 400); }
  if (!body.genre_id) return j({ error: "genre_id obrigatório" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { data: genre } = await supabase
      .from("genres").select("id,nome,slug").eq("id", body.genre_id).single();
    if (!genre) return j({ error: "Gênero não encontrado" }, 404);

    // Carrega playlists + termos
    const [{ data: results }, { data: terms }] = await Promise.all([
      supabase.from("search_results")
        .select("id,nome_playlist,seguidores,term_id,spotify_url,imagem_url")
        .eq("genre_id", body.genre_id)
        .limit(3000),
      supabase.from("search_terms")
        .select("id,termo")
        .eq("genre_id", body.genre_id),
    ]);

    const termMap = new Map<string, string>();
    for (const t of terms ?? []) termMap.set(t.id, (t.termo || "").toLowerCase());

    const playlists = (results ?? []).filter(p => p.nome_playlist);
    if (playlists.length < MIN_CLUSTER_SIZE) {
      return j({ ok: true, clusters: [], total_playlists: playlists.length, reason: "poucos dados" });
    }

    const genreTokens = new Set(tokenize(genre.nome));

    // 1. Frequência de tokens (ignorando o nome do gênero)
    const tokenFreq = new Map<string, number>();
    const playlistTokens = new Map<string, Set<string>>(); // playlist.id -> tokens
    for (const p of playlists) {
      const termo = termMap.get(p.term_id ?? "") ?? "";
      const allText = `${p.nome_playlist} ${termo}`;
      const tokens = tokenize(allText).filter(t => !genreTokens.has(t));
      const uniq = new Set(tokens);
      playlistTokens.set(p.id, uniq);
      for (const t of uniq) tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
    }

    // 2. Sementes candidatas: tokens que aparecem em ≥MIN_CLUSTER_SIZE playlists,
    // mas NÃO em mais de 70% (senão é genérico demais).
    const total = playlists.length;
    const seedCandidates = Array.from(tokenFreq.entries())
      .filter(([_, c]) => c >= MIN_CLUSTER_SIZE && c <= total * 0.7)
      .sort((a, b) => b[1] - a[1])
      .map(([token, count]) => ({ token, count }));

    // 3. Greedy: escolhe sementes que ainda cobrem playlists não atribuídas.
    const assigned = new Map<string, string>(); // playlistId -> clusterId
    const clusters: { id: string; label: string; seed: string; playlists: any[] }[] = [];

    for (const seed of seedCandidates) {
      if (clusters.length >= MAX_CLUSTERS) break;
      const members = playlists.filter(p => {
        if (assigned.has(p.id)) return false;
        return playlistTokens.get(p.id)?.has(seed.token);
      });
      if (members.length < MIN_CLUSTER_SIZE) continue;

      const cid = `c_${seed.token}`;
      for (const m of members) assigned.set(m.id, cid);
      clusters.push({
        id: cid,
        label: seed.token.charAt(0).toUpperCase() + seed.token.slice(1),
        seed: seed.token,
        playlists: members,
      });
    }

    // 4. Bucket "Outros" (não vira cluster oficial; só informativo)
    const orphans = playlists.filter(p => !assigned.has(p.id));

    // 5. Monta resposta enxuta
    const out = clusters.map(c => {
      const sorted = [...c.playlists].sort((a, b) => (b.seguidores ?? 0) - (a.seguidores ?? 0));
      return {
        id: c.id,
        label: c.label,
        seed: c.seed,
        size: c.playlists.length,
        playlist_ids: c.playlists.map(p => p.id),
        top_examples: sorted.slice(0, 3).map(p => ({
          nome: p.nome_playlist,
          seguidores: p.seguidores ?? 0,
          imagem_url: p.imagem_url,
          spotify_url: p.spotify_url,
        })),
        media_seguidores: c.playlists.length
          ? Math.round(c.playlists.reduce((s, p) => s + (p.seguidores ?? 0), 0) / c.playlists.length)
          : 0,
      };
    }).sort((a, b) => b.size - a.size);

    return j({
      ok: true,
      genre_id: body.genre_id,
      total_playlists: playlists.length,
      total_clusterizadas: playlists.length - orphans.length,
      total_orfas: orphans.length,
      clusters: out,
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("cluster-playlists error", msg);
    return j({ ok: false, error: msg }, 500);
  }
});
