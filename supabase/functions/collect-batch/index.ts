// collect-batch — processa um LOTE de gêneros sequencialmente.
// Para cada gênero: garante termos gerados, roda N termos via run-search,
// e dispara analyze-genre. Retorna resumo do lote.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  genre_ids: string[];
  terms_per_genre?: number;
  max_results?: number;
  delay_ms?: number;
}

async function callFn(name: string, body: unknown) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }
  return { ok: r.ok, status: r.status, data, raw: text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ids = Array.isArray(body.genre_ids) ? body.genre_ids : [];
  if (ids.length === 0) {
    return new Response(JSON.stringify({ error: "genre_ids vazio" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const termsPerGenre = body.terms_per_genre ?? 10;
  const maxResults = body.max_results ?? 25;
  const delayMs = body.delay_ms ?? 2000;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const startedAt = Date.now();

  const results: Array<{
    genre_id: string;
    nome: string;
    terms_run: number;
    playlists_saved: number;
    tracks_saved: number;
    analyzed: boolean;
    error?: string;
  }> = [];

  for (const genreId of ids) {
    const gStart = Date.now();
    const { data: g } = await supabase
      .from("genres")
      .select("id,nome,total_termos")
      .eq("id", genreId)
      .single();

    if (!g) {
      results.push({ genre_id: genreId, nome: "?", terms_run: 0, playlists_saved: 0, tracks_saved: 0, analyzed: false, error: "genre not found" });
      continue;
    }

    const item = { genre_id: g.id, nome: g.nome, terms_run: 0, playlists_saved: 0, tracks_saved: 0, analyzed: false, error: undefined as string | undefined };

    try {
      // 1) Garantir termos
      if (!g.total_termos || g.total_termos === 0) {
        await callFn("generate-terms", { genre_id: g.id });
      }

      // 2) Pegar próximos N termos pendentes (prefixo → completo → variacao → contextual)
      const { data: terms, error: tErr } = await supabase
        .from("search_terms")
        .select("id, termo, tipo")
        .eq("genre_id", g.id)
        .eq("executado", false)
        .order("tipo", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(termsPerGenre);

      if (tErr) throw tErr;

      // 3) Rodar cada termo via run-search
      for (let i = 0; i < (terms ?? []).length; i++) {
        const t = terms![i];
        const r = await callFn("run-search", {
          genre_id: g.id,
          term_id: t.id,
          search_term: t.termo,
          max_results: maxResults,
        });
        if (r.ok && r.data?.ok) {
          item.terms_run++;
          item.playlists_saved += r.data.savedResults ?? 0;
          item.tracks_saved += r.data.savedTracks ?? 0;
        }
        if (i < terms!.length - 1) await new Promise((res) => setTimeout(res, delayMs));
      }

      // 4) Analyze-genre automático
      const a = await callFn("analyze-genre", { genre_id: g.id });
      item.analyzed = a.ok;

      // 5) Marcar status
      await supabase.from("genres").update({ status: "analisado" }).eq("id", g.id);
    } catch (e) {
      item.error = (e as Error).message;
      await supabase.from("collection_logs").insert({
        genre_id: g.id,
        acao: "collect-batch",
        status: "erro",
        mensagem: `Erro no lote: ${item.error}`.slice(0, 500),
        duracao_ms: Date.now() - gStart,
      });
    }

    await supabase.from("collection_logs").insert({
      genre_id: g.id,
      acao: "collect-batch",
      status: item.error ? "erro" : "sucesso",
      mensagem: `${item.nome}: ${item.terms_run} termos, ${item.playlists_saved} playlists, ${item.tracks_saved} tracks${item.analyzed ? " (analisado)" : ""}`,
      duracao_ms: Date.now() - gStart,
    });

    results.push(item);
  }

  const summary = {
    ok: true,
    duration_ms: Date.now() - startedAt,
    genres_processed: results.length,
    total_terms_run: results.reduce((s, r) => s + r.terms_run, 0),
    total_playlists: results.reduce((s, r) => s + r.playlists_saved, 0),
    total_tracks: results.reduce((s, r) => s + r.tracks_saved, 0),
    errors: results.filter((r) => r.error).length,
    results,
  };

  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
