// cleanup-brain — limpeza automatizada do dataset do cérebro.
// Roda via cron a cada 6h e ao final de cada brain-run.
// Remove: tracks órfãs, playlists sem ID, baixa qualidade, blacklist forte (funk).
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Blacklist forte por slug de gênero (mesma do run-search)
const STRONG_BLACKLIST_BY_GENRE: Record<string, string[]> = {
  funk: [
    "phonk", "boogie", "oldies", "chicano", "anime",
    "meow", "pocoyo", "bruno mars", "uptown funk",
  ],
};

interface CleanupResult {
  orphan_tracks: number;
  orphan_playlists: number;
  low_quality: number;
  blacklisted: number;
  low_quality_24h: number;
  invalidated: number;
  total: number;
  duration_ms: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  const start = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Trigger opcional para auditoria (cron | brain-run | manual)
  let trigger: string = "manual";
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.trigger) trigger = String(body.trigger).slice(0, 32);
  } catch (_) { /* sem body, segue manual */ }

  const result: CleanupResult = {
    orphan_tracks: 0,
    orphan_playlists: 0,
    low_quality: 0,
    blacklisted: 0,
    low_quality_24h: 0,
    invalidated: 0,
    total: 0,
    duration_ms: 0,
  };
  const errors: string[] = [];

  // Snapshot do tamanho do dataset ANTES da limpeza (pra calcular % afetada)
  let totalBefore = 0;
  try {
    const [{ count: pl }, { count: tr }] = await Promise.all([
      supabase.from("search_results").select("*", { count: "exact", head: true }),
      supabase.from("search_tracks").select("*", { count: "exact", head: true }),
    ]);
    totalBefore = (pl ?? 0) + (tr ?? 0);
  } catch (_) { /* segue, threshold cai pra 0 */ }

  try {
    // 1) Tracks órfãs: result_id NULL ou aponta para playlist deletada.
    //    Estratégia: pega ids de tracks com result_id que NÃO existe em search_results.
    {
      const { data: validIds } = await supabase.from("search_results").select("id");
      const validSet = new Set((validIds ?? []).map((r: any) => r.id));
      // Pagina pelas tracks pra evitar carregar tudo
      let from = 0;
      const PAGE = 1000;
      const orphanIds: string[] = [];
      // limita a varredura a 100k tracks (proteção)
      while (from < 100_000) {
        const { data: page, error } = await supabase
          .from("search_tracks")
          .select("id, result_id")
          .range(from, from + PAGE - 1);
        if (error) { errors.push(`tracks-scan: ${error.message}`); break; }
        if (!page || page.length === 0) break;
        for (const t of page) {
          if (!t.result_id || !validSet.has(t.result_id)) orphanIds.push(t.id);
        }
        if (page.length < PAGE) break;
        from += PAGE;
      }
      // delete em chunks
      for (let i = 0; i < orphanIds.length; i += 500) {
        const chunk = orphanIds.slice(i, i + 500);
        const { error } = await supabase.from("search_tracks").delete().in("id", chunk);
        if (error) { errors.push(`tracks-del: ${error.message}`); break; }
        result.orphan_tracks += chunk.length;
      }
    }

    // 2) Playlists sem spotify_playlist_id (não dedupáveis, lixo do scraper)
    {
      const { data: rows, error } = await supabase
        .from("search_results")
        .select("id")
        .is("spotify_playlist_id", null);
      if (error) { errors.push(`orphan-pl-scan: ${error.message}`); }
      else if (rows && rows.length > 0) {
        const ids = rows.map((r: any) => r.id);
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          const { error: dErr } = await supabase.from("search_results").delete().in("id", chunk);
          if (dErr) { errors.push(`orphan-pl-del: ${dErr.message}`); break; }
          result.orphan_playlists += chunk.length;
        }
      }
    }

    // 3) Baixa qualidade: sem seguidores E < 30 faixas
    {
      const { data: rows, error } = await supabase
        .from("search_results")
        .select("id, total_musicas")
        .is("seguidores", null);
      if (error) { errors.push(`lowq-scan: ${error.message}`); }
      else if (rows && rows.length > 0) {
        const ids = rows
          .filter((r: any) => (r.total_musicas ?? 0) < 30)
          .map((r: any) => r.id);
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          const { error: dErr } = await supabase.from("search_results").delete().in("id", chunk);
          if (dErr) { errors.push(`lowq-del: ${dErr.message}`); break; }
          result.low_quality += chunk.length;
        }
      }
    }

    // 4) Blacklist forte por gênero (escopo: funk hoje; estende-se via map)
    {
      const { data: genres, error: gErr } = await supabase
        .from("genres")
        .select("id, slug, nome");
      if (gErr) { errors.push(`genres-scan: ${gErr.message}`); }
      else {
        for (const g of genres ?? []) {
          const slugKey = (g.slug ?? "").toLowerCase() || (g.nome ?? "").toLowerCase();
          const terms = STRONG_BLACKLIST_BY_GENRE[slugKey];
          if (!terms || terms.length === 0) continue;
          // Constrói padrão SIMILAR TO sem tocar SQL cru: usa ilike por termo
          const ids = new Set<string>();
          for (const term of terms) {
            const { data: hits, error: hErr } = await supabase
              .from("search_results")
              .select("id")
              .eq("genre_id", g.id)
              .ilike("nome_playlist", `%${term}%`);
            if (hErr) { errors.push(`bl-scan(${term}): ${hErr.message}`); continue; }
            for (const h of hits ?? []) ids.add(h.id);
          }
          const list = [...ids];
          for (let i = 0; i < list.length; i += 500) {
            const chunk = list.slice(i, i + 500);
            const { error: dErr } = await supabase.from("search_results").delete().in("id", chunk);
            if (dErr) { errors.push(`bl-del: ${dErr.message}`); break; }
            result.blacklisted += chunk.length;
          }
        }
      }
    }

    // 4.5) AUTO-PRUNE: playlists flagged como low_quality há mais de 24h
    {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: rows, error } = await supabase
        .from("search_results")
        .select("id")
        .eq("quality_flag", "low_quality")
        .lt("quality_flagged_at", cutoff);
      if (error) { errors.push(`lowq24h-scan: ${error.message}`); }
      else if (rows && rows.length > 0) {
        const ids = rows.map((r: any) => r.id);
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          const { error: dErr } = await supabase.from("search_results").delete().in("id", chunk);
          if (dErr) { errors.push(`lowq24h-del: ${dErr.message}`); break; }
          result.low_quality_24h += chunk.length;
        }
      }
    }

    // 4.7) PURGE: playlists marcadas is_valid=false pelo scoring estrito (run-search/revalidate-dataset)
    {
      const { data: rows, error } = await supabase
        .from("search_results")
        .select("id")
        .eq("is_valid", false);
      if (error) { errors.push(`invalid-scan: ${error.message}`); }
      else if (rows && rows.length > 0) {
        const ids = rows.map((r: any) => r.id);
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          const { error: dErr } = await supabase.from("search_results").delete().in("id", chunk);
          if (dErr) { errors.push(`invalid-del: ${dErr.message}`); break; }
          result.invalidated += chunk.length;
        }
      }
    }

    // 5) Re-roda passo 1 (tracks que ficaram órfãs após deletar playlists nos passos 2-4)
    {
      const { data: validIds } = await supabase.from("search_results").select("id");
      const validSet = new Set((validIds ?? []).map((r: any) => r.id));
      const orphanIds: string[] = [];
      let from = 0;
      const PAGE = 1000;
      while (from < 100_000) {
        const { data: page, error } = await supabase
          .from("search_tracks")
          .select("id, result_id")
          .range(from, from + PAGE - 1);
        if (error || !page || page.length === 0) break;
        for (const t of page) {
          if (!t.result_id || !validSet.has(t.result_id)) orphanIds.push(t.id);
        }
        if (page.length < PAGE) break;
        from += PAGE;
      }
      for (let i = 0; i < orphanIds.length; i += 500) {
        const chunk = orphanIds.slice(i, i + 500);
        const { error } = await supabase.from("search_tracks").delete().in("id", chunk);
        if (error) { errors.push(`tracks-del2: ${error.message}`); break; }
        result.orphan_tracks += chunk.length;
      }
    }

    result.total = result.orphan_tracks + result.orphan_playlists + result.low_quality + result.blacklisted + result.low_quality_24h + result.invalidated;
    result.duration_ms = Date.now() - start;

    // ============ RE-ANÁLISE AUTOMÁTICA ============
    // Dispara analyze-genre → genre-insights → analyze-genre-visual-dna
    // Critério: trigger=brain-run (sempre) OU >10% das linhas afetadas pela limpeza.
    const affectedPct = totalBefore > 0 ? (result.total / totalBefore) * 100 : 0;
    const shouldReanalyze = trigger === "brain-run" || affectedPct >= 10;
    let reanalyzeInfo = "";

    if (shouldReanalyze && result.total > 0) {
      const { data: activeGenres } = await supabase
        .from("genres")
        .select("id, nome")
        .eq("ativo", true);

      const genres = activeGenres ?? [];
      reanalyzeInfo = ` | reanalyze: ${genres.length} gêneros (afetado=${affectedPct.toFixed(1)}%)`;

      // Fire-and-forget: encadeia analyze → insights → visual-dna por gênero, sem await.
      for (const g of genres) {
        const headers = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        };
        (async () => {
          try {
            await fetch(`${SUPABASE_URL}/functions/v1/analyze-genre`, {
              method: "POST", headers, body: JSON.stringify({ genre_id: g.id }),
            });
            await fetch(`${SUPABASE_URL}/functions/v1/genre-insights`, {
              method: "POST", headers, body: JSON.stringify({ genre_id: g.id }),
            });
            await fetch(`${SUPABASE_URL}/functions/v1/analyze-genre-visual-dna`, {
              method: "POST", headers, body: JSON.stringify({ genre_id: g.id }),
            });
            // Audit final: roda DEPOIS do modelo reconstruído pra avaliar saúde do dataset
            await fetch(`${SUPABASE_URL}/functions/v1/audit-brain`, {
              method: "POST", headers, body: JSON.stringify({ genre_id: g.id, trigger }),
            });
          } catch (e) {
            console.error(`reanalyze+audit hook failed for ${g.nome}:`, (e as Error).message);
          }
        })();
      }
    } else {
      reanalyzeInfo = ` | reanalyze: skipped (afetado=${affectedPct.toFixed(1)}%)`;
    }

    const status = errors.length > 0 ? "parcial" : "sucesso";
    const mensagem =
      `cleanup-brain (${trigger}) | ` +
      `tracks_órfãs: ${result.orphan_tracks} | ` +
      `playlists_sem_id: ${result.orphan_playlists} | ` +
      `baixa_qualidade: ${result.low_quality} | ` +
      `blacklist: ${result.blacklisted} | ` +
      `low_quality_24h: ${result.low_quality_24h} | ` +
      `invalidated: ${result.invalidated} | ` +
      `TOTAL: ${result.total}` +
      reanalyzeInfo +
      (errors.length > 0 ? ` | erros: ${errors.slice(0, 3).join("; ")}` : "");

    await supabase.from("collection_logs").insert({
      acao: "cleanup-brain",
      status,
      mensagem: mensagem.slice(0, 4000),
      duracao_ms: result.duration_ms,
    });

    await reportCronHealth(supabase, {
      job_name: "cleanup-brain",
      status: errors.length === 0 ? "ok" : "partial",
      startedAt: start,
      metrics: { trigger, total: result.total, orphan_tracks: result.orphan_tracks, blacklisted: result.blacklisted, invalidated: result.invalidated },
    });

    return j({
      ok: true,
      trigger,
      ...result,
      affected_pct: Number(affectedPct.toFixed(2)),
      reanalyze_triggered: shouldReanalyze && result.total > 0,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("cleanup-brain error", msg);
    await supabase.from("collection_logs").insert({
      acao: "cleanup-brain",
      status: "erro",
      mensagem: `cleanup-brain (${trigger}) FALHOU: ${msg}`.slice(0, 4000),
      duracao_ms: Date.now() - start,
    });
    await reportCronHealth(supabase, {
      job_name: "cleanup-brain",
      status: "error",
      startedAt: start,
      message: msg,
    });
    return j({ ok: false, error: msg }, 500);
  }
});

function j(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
