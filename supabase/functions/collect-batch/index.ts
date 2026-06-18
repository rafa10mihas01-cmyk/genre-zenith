// collect-batch — processa um LOTE de gêneros sequencialmente.
// Para cada gênero: garante termos gerados, roda N termos via run-search,
// e dispara analyze-genre. Retorna resumo do lote.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  genre_ids: string[];
  terms_per_genre?: number;
  max_results?: number;
  delay_ms?: number;
  /** P2: ignora cooldown de termos no run-search (usado pelo backfill de gêneros dead). */
  force?: boolean;
  /** P0: pular enrich-playlists no fim do batch (default false = sempre enriquecer). */
  skip_enrich?: boolean;
  /** P0: limite de playlists a enriquecer por gênero neste batch. */
  enrich_limit?: number;
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
  const __dep = await deprecationGate(req, "collect-batch");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
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
  // Apify: custo por chamada → sempre maximizar (default 100, mín 50).
  const maxResults = Math.max(50, body.max_results ?? 100);
  const delayMs = body.delay_ms ?? 2000;
  const force = body.force === true;
  const skipEnrich = body.skip_enrich === true;
  const enrichLimit = Math.max(5, body.enrich_limit ?? 30);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const startedAt = Date.now();

  const results: Array<{
    genre_id: string;
    nome: string;
    terms_run: number;
    playlists_saved: number;
    tracks_saved: number;
    enriched: number;
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
      results.push({ genre_id: genreId, nome: "?", terms_run: 0, playlists_saved: 0, tracks_saved: 0, enriched: 0, analyzed: false, error: "genre not found" });
      continue;
    }

    const item = { genre_id: g.id, nome: g.nome, terms_run: 0, playlists_saved: 0, tracks_saved: 0, enriched: 0, analyzed: false, recovery: false, error: undefined as string | undefined };

    try {
      // 1) Garantir termos
      if (!g.total_termos || g.total_termos === 0) {
        await callFn("generate-terms", { genre_id: g.id });
      }

      // 🆕 RECOVERY MODE — gênero esfomeado: < 50 playlists vistas em 14d.
      // Quando ativo: dobra termos consumidos no batch e prioriza termos de expansão
      // (que costumam trazer playlists de nicho/borderline). Threshold de score em
      // run-search também relaxa (60→50) automaticamente via mesma checagem.
      const RECOVERY_WINDOW_DAYS = 14;
      const RECOVERY_MIN_FRESH = 50;
      const sinceISO = new Date(Date.now() - RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { count: freshCount } = await supabase
        .from("search_results")
        .select("id", { count: "exact", head: true })
        .eq("genre_id", g.id)
        .eq("is_valid", true)
        .gte("last_seen_at", sinceISO);
      const isRecovery = (freshCount ?? 0) < RECOVERY_MIN_FRESH;
      item.recovery = isRecovery;
      const effectiveTerms = isRecovery ? Math.min(termsPerGenre * 2, 30) : termsPerGenre;

      // 2) Pegar próximos N termos pendentes — priorização inteligente:
      //    - Em modo NORMAL: tipo (prefixo > completo > variacao > contextual) primeiro
      //    - Em modo RECOVERY: variacao/contextual primeiro (termos amplos pra ampliar cobertura)
      //    Demais critérios:
      //    b) total_resultados ASC NULLS FIRST → termos nunca rodados primeiro
      //    c) ultima_execucao ASC NULLS FIRST → mais antigos antes (revalida termos parados)
      //    d) created_at ASC → tiebreak determinístico
      const termsQuery = supabase
        .from("search_terms")
        .select("id, termo, tipo, total_resultados, ultima_execucao")
        .eq("genre_id", g.id)
        .eq("executado", false)
        .order("tipo", { ascending: !isRecovery }) // recovery: desc (variacao/contextual antes)
        .order("total_resultados", { ascending: true, nullsFirst: true })
        .order("ultima_execucao", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: true })
        .limit(effectiveTerms);
      const { data: terms, error: tErr } = await termsQuery;

      if (tErr) throw tErr;

      // 3) Rodar cada termo via run-search
      for (let i = 0; i < (terms ?? []).length; i++) {
        const t = terms![i];
        const r = await callFn("run-search", {
          genre_id: g.id,
          term_id: t.id,
          search_term: t.termo,
          max_results: maxResults,
          recovery: isRecovery, // 🆕 propaga modo
          force,                // 🆕 P2: ignora cooldown quando backfill manda
        });
        if (r.ok && r.data?.ok) {
          item.terms_run++;
          item.playlists_saved += r.data.savedResults ?? 0;
          item.tracks_saved += r.data.savedTracks ?? 0;
        }
        if (i < terms!.length - 1) await new Promise((res) => setTimeout(res, delayMs));
      }

      // FASE 6.A.3 — chamada para enrich-playlists removida.
      // Enriquecimento agora é responsabilidade do spotify-enrichment-worker
      // via fila spotify_enrichment_queue (alimentada por sync-managed-playlist-tracks
      // e helpers em _shared/spotify-cache.ts). analyze-genre roda direto sobre
      // o que já está cacheado/persistido — sem hop síncrono morto.
      item.enriched = 0;


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
      mensagem: `${item.nome}: ${item.terms_run} termos, ${item.playlists_saved} playlists, ${item.tracks_saved} tracks, ${item.enriched} enriched${item.analyzed ? " (analisado)" : ""}${item.recovery ? " 🆘 [recovery]" : ""}${force ? " [force]" : ""}`,
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
    total_enriched: results.reduce((s, r) => s + (r.enriched ?? 0), 0),
    errors: results.filter((r) => r.error).length,
    results,
  };

  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
