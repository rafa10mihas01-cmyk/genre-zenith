// revalidate-dataset — recomputa score, quality_score, is_valid, validation_reason
// para TODAS as linhas existentes em search_results (UPDATE in-place).
// Espelha exatamente a lógica de scoring atual de run-search.
//
// Uso:
//   POST { genre_id?: string, dry_run?: boolean }
//   - sem genre_id: processa todos os gêneros
//   - dry_run=true: não escreve, só retorna o que mudaria
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DEFAULT_BLACKLIST = [
  "workout","gym","treino","academia","sleep","study","focus","lofi",
  "edm","techno","house","trance","rock","metal","jazz","classical",
];

const STRONG_BLACKLIST_BY_GENRE: Record<string, string[]> = {
  funk: [
    "phonk","kordhell","eternxlkz","boogie","disco","oldies","chicano",
    "bruno mars","uptown funk","pocoyo","meow","anime","jjk","yuji","edit anime",
  ],
};

const BR_BOOST_BY_GENRE: Record<string, string[]> = {
  funk: ["brasil","br","bailão","bailao","mandelão","mandelao","automotivo","tropa","dj","mtg"],
};

const EXPANSION_MARKERS = ["remix","viral","cover","tiktok","tik tok","edit","phonk","2026","2025","mashup"];

const SCORE_THRESHOLD_STRICT = 60;
const SCORE_THRESHOLD_EXPANSION = 50;
const EXPANSION_BONUS = 10;
const FOLLOWERS_THRESHOLD = 5000;

function wordHit(hay: string, term: string) {
  return new RegExp(
    `(^|[^a-záéíóúâêôãõç])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-záéíóúâêôãõç]|$)`,
    "i",
  ).test(hay);
}

function computeQualityScore(opts: {
  followers: number | null;
  totalTracks: number | null;
  descricao: string | null;
  imagem: string | null;
}): number {
  const { followers, totalTracks, descricao, imagem } = opts;
  let q = 0;
  const f = followers ?? 0;
  if (f >= 100_000) q += 50;
  else if (f >= 10_000) q += 40;
  else if (f >= 1_000) q += 30;
  else if (f >= 100) q += 15;
  else if (f > 0) q += 5;

  const t = totalTracks ?? 0;
  if (t >= 100) q += 30;
  else if (t >= 50) q += 20;
  else if (t >= 30) q += 12;
  else if (t >= 10) q += 5;

  if (imagem && imagem.length > 10) q += 10;
  if (descricao && descricao.trim().length >= 20) q += 10;

  return Math.min(100, Math.max(0, q));
}

interface GenreCtx {
  slug: string;
  nome: string;
  blacklist: string[];
  strongBlacklist: string[];
  brBoostTerms: string[];
  modelKeywords: string[];
  modelArtists: string[];
  subgenresList: string[];
}

async function loadGenreCtx(supabase: any, genre_id: string): Promise<GenreCtx> {
  const [{ data: genre }, { data: filt }, { data: model }] = await Promise.all([
    supabase.from("genres").select("slug,nome").eq("id", genre_id).maybeSingle(),
    supabase.from("genre_filters").select("blacklist").eq("genre_id", genre_id).maybeSingle(),
    supabase.from("genre_models").select("palavras_chave,musicas_recorrentes,insights").eq("genre_id", genre_id).maybeSingle(),
  ]);
  const slug = (genre?.slug ?? "").toLowerCase();
  const nome = (genre?.nome ?? "").toLowerCase();
  const slugOrNome = slug || nome;
  const blacklist = (filt?.blacklist as string[] | undefined)?.map((b) => b.toLowerCase()) ?? DEFAULT_BLACKLIST;

  const modelKeywords: string[] = (() => {
    const arr = model?.palavras_chave as any[] | undefined;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => (typeof x === "string" ? x : x?.value ?? x?.keyword ?? ""))
      .filter(Boolean)
      .map((s) => String(s).toLowerCase());
  })();

  const modelArtists: string[] = (() => {
    const tracks = model?.musicas_recorrentes as any[] | undefined;
    if (!Array.isArray(tracks)) return [];
    const set = new Set<string>();
    for (const t of tracks) {
      const a = typeof t === "string" ? "" : (t?.artista ?? t?.artist ?? "");
      if (a) String(a).split(/[,&]/).forEach((x) => { const v = x.trim().toLowerCase(); if (v.length > 2) set.add(v); });
    }
    return [...set];
  })();

  const subgenresList: string[] = (() => {
    const subs = (model?.insights as any)?.subgeneros;
    if (!Array.isArray(subs)) return [];
    return subs.map((s: any) => [s?.slug, s?.nome].filter(Boolean)).flat().map((x: string) => String(x).toLowerCase());
  })();

  return {
    slug,
    nome,
    blacklist,
    strongBlacklist: STRONG_BLACKLIST_BY_GENRE[slugOrNome] ?? [],
    brBoostTerms: BR_BOOST_BY_GENRE[slugOrNome] ?? [],
    modelKeywords,
    modelArtists,
    subgenresList,
  };
}

