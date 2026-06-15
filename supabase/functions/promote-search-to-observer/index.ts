// promote-search-to-observer
// Promove playlists qualificadas de search_results para observed_playlists.
//
// Regras:
//   - is_valid = true
//   - quality_score >= 60
//   - seguidores >= 1000
//   - quality_flag IS NULL
//   - owner_type != 'editorial' (Spotify oficial)
//   - spotify_playlist_id NÃO existe em observed_playlists
//
// Dedup: melhor candidato por spotify_playlist_id (winner_score desc, fallback quality_score desc).
// Hard cap por execução: 200.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const MIN_QUALITY = 60;
const MIN_FOLLOWERS = 1000;
const MAX_PROMOTE = 200;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let dryRun = false;
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    dryRun = Boolean(body?.dry_run);
  } catch (_) { /* ignore */ }

  const startedAt = new Date().toISOString();

  // 1) Coletar candidatos elegíveis
  // Paginação simples até 5000 candidatos brutos (filtros já bem restritivos)
  const candidates: any[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const { data, error } = await supabase
      .from("search_results")
      .select("spotify_playlist_id, nome_playlist, seguidores, imagem_url, owner_id, owner_type, quality_score, winner_score, term_id, is_valid, quality_flag")
      .eq("is_valid", true)
      .is("quality_flag", null)
      .gte("quality_score", MIN_QUALITY)
      .gte("seguidores", MIN_FOLLOWERS)
      .not("spotify_playlist_id", "is", null)
      .neq("owner_type", "editorial")
      .order("winner_score", { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSize - 1);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!data || data.length === 0) break;
    candidates.push(...data);
    if (data.length < pageSize) break;
  }

  const analyzed = candidates.length;

  // 2) Dedup por spotify_playlist_id (mantém melhor winner_score / quality_score)
  const bestById = new Map<string, any>();
  for (const c of candidates) {
    const id = c.spotify_playlist_id;
    if (!id) continue;
    const prev = bestById.get(id);
    if (!prev) { bestById.set(id, c); continue; }
    const a = Number(c.winner_score ?? 0) * 1000 + Number(c.quality_score ?? 0);
    const b = Number(prev.winner_score ?? 0) * 1000 + Number(prev.quality_score ?? 0);
    if (a > b) bestById.set(id, c);
  }
  const eligible = [...bestById.values()];

  // 3) Remover os que já existem em observed_playlists
  const ids = eligible.map(e => e.spotify_playlist_id);
  const existingSet = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data: existing, error } = await supabase
      .from("observed_playlists")
      .select("spotify_playlist_id")
      .in("spotify_playlist_id", chunk);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    existing?.forEach(r => existingSet.add(r.spotify_playlist_id));
  }

  let toPromote = eligible.filter(e => !existingSet.has(e.spotify_playlist_id));

  // Ordenar por winner_score desc (com fallback) e cortar
  toPromote.sort((a, b) => (Number(b.winner_score ?? 0) - Number(a.winner_score ?? 0)) || (Number(b.quality_score ?? 0) - Number(a.quality_score ?? 0)));
  const discardedDuplicate = eligible.length - toPromote.length;
  if (toPromote.length > MAX_PROMOTE) toPromote = toPromote.slice(0, MAX_PROMOTE);

  // 4) Buscar termos para enriquecer resposta
  const termIds = [...new Set(toPromote.map(t => t.term_id).filter(Boolean))];
  const termMap = new Map<string, string>();
  if (termIds.length) {
    const { data: terms } = await supabase
      .from("search_terms")
      .select("id, termo")
      .in("id", termIds);
    terms?.forEach(t => termMap.set(t.id, t.termo));
  }

  // 5) Inserção
  let promoted = 0;
  if (!dryRun && toPromote.length > 0) {
    const rows = toPromote.map(t => ({
      spotify_playlist_id: t.spotify_playlist_id,
      playlist_name: t.nome_playlist,
      spotify_owner_id: t.owner_id,
      owner_type: t.owner_type,
      followers: t.seguidores,
      image_url: t.imagem_url,
      first_observed_at: startedAt,
      last_observed_at: startedAt,
      observation_count: 1,
      total_plays_observed: 0,
      enrichment_status: "pending",
      notes: `auto:promote-search-to-observer@${startedAt}`,
    }));
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error, count } = await supabase
        .from("observed_playlists")
        .upsert(chunk, { onConflict: "spotify_playlist_id", ignoreDuplicates: true, count: "exact" });
      if (error) {
        return new Response(JSON.stringify({ error: error.message, partial_promoted: promoted }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      promoted += count ?? chunk.length;
    }
  }

  const sample = toPromote.slice(0, 20).map(t => ({
    nome: t.nome_playlist,
    spotify_playlist_id: t.spotify_playlist_id,
    seguidores: t.seguidores,
    quality_score: Number(t.quality_score ?? 0),
    winner_score: Number(t.winner_score ?? 0),
    search_term: termMap.get(t.term_id) ?? null,
  }));

  return new Response(JSON.stringify({
    started_at: startedAt,
    dry_run: dryRun,
    analyzed,
    eligible_unique: eligible.length,
    already_in_observer: existingSet.size,
    discarded_already_observed: discardedDuplicate,
    to_promote: toPromote.length,
    promoted,
    sample_top_20: sample,
  }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
