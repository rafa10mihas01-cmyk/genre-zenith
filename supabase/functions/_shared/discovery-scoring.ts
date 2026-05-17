// _shared/discovery-scoring.ts — UMA esteira de avaliação para descoberta
// Usado por run-search (Apify) e genre-spotify-discover (Spotify API).
// Garante mesmo gate textual, mesma blacklist, mesma fórmula de quality_score.

export const QUALITY_SCORE_VERSION = 1;

export const PHASE2_MIN_FOLLOWERS = 100;
export const PHASE2_MIN_TRACKS = 20;

export const DEFAULT_BLACKLIST = [
  "workout", "gym", "treino", "academia", "sleep", "study", "focus", "lofi",
  "edm", "techno", "house", "trance", "rock", "metal", "jazz", "classical",
];

export const STRONG_BLACKLIST_BY_GENRE: Record<string, string[]> = {
  funk: [
    "phonk", "kordhell", "eternxlkz", "boogie", "disco", "oldies", "chicano",
    "bruno mars", "uptown funk", "pocoyo", "meow", "anime", "jjk", "yuji", "edit anime",
  ],
};

export const BR_BOOST_BY_GENRE: Record<string, string[]> = {
  funk: ["brasil", "br", "bailão", "bailao", "mandelão", "mandelao", "automotivo", "tropa", "dj", "mtg"],
};

export function wordHit(hay: string, term: string) {
  return new RegExp(
    `(^|[^a-záéíóúâêôãõç])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-záéíóúâêôãõç]|$)`,
    "i",
  ).test(hay);
}

export interface GateContext {
  slug: string;
  nome: string;
  termLower?: string;
  blacklist: string[];
  modelKeywords: string[];
  modelArtists: string[];
  subgenresList: string[];
}

export interface GateInput {
  nomePl: string;
  descricao: string | null;
  followers: number | null;
}

export interface GateOutput {
  score: number;
  reasons: string[];
  hardBlock: boolean;
  hardBlockReason?: string;
}

// Gate textual unificado. Replica scorePlaylist do run-search.
export function scoreAndGate(ctx: GateContext, input: GateInput): GateOutput {
  const slug = (ctx.slug ?? "").toLowerCase();
  const nome = (ctx.nome ?? "").toLowerCase();
  const slugOrNome = slug || nome;
  const termLower = (ctx.termLower ?? "").toLowerCase();
  const strongBlacklist = STRONG_BLACKLIST_BY_GENRE[slugOrNome] ?? [];
  const brBoostTerms = BR_BOOST_BY_GENRE[slugOrNome] ?? [];

  const nameLow = (input.nomePl ?? "").toLowerCase();
  const descLow = (input.descricao ?? "").toLowerCase();
  const haystack = `${nameLow} ${descLow}`;
  const reasons: string[] = [];

  // STRONG_BLACKLIST
  const strongHit = strongBlacklist.find(b => b && haystack.includes(b));
  if (strongHit) {
    return { score: -999, reasons: [`strong_blacklist:${strongHit}`], hardBlock: true, hardBlockReason: `strong_blacklist:${strongHit}` };
  }

  // GENRE-IN-NAME GATE
  const nameHasGenre = (slug && nameLow.includes(slug)) || (nome && nameLow.includes(nome));
  if (!nameHasGenre) {
    return { score: -999, reasons: [`no_${slug || nome || "genre"}_in_name`], hardBlock: true, hardBlockReason: `no_${slug || nome}_in_name` };
  }

  let score = 0;
  if (termLower && nameLow.includes(termLower)) { score += 30; reasons.push("+30 name~term"); }
  else if (slug && nameLow.includes(slug)) { score += 20; reasons.push("+20 name~slug"); }
  else if (nome && nameLow.includes(nome)) { score += 20; reasons.push("+20 name~nome"); }

  if (termLower && descLow.includes(termLower)) { score += 15; reasons.push("+15 desc~term"); }

  const artistHit = ctx.modelArtists.some(a => a && haystack.includes(a));
  if (artistHit) { score += 25; reasons.push("+25 artist"); }

  const kwHits = ctx.modelKeywords.filter(k => k && haystack.includes(k)).slice(0, 3);
  if (kwHits.length > 0) { score += 20; reasons.push(`+20 kw(${kwHits.length})`); }

  const subHit = ctx.subgenresList.find(s => s && haystack.includes(s));
  if (subHit) { score += 15; reasons.push(`+15 sub:${subHit}`); }

  if ((input.followers ?? 0) > 5000) { score += 10; reasons.push("+10 followers"); }

  const brHit = brBoostTerms.find(t => t && wordHit(haystack, t));
  if (brHit) { score += 15; reasons.push(`+15 br:${brHit}`); }

  // Blacklist soft
  const blHits = ctx.blacklist.filter(b => b && haystack.includes(b));
  if (blHits.length > 0) { score -= 40; reasons.push(`-40 bl:${blHits[0]}`); }

  const containsGenreAny = (slug && haystack.includes(slug)) || (nome && haystack.includes(nome)) || (termLower && haystack.includes(termLower));
  if (!containsGenreAny) { score -= 30; reasons.push("-30 genre-mismatch"); }

  return { score, reasons, hardBlock: blHits.length > 0, hardBlockReason: blHits.length > 0 ? `soft_bl:${blHits[0]}` : undefined };
}

