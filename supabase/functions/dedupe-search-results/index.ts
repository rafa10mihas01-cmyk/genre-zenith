// dedupe-search-results — Onda 1
// Marca duplicatas em search_results por:
//   1. mesmo spotify_playlist_id em gêneros diferentes (mantém o de maior quality_score)
//   2. mesmo (genre_id, owner_id, nome_normalizado)
// O canônico recebe canonical_playlist_id = id próprio.
// Os demais recebem duplicate_of = canonical e is_valid=false.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Row = {
  id: string;
  genre_id: string | null;
  spotify_playlist_id: string | null;
  owner_id: string | null;
  nome_normalizado: string | null;
  quality_score: number | null;
  seguidores: number | null;
  enriched_at: string | null;
};

function pickCanonical(rows: Row[]): Row {
  // maior quality_score, depois maior followers, depois mais recente
  return [...rows].sort((a, b) => {
    const qa = Number(a.quality_score ?? 0), qb = Number(b.quality_score ?? 0);
    if (qa !== qb) return qb - qa;
    const fa = a.seguidores ?? 0, fb = b.seguidores ?? 0;
    if (fa !== fb) return fb - fa;
    const ea = a.enriched_at ? new Date(a.enriched_at).getTime() : 0;
    const eb = b.enriched_at ? new Date(b.enriched_at).getTime() : 0;
    return eb - ea;
  })[0];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const genreFilter: string | undefined = body?.genre_id;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Reset suave: limpa marcações antigas só do escopo selecionado
    let resetQ = supabase
      .from("search_results")
      .update({ duplicate_of: null, canonical_playlist_id: null });
    if (genreFilter) resetQ = resetQ.eq("genre_id", genreFilter);
    else resetQ = resetQ.not("id", "is", null);
    await resetQ.not("duplicate_of", "is", null);

    let q = supabase
      .from("search_results")
      .select("id,genre_id,spotify_playlist_id,owner_id,nome_normalizado,quality_score,seguidores,enriched_at")
      .not("spotify_playlist_id", "is", null);
    if (genreFilter) q = q.eq("genre_id", genreFilter);
    const { data: rows, error } = await q.limit(50000);
    if (error) throw error;

    const groupsById = new Map<string, Row[]>();
    const groupsByOwnerName = new Map<string, Row[]>();
    for (const r of (rows ?? []) as Row[]) {
      if (r.spotify_playlist_id) {
        const k = `pid:${r.spotify_playlist_id}`;
        if (!groupsById.has(k)) groupsById.set(k, []);
        groupsById.get(k)!.push(r);
      }
      if (r.owner_id && r.nome_normalizado && r.nome_normalizado.length >= 3) {
        const k = `own:${r.genre_id}|${r.owner_id}|${r.nome_normalizado}`;
        if (!groupsByOwnerName.has(k)) groupsByOwnerName.set(k, []);
        groupsByOwnerName.get(k)!.push(r);
      }
    }

    const decided = new Set<string>();
    const updates: { id: string; canonical: string; duplicate_of: string | null }[] = [];

    // Processa cada grupo: define canonical + duplicados
    function processGroup(group: Row[]) {
      if (group.length === 0) return;
      const canon = pickCanonical(group);
      for (const r of group) {
        if (decided.has(r.id)) continue;
        decided.add(r.id);
        if (r.id === canon.id) {
          updates.push({ id: r.id, canonical: canon.id, duplicate_of: null });
        } else {
          updates.push({ id: r.id, canonical: canon.id, duplicate_of: canon.id });
        }
      }
    }

    for (const g of groupsById.values()) if (g.length > 1) processGroup(g);
    for (const g of groupsByOwnerName.values()) if (g.length > 1) processGroup(g);

    // Aplica updates em chunks
    let duplicatesMarked = 0;
    let canonicalsMarked = 0;
    const chunkSize = 200;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const slice = updates.slice(i, i + chunkSize);
      await Promise.all(slice.map(async (u) => {
        const patch: Record<string, unknown> = {
          canonical_playlist_id: u.canonical,
          duplicate_of: u.duplicate_of,
        };
        if (u.duplicate_of) {
          patch.is_valid = false;
          patch.validation_reason = "duplicate";
          duplicatesMarked++;
        } else {
          canonicalsMarked++;
        }
        await supabase.from("search_results").update(patch).eq("id", u.id);
      }));
    }

    return jr({
      ok: true,
      scanned: rows?.length ?? 0,
      groups_by_id: Array.from(groupsById.values()).filter(g => g.length > 1).length,
      groups_by_owner_name: Array.from(groupsByOwnerName.values()).filter(g => g.length > 1).length,
      duplicates_marked: duplicatesMarked,
      canonicals_marked: canonicalsMarked,
    });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