function scorePlaylist(
  ctx: GenreCtx,
  termLower: string,
  opts: { nomePl: string; descricao: string | null; followers: number | null },
) {
  const { nomePl, descricao, followers } = opts;
  const { slug, nome, blacklist, strongBlacklist, brBoostTerms, modelKeywords, modelArtists, subgenresList } = ctx;
  const nameLow = nomePl.toLowerCase();
  const descLow = (descricao ?? "").toLowerCase();
  const haystack = `${nameLow} ${descLow}`;
  let score = 0;
  const reasons: string[] = [];

  const strongHit = strongBlacklist.find((b) => b && haystack.includes(b));
  if (strongHit) {
    reasons.push(`strong_blacklist:${strongHit}`);
    return { score: -999, reasons, hardBlock: true };
  }

  const nameHasGenre = (slug && nameLow.includes(slug)) || (nome && nameLow.includes(nome));
  if (!nameHasGenre) {
    reasons.push(`no_${slug || nome || "genre"}_in_name`);
    return { score: -999, reasons, hardBlock: true };
  }

  if (nameLow.includes(termLower)) { score += 30; reasons.push("+30 name~term"); }
  else if (slug && nameLow.includes(slug)) { score += 20; reasons.push("+20 name~slug"); }
  else if (nome && nameLow.includes(nome)) { score += 20; reasons.push("+20 name~nome"); }

  if (descLow && descLow.includes(termLower)) { score += 15; reasons.push("+15 desc~term"); }

  const artistHit = modelArtists.some((a) => haystack.includes(a));
  if (artistHit) { score += 25; reasons.push("+25 artist"); }

  const kwHits = modelKeywords.filter((k) => k && haystack.includes(k)).slice(0, 3);
  if (kwHits.length > 0) { score += 20; reasons.push(`+20 kw(${kwHits.length})`); }

  const subHit = subgenresList.find((s) => s && haystack.includes(s));
  if (subHit) { score += 15; reasons.push(`+15 sub:${subHit}`); }

  if ((followers ?? 0) > FOLLOWERS_THRESHOLD) { score += 10; reasons.push("+10 followers"); }

  const brHit = brBoostTerms.find((t) => t && wordHit(haystack, t));
  if (brHit) { score += 15; reasons.push(`+15 br:${brHit}`); }

  const blHits = blacklist.filter((b) => b && haystack.includes(b));
  if (blHits.length > 0) { score -= 40; reasons.push(`-40 bl:${blHits[0]}`); }

  const containsGenreAny = (slug && haystack.includes(slug)) || (nome && haystack.includes(nome)) || haystack.includes(termLower);
  if (!containsGenreAny) { score -= 30; reasons.push("-30 genre-mismatch"); }

  return { score, reasons, hardBlock: blHits.length > 0 };
}