// computeQualityScore — fonte única (v1). Sincronizado com SQL backfill.
export function computeQualityScore(opts: {
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

// Phase-2 gate (followers + tracks). Verdadeira fonte de is_valid.
export function phase2Fail(followers: number | null, tracks: number | null): boolean {
  return (
    (followers != null && followers < PHASE2_MIN_FOLLOWERS) ||
    (tracks != null && tracks < PHASE2_MIN_TRACKS)
  );
}

// Carrega o contexto do gênero (slug, blacklist, modelo) a partir do Supabase.
export async function loadGateContext(
  supabase: any,
  genreId: string,
  termLower?: string,
): Promise<GateContext> {
  const [{ data: genre }, { data: filt }, { data: model }] = await Promise.all([
    supabase.from("genres").select("slug,nome").eq("id", genreId).maybeSingle(),
    supabase.from("genre_filters").select("blacklist").eq("genre_id", genreId).maybeSingle(),
    supabase.from("genre_models").select("palavras_chave,musicas_recorrentes,insights").eq("genre_id", genreId).maybeSingle(),
  ]);
  const blacklist = (filt?.blacklist as string[] | undefined)?.map(b => b.toLowerCase()) ?? DEFAULT_BLACKLIST;
  const modelKeywords: string[] = (() => {
    const arr = model?.palavras_chave as any[] | undefined;
    if (!Array.isArray(arr)) return [];
    return arr.map(x => (typeof x === "string" ? x : x?.value ?? x?.keyword ?? "")).filter(Boolean).map(s => String(s).toLowerCase());
  })();
  const modelArtists: string[] = (() => {
    const tracks = model?.musicas_recorrentes as any[] | undefined;
    if (!Array.isArray(tracks)) return [];
    const set = new Set<string>();
    for (const t of tracks) {
      const a = typeof t === "string" ? "" : (t?.artista ?? t?.artist ?? "");
      if (a) String(a).split(/[,&]/).forEach(x => { const v = x.trim().toLowerCase(); if (v.length > 2) set.add(v); });
    }
    return [...set];
  })();
  const subgenresList: string[] = (() => {
    const subs = (model?.insights as any)?.subgeneros;
    if (!Array.isArray(subs)) return [];
    return subs.map((s: any) => [s?.slug, s?.nome].filter(Boolean)).flat().map((x: string) => String(x).toLowerCase());
  })();
  return {
    slug: (genre?.slug ?? "").toLowerCase(),
    nome: (genre?.nome ?? "").toLowerCase(),
    termLower,
    blacklist,
    modelKeywords,
    modelArtists,
    subgenresList,
  };
}