Deno.serve(async (req) => {
  const __dep = await deprecationGate(req, "revalidate-dataset");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  const start = Date.now();

  let body: { genre_id?: string; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const dryRun = body.dry_run === true;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Lista gêneros alvo
  const genresQ = supabase.from("genres").select("id,slug,nome");
  const { data: genres, error: gErr } = body.genre_id
    ? await genresQ.eq("id", body.genre_id)
    : await genresQ;
  if (gErr) {
    return new Response(JSON.stringify({ error: gErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const perGenre: Array<{
    genre_id: string;
    genre: string;
    total: number;
    updated: number;
    became_invalid: number;
    became_valid: number;
    flagged_low_quality: number;
    unflagged_low_quality: number;
    reason_breakdown: Record<string, number>;
    errors: string[];
  }> = [];

  let grandTotal = 0;
  let grandUpdated = 0;

  for (const g of genres ?? []) {
    const ctx = await loadGenreCtx(supabase, g.id);
    const reasonBreakdown: Record<string, number> = {};
    const errors: string[] = [];
    let total = 0, updated = 0, becameInvalid = 0, becameValid = 0, flagged = 0, unflagged = 0;

    // Mapa de term_id -> termo (para reconstituir termLower exatamente)
    const { data: terms, error: tErr } = await supabase
      .from("search_terms").select("id,termo").eq("genre_id", g.id);
    if (tErr) errors.push(`terms: ${tErr.message}`);
    const termMap = new Map<string, string>((terms ?? []).map((t: any) => [t.id, String(t.termo ?? "").toLowerCase()]));

    // Pagina search_results (limite 1000 por chamada do PostgREST)
    let from = 0;
    const PAGE = 500;
    while (true) {
      const { data: rows, error: rErr } = await supabase
        .from("search_results")
        .select("id,term_id,nome_playlist,descricao,seguidores,total_musicas,imagem_url,spotify_url,spotify_playlist_id,score,quality_score,quality_flag,is_valid,validation_reason")
        .eq("genre_id", g.id)
        .order("id")
        .range(from, from + PAGE - 1);
      if (rErr) { errors.push(`page ${from}: ${rErr.message}`); break; }
      if (!rows || rows.length === 0) break;
      total += rows.length;

      for (const r of rows) {
        const termLower = (r.term_id ? termMap.get(r.term_id) : "") ?? "";
        const { score, hardBlock } = scorePlaylist(ctx, termLower, {
          nomePl: String(r.nome_playlist ?? ""),
          descricao: r.descricao,
          followers: r.seguidores,
        });

        const isExpansionTerm = EXPANSION_MARKERS.some((m) => termLower.includes(m));
        const effectiveThreshold = isExpansionTerm
          ? SCORE_THRESHOLD_EXPANSION - EXPANSION_BONUS
          : SCORE_THRESHOLD_STRICT;

        let isValid = true;
        let validationReason: string | null = null;
        if (hardBlock) {
          isValid = false;
          validationReason = "hard_block";
        } else if (score < effectiveThreshold) {
          isValid = false;
          validationReason = `low_score:${score}<${effectiveThreshold}`;
        } else if (
          !r.spotify_playlist_id ||
          !r.spotify_url ||
          !/playlist\/[A-Za-z0-9]{16,}/.test(String(r.spotify_url))
        ) {
          isValid = false;
          validationReason = "invalid_url_or_id";
        }
        // ⚠️ low_quality_no_followers removido: avaliado em PHASE 2 pelo enrich-playlists

        const qualityScore = computeQualityScore({
          followers: r.seguidores,
          totalTracks: r.total_musicas,
          descricao: r.descricao,
          imagem: r.imagem_url,
        });
        const qualityFlag = qualityScore < 40 ? "low_quality" : null;

        const breakdownKey = isValid ? "valid" : (validationReason ?? "rejected");
        reasonBreakdown[breakdownKey] = (reasonBreakdown[breakdownKey] ?? 0) + 1;

        const changed =
          Number(r.score ?? NaN) !== score ||
          Number(r.quality_score ?? NaN) !== qualityScore ||
          (r.quality_flag ?? null) !== qualityFlag ||
          Boolean(r.is_valid) !== isValid ||
          (r.validation_reason ?? null) !== validationReason;

        if (!changed) continue;

        if (Boolean(r.is_valid) && !isValid) becameInvalid++;
        if (!r.is_valid && isValid) becameValid++;
        if ((r.quality_flag ?? null) !== "low_quality" && qualityFlag === "low_quality") flagged++;
        if ((r.quality_flag ?? null) === "low_quality" && qualityFlag !== "low_quality") unflagged++;

        if (!dryRun) {
          const { error: uErr } = await supabase
            .from("search_results")
            .update({
              score,
              is_valid: isValid,
              validation_reason: validationReason,
              quality_score: qualityScore,
              quality_flag: qualityFlag,
              quality_flagged_at: qualityFlag === "low_quality" ? new Date().toISOString() : null,
            })
            .eq("id", r.id);
          if (uErr) { errors.push(`update ${r.id}: ${uErr.message}`); continue; }
        }
        updated++;
      }

      if (rows.length < PAGE) break;
      from += PAGE;
    }

    grandTotal += total;
    grandUpdated += updated;

    perGenre.push({
      genre_id: g.id,
      genre: g.nome,
      total,
      updated,
      became_invalid: becameInvalid,
      became_valid: becameValid,
      flagged_low_quality: flagged,
      unflagged_low_quality: unflagged,
      reason_breakdown: reasonBreakdown,
      errors,
    });

    // Log auditoria
    await supabase.from("collection_logs").insert({
      genre_id: g.id,
      acao: "revalidate-dataset",
      status: errors.length ? "warning" : "ok",
      duracao_ms: Date.now() - start,
      mensagem:
        `[revalidate] genre=${g.nome} total=${total} updated=${updated} ` +
        `→invalid=${becameInvalid} →valid=${becameValid} ` +
        `flag+=${flagged} flag-=${unflagged} dry=${dryRun} ` +
        `breakdown=${JSON.stringify(reasonBreakdown)}` +
        (errors.length ? ` ERR=${errors.slice(0, 3).join(" | ")}` : ""),
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      dry_run: dryRun,
      duration_ms: Date.now() - start,
      total_rows: grandTotal,
      total_updated: grandUpdated,
      per_genre: perGenre,
    }, null, 2),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
