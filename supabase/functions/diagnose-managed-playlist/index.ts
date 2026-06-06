// diagnose-managed-playlist — analisa uma playlist gerenciada contra o
// genre_model + benchmarks + concorrentes + ecosystem_score e gera:
// - sugestão de nome
// - sugestões de faixas a adicionar (do nicho, não presentes na playlist)
// - classificação faixa-a-faixa (keep | remove | promote | demote)
// - artistas faltando (presentes nos concorrentes mas não na playlist)
// - resumo de saturação + tamanho vs benchmark
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getSpotifyToken, guardedSpotifyFetch, SpotifyCircuitOpenError, setSpotifyCtx } from "../_shared/spotify.ts";
import {
  acquirePlaylistLock,
  releasePlaylistLock,
  finishPlaylistOperation,
  lockedResponseBody,
  formatPlaylistError,
  type LockHandle,
} from "../_shared/playlist-lock.ts";
import { buildRoadmap, derivePhase, bloatedRemovalBudget } from "../_shared/lifecycle.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------- telemetria (Fase 0A — observabilidade pura, não muda regras) ----------
// Mede duração de cada etapa do diagnose + contadores de falha.
// É puramente passivo: nenhum fluxo, score ou benchmark é alterado por esses dados.
type TelemetryStep = { name: string; started_at: number; ended_at: number | null; duration_ms: number | null; status: "ok" | "skipped" | "error"; note?: string };
class DiagnoseTelemetry {
  readonly t0 = Date.now();
  steps: TelemetryStep[] = [];
  active = new Map<string, number>();
  failures = {
    spotify_403: 0,
    spotify_429: 0,
    spotify_5xx: 0,
    spotify_other: 0,
    spotify_throw: 0,
    benchmark_empty: false,
    competitors_count: 0,
    competitors_insufficient: false,
    genre_missing: false,
    sync_failed: false,
    ai_editorial_failed: false,
    last_error: null as string | null,
  };
  start(name: string) { this.active.set(name, Date.now()); }
  end(name: string, status: TelemetryStep["status"] = "ok", note?: string) {
    const started = this.active.get(name) ?? Date.now();
    this.active.delete(name);
    this.steps.push({ name, started_at: started, ended_at: Date.now(), duration_ms: Date.now() - started, status, note });
  }
  skip(name: string, note?: string) {
    const now = Date.now();
    this.steps.push({ name, started_at: now, ended_at: now, duration_ms: 0, status: "skipped", note });
  }
  noteSpotifyStatus(status: number) {
    if (status === 403) this.failures.spotify_403++;
    else if (status === 429) this.failures.spotify_429++;
    else if (status >= 500) this.failures.spotify_5xx++;
    else if (!(status >= 200 && status < 300)) this.failures.spotify_other++;
  }
  noteThrow(e: unknown) {
    this.failures.spotify_throw++;
    this.failures.last_error = (e as Error)?.message ?? String(e);
  }
  report() {
    const total = Date.now() - this.t0;
    const slowest = [...this.steps].sort((a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0))[0] ?? null;
    const breakdown = this.steps.map((s) => ({
      name: s.name,
      ms: s.duration_ms,
      pct: total > 0 && s.duration_ms != null ? Math.round((s.duration_ms / total) * 1000) / 10 : null,
      status: s.status,
      note: s.note ?? null,
    }));
    return { total_ms: total, slowest, steps: breakdown, failures: this.failures };
  }
}

// ---------- helpers ----------


async function syncTracks(authHeader: string, playlistId: string) {
  // Chama sync-managed-playlist-tracks com skip_lock=true (já seguramos o lock DIAGNOSE_ENGINE).
  const r = await fetch(`${SUPABASE_URL}/functions/v1/sync-managed-playlist-tracks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify({ playlist_id: playlistId, skip_lock: true }),
  });
  const txt = await r.text();
  let j: any = {};
  try { j = JSON.parse(txt); } catch { /* ignore */ }
  return { ok: r.ok && j?.ok !== false, status: r.status, body: j, raw: txt };
}

function normName(s: any): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniq<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }

// ---------- IA editorial (Lovable AI Gateway) ----------

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

type EditorialCopy = {
  titles: string[];
  descriptions: string[];
  reasoning: string;
};

// Palavras "fortes" típicas de playlist BR viral (boost de score).
const STRONG_BR_TOKENS = [
  "top", "melhores", "as mais", "mais tocadas", "2025", "2026",
  "brasil", "nacional", "hits", "playlist", "fluxo", "só",
];
const STRONG_EMOJIS = ["🔥", "💥", "🚨", "❤️", "🇧🇷", "👑", "💣", "⚡"];

function countKeywordsInName(name: string, keywords: string[]): number {
  const lower = name.toLowerCase();
  return keywords.filter((k) => k && lower.includes(k.toLowerCase())).length;
}

function hasUppercaseWord(s: string): boolean {
  return /\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}\b/.test(s);
}

function hasStrongEmoji(s: string): boolean {
  return STRONG_EMOJIS.some((e) => s.includes(e));
}

function hasStrongBrToken(s: string): boolean {
  const lower = s.toLowerCase();
  return STRONG_BR_TOKENS.some((t) => lower.includes(t));
}

function similarityToNicheLeaders(s: string, leaders: string[]): number {
  const tokens = new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
  let hits = 0;
  for (const l of leaders) {
    const lt = l.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
    for (const w of lt) if (tokens.has(w)) { hits++; break; }
  }
  return hits;
}

/**
 * Score editorial BR-viral. Maior = melhor.
 *  +3 por keyword forte preservada
 *  +2 caixa alta presente
 *  +1 por emoji forte
 *  +2 se contém TOP / MELHORES / 2026 / etc.
 *  +3 por similaridade com nomes das playlists líderes do nicho
 *  -4 se nenhuma keyword do nicho aparece (abstrato/conceitual)
 *  -5 por keyword forte presente no nome ATUAL que foi REMOVIDA
 */
export function scoreTitle(opts: {
  candidate: string;
  topKeywords: string[];
  currentName: string;
  nicheLeaders: string[];
}): number {
  const { candidate, topKeywords, currentName, nicheLeaders } = opts;
  if (!candidate || candidate.length > 60) return -100;

  let score = 0;

  const kwPresent = topKeywords.filter((k) => k && candidate.toLowerCase().includes(k.toLowerCase()));
  score += kwPresent.length * 3;

  if (hasUppercaseWord(candidate)) score += 2;
  if (hasStrongEmoji(candidate)) score += 1;
  if (hasStrongBrToken(candidate)) score += 2;

  score += similarityToNicheLeaders(candidate, nicheLeaders) * 3;

  if (kwPresent.length === 0) score -= 4;

  const inCurrent = topKeywords.filter((k) => k && currentName.toLowerCase().includes(k.toLowerCase()));
  const lost = inCurrent.filter((k) => !candidate.toLowerCase().includes(k.toLowerCase()));
  score -= lost.length * 5;

  return score;
}

async function generateEditorialCopy(ctx: {
  skipAi?: boolean;
  currentName: string;
  currentDescription: string | null;
  genreName: string | null;
  topKeywords: string[];
  missingKeywords: string[];
  topArtists: string[];
  topRecurringTracks: { title: string; artist: string }[];
  benchmarkSize: number | null;
  currentSize: number;
  competitors: { name: string }[];
}): Promise<EditorialCopy | null> {
  if (!LOVABLE_API_KEY || ctx.skipAi) return null;

  const keywordsInCurrent = countKeywordsInName(ctx.currentName, ctx.topKeywords);
  const preserveMode = keywordsInCurrent >= 2;

  const system = [
    `Você é um CURADOR BR especialista em playlists VIRAIS no Spotify, nicho "${ctx.genreName ?? "música brasileira"}".`,
    `Pensa como dono de playlist que vive de CTR e busca — não como editor global do Spotify.`,
    ``,
    `PRIORIDADE ABSOLUTA: SEO + CTR > criatividade artística.`,
    `Cada palavra do título serve pra ser BUSCADA ou pra dar TAP.`,
    ``,
    `REGRAS DURAS:`,
    `- CAIXA ALTA é PERMITIDA e INCENTIVADA em keywords fortes (RAP NACIONAL, FUNK, TOP, MELHORES, 2026).`,
    `- EMOJIS são PERMITIDOS e INCENTIVADOS no título: 🔥 💥 🚨 ❤️ 🇧🇷 👑 ⚡ — máximo 2 por título, geralmente nas pontas.`,
    `- Palavras vencedoras como "AS MELHORES", "TOP", "AS MAIS TOCADAS", "2026", "NACIONAL", "BRASIL" devem ser usadas quando fazem sentido.`,
    `- PRESERVE as keywords fortes do nome atual. NUNCA remova uma keyword que já estava lá.`,
    `- Título máximo 40 caracteres (contando emoji).`,
    `- Português brasileiro, linguagem direta de rua / playlist de bairro.`,
    ``,
    `REFERÊNCIAS REAIS (imite ESTE padrão, não Spotify Global):`,
    `- "RAP NACIONAL 🔥 AS MELHORES"`,
    `- "FUNK 2026 🔥"`,
    `- "SÓ MODÃO 💥"`,
    `- "TRAP BRASIL 🇧🇷"`,
    `- "SERTANEJO AS MAIS TOCADAS"`,
    `- "PISEIRO TOP 🚨"`,
    ``,
    `NUNCA FAÇA:`,
    `- Nomes abstratos/poéticos ("fluxo das ruas", "ecos do asfalto", "vibes da quebrada").`,
    `- Linguagem editorial Spotify Global (RapCaviar, Mint, Pollen).`,
    `- Substituir keyword forte por sinônimo artístico.`,
    `- Descrição com "Descubra...", "Embarque numa jornada...", "Curadoria especial...".`,
    ``,
    preserveMode
      ? `MODO PRESERVAÇÃO ATIVO: o nome atual já contém ${keywordsInCurrent} keywords fortes do nicho. NÃO reinvente — OTIMIZE. Mantenha estrutura e keywords. Apenas adicione emoji forte, ano (2026) ou palavra de CTR (TOP / AS MELHORES) se faltarem.`
      : `MODO REESCRITA: o nome atual é fraco em SEO. Reescreva mantendo o nicho, usando padrão BR viral (caixa alta + keyword forte + emoji).`,
    ``,
    `DESCRIÇÃO: máximo 180 char, BR direta, pode usar emoji, pode chamar pra ação ("dá o play", "atualizada toda semana", "os hits que tão dominando"). NÃO use tom conceitual/poético.`,
    ``,
    `RETORNE APENAS JSON VÁLIDO:`,
    `{"titles":["t1","t2","t3"],"descriptions":["d1","d2"],"reasoning":"frase curta"}`,
  ].join("\n");

  const userPayload = {
    nome_atual: ctx.currentName,
    descricao_atual: ctx.currentDescription,
    nicho: ctx.genreName,
    palavras_chave_prioritarias: ctx.topKeywords.slice(0, 10),
    palavras_chave_faltando: ctx.missingKeywords.slice(0, 6),
    palavras_chave_ja_presentes_no_nome: ctx.topKeywords.filter((k) =>
      ctx.currentName.toLowerCase().includes(k.toLowerCase())
    ),
    modo: preserveMode ? "preservar_e_otimizar" : "reescrever_com_seo_br",
    artistas_dominantes_nicho: ctx.topArtists.slice(0, 8),
    faixas_mais_recorrentes_nicho: ctx.topRecurringTracks.slice(0, 6),
    tamanho_atual_faixas: ctx.currentSize,
    tamanho_ideal_nicho: ctx.benchmarkSize,
    playlists_lideres_nicho: ctx.competitors.slice(0, 5).map((c) => c.name),
    instrucao: preserveMode
      ? "Gere 3 variações OTIMIZADAS do título atual (mantendo keywords) + 2 descrições BR diretas com emoji e CTA."
      : "Gere 3 títulos BR virais (caixa alta + keyword forte + emoji quando fizer sentido) + 2 descrições BR diretas com emoji e CTA.",
  };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12_000);

  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.35,
      }),
    });

    if (!r.ok) {
      throw new Error(`gateway_${r.status}`);
    }
    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content;
    if (!raw) throw new Error("empty_content");
    const parsed = JSON.parse(raw);
    const titles = Array.isArray(parsed.titles) ? parsed.titles.filter((x: unknown) => typeof x === "string" && x.trim().length > 0) : [];
    const descriptions = Array.isArray(parsed.descriptions) ? parsed.descriptions.filter((x: unknown) => typeof x === "string" && x.trim().length > 0) : [];
    if (titles.length === 0 && descriptions.length === 0) throw new Error("no_outputs");
    return {
      titles: titles.slice(0, 3),
      descriptions: descriptions.slice(0, 2),
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch (e) {
    console.warn("[diagnose] editorial AI falhou:", (e as Error).message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let lockHandle: LockHandle | null = null;
  let supabaseRef: any = null;

  try {
    const body = await req.json().catch(() => ({}));
    const playlistId: string = body?.playlist_id;
    const skipAi: boolean = body?.skip_ai === true || body?.source === "batch" || body?.source === "cron";
    const forceBlocked: boolean = body?.force === true || body?.force_blocked === true;
    if (!playlistId) return jr({ ok: false, error: "playlist_id obrigatório" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    supabaseRef = supabase;
    const { data: pl, error: plErr } = await supabase
      .from("managed_playlists")
      .select("*")
      .eq("id", playlistId)
      .maybeSingle();
    if (plErr || !pl) return jr({ ok: false, error: plErr?.message ?? "playlist não encontrada" }, 404);

    // FASE 2 — Diagnose blocked: corta cedo se a playlist está marcada por 403 persistente.
    // Apenas tentativa manual com force=true ignora a marca.
    if ((pl as any).diagnose_blocked === true && !forceBlocked) {
      return jr({
        ok: true,
        skipped: true,
        reason: "diagnose_blocked",
        diagnose_blocked_at: (pl as any).diagnose_blocked_at,
        diagnose_blocked_reason: (pl as any).diagnose_blocked_reason,
      });
    }

    // Contador de 403s observados nesta execução — usado pro streak.
    let run403s = 0;
    const ownerSpotifyId: string | null = (pl as any).owner_spotify_user_id ?? null;

    // Propaga contexto Spotify pra TODAS as chamadas derivadas desta execução
    // (getPlaylistMeta, listPlaylistTracksRich, guardedSpotifyFetch sem ctx, etc.)
    setSpotifyCtx({
      playlist_id: pl.id,
      owner_id: ownerSpotifyId,
      spotify_user_id: ownerSpotifyId,
      function_name: "diagnose-managed-playlist",
    });


    // Lock operacional: impede race com apply-playlist-plan / sync-managed-playlist-tracks.
    // TTL de 30s; liberado no finally.
    const lockResult = await acquirePlaylistLock(supabase, pl.id, "DIAGNOSE_ENGINE", pl.tracks_count ?? null);
    if (!lockResult.ok) return jr(lockedResponseBody(lockResult), 423);
    lockHandle = lockResult;

    // === TELEMETRIA (Fase 0A) — passiva, não altera fluxo ===
    const tel = new DiagnoseTelemetry();

    // 1) Snapshot fresco das faixas atuais (best-effort — se falhar, segue com cache)
    // Passa skip_lock=true porque já seguramos o lock DIAGNOSE_ENGINE.
    const authHeader = req.headers.get("Authorization") ?? `Bearer ${SERVICE_KEY}`;
    tel.start("sync_tracks");
    const syncRes = await syncTracks(authHeader, pl.id).catch((e) => ({ ok: false, error: String(e) }));
    tel.end("sync_tracks", (syncRes as any)?.ok ? "ok" : "error", (syncRes as any)?.ok ? undefined : "sync falhou");
    if (!(syncRes as any)?.ok) tel.failures.sync_failed = true;

    // === FASE 6C — Carrega Playlist Brain (fonte oficial dos indicadores operacionais) ===
    // Leitura passiva: não recalcula nada no brain. Diagnose continua tendo seu cálculo
    // local intacto pra fallback + auditoria de drift.
    let brain: any = null;
    const brainCanonicalId: string | null = (pl as any).canonical_playlist_id ?? null;
    tel.start("load_brain");
    if (brainCanonicalId) {
      const { data: pb, error: brErr } = await supabase
        .from("playlist_brain")
        .select("playlist_id, identity, personality, capacity_total, capacity_per_slot, capacity_ceiling, headroom_pct, health_trend, signals, recommendations, confidence_score, last_calculated_at, lifecycle_phase, benchmark_tracks, ratio_to_benchmark, growth_roadmap")
        .eq("playlist_id", brainCanonicalId)
        .maybeSingle();
      if (brErr) {
        tel.end("load_brain", "error", brErr.message);
      } else if (pb) {
        brain = pb;
        const ageH = pb.last_calculated_at
          ? Math.round((Date.now() - new Date(pb.last_calculated_at as string).getTime()) / 3_600_000)
          : null;
        tel.end("load_brain", "ok", `conf=${pb.confidence_score} age=${ageH}h`);
      } else {
        tel.end("load_brain", "skipped", "brain ausente");
      }
    } else {
      tel.skip("load_brain", "canonical_playlist_id ausente");
    }


    // 2) Carrega modelo, benchmark, concorrentes, faixas atuais e ecosystem scores
    let model: any = null;
    let benchmark: any = null;
    let competitors: any[] = [];
    let genreRecurrence: Map<string, { count: number; track_name: string | null; artist_name: string | null; latest_coletado_em: string | null }> = new Map();
    let poolAgeDaysCap: number | "all" = 90; // janela efetiva usada no pool de candidatos
    let genreArtistsTop: { artist: string; count: number }[] = [];
    let genreName: string | null = null;

    if (!pl.genre_id) tel.failures.genre_missing = true;

    if (pl.genre_id) {
      tel.start("load_model_benchmark_competitors");
      const [{ data: m }, { data: b }, { data: comps }, { data: gRow }] = await Promise.all([

        supabase.from("genre_models")
          .select("palavras_chave, padroes_nome, musicas_recorrentes, insights")
          .eq("genre_id", pl.genre_id).maybeSingle(),
        supabase.from("genre_benchmarks")
          .select("followers_p50,followers_p75,followers_p90,tracks_p50,tracks_p75,tracks_p90,sample_size")
          .eq("genre_id", pl.genre_id).maybeSingle(),
        supabase.from("playlists")
          .select("spotify_playlist_id,name,followers,cover_url")
          .eq("genre_id", pl.genre_id)
          .eq("ownership", "external")
          .eq("monitored", true)
          .not("followers", "is", null)
          .order("followers", { ascending: false })
          .limit(10),
        supabase.from("genres").select("nome").eq("id", pl.genre_id).maybeSingle(),
      ]);

      // 🆕 search_tracks com FILTRO TEMPORAL antes do top-40.
      // Primário: 90d. Fallback 1: 180d. Fallback 2: all-time + WARN.
      async function fetchPool(daysOrAll: number | "all") {
        let q = supabase
          .from("search_tracks")
          .select("spotify_track_id, nome_musica, artista, coletado_em")
          .eq("genre_id", pl.genre_id)
          .not("spotify_track_id", "is", null)
          .order("coletado_em", { ascending: false })
          .limit(5000);
        if (daysOrAll !== "all") {
          const cutoff = new Date(Date.now() - daysOrAll * 86400_000).toISOString();
          q = q.gte("coletado_em", cutoff);
        }
        return q;
      }
      const uniqIds = (rows: any[] | null | undefined) =>
        new Set((rows ?? []).map((r) => r.spotify_track_id).filter(Boolean)).size;

      let srTracks: any[] | null = null;
      let { data: pool90 } = await fetchPool(90);
      if (uniqIds(pool90) >= 40) {
        srTracks = pool90; poolAgeDaysCap = 90;
      } else {
        const { data: pool180 } = await fetchPool(180);
        if (uniqIds(pool180) >= 40) {
          srTracks = pool180; poolAgeDaysCap = 180;
        } else {
          const { data: poolAll } = await fetchPool("all");
          srTracks = poolAll; poolAgeDaysCap = "all";
          console.warn(`[WARN] pool_age_fallback: nicho=${pl.genre_id}, days_extended=all (uniq90=${uniqIds(pool90)}, uniq180=${uniqIds(pool180)}, uniqAll=${uniqIds(poolAll)})`);
        }
      }

      model = m;
      benchmark = b;
      genreName = (gRow as any)?.nome ?? null;
      competitors = (comps ?? []).map((c: any) => ({
        spotify_playlist_id: c.spotify_playlist_id,
        name: c.name,
        followers: c.followers,
        cover_url: c.cover_url,
      }));

      // Recorrência por track_id no nicho — SOMENTE no pool filtrado por recência.
      for (const t of srTracks ?? []) {
        if (!t.spotify_track_id) continue;
        const cur = genreRecurrence.get(t.spotify_track_id);
        if (cur) {
          cur.count++;
          if (t.coletado_em && (!cur.latest_coletado_em || t.coletado_em > cur.latest_coletado_em)) {
            cur.latest_coletado_em = t.coletado_em;
          }
        } else {
          genreRecurrence.set(t.spotify_track_id, {
            count: 1,
            track_name: t.nome_musica ?? null,
            artist_name: t.artista ?? null,
            latest_coletado_em: t.coletado_em ?? null,
          });
        }
      }
      // Top artistas do nicho (por nº de aparições, no mesmo pool filtrado)
      const artistCount = new Map<string, number>();
      for (const t of srTracks ?? []) {
        if (!t.artista) continue;
        // pode vir "A, B, C" — pega só o primeiro pra reduzir ruído
        const main = String(t.artista).split(",")[0].trim();
        if (!main) continue;
        artistCount.set(main, (artistCount.get(main) ?? 0) + 1);
      }
      genreArtistsTop = Array.from(artistCount.entries())
        .map(([artist, count]) => ({ artist, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30);
      tel.end("load_model_benchmark_competitors");
      if (!benchmark) tel.failures.benchmark_empty = true;
      tel.failures.competitors_count = competitors.length;
      if (competitors.length < 3) tel.failures.competitors_insufficient = true;
    } else {
      tel.skip("load_model_benchmark_competitors", "genre_id ausente");
    }





    // Adjacência de gêneros — pra checar aderência da faixa ao nicho via Spotify artist.genres
    const NICHE_ADJACENCY: Record<string, string[]> = {
      pagode: ["pagode", "samba"],
      samba: ["samba", "pagode"],
      sertanejo: ["sertanejo", "forro", "forró", "piseiro"],
      forro: ["forro", "forró", "sertanejo", "piseiro"],
      "forró": ["forró", "forro", "sertanejo", "piseiro"],
      funk: ["funk", "baile", "carioca", "paulista", "mandelão", "automotivo", "tuim"],
      gospel: ["gospel", "worship", "louvor", "cristã", "cristao"],
      rap: ["rap", "trap", "hip hop", "hiphop"],
      trap: ["trap", "rap", "hip hop"],
      rock: ["rock", "metal", "punk", "indie"],
      eletronica: ["eletronica", "eletrônica", "electro", "house", "techno", "edm"],
      "eletrônica": ["eletrônica", "eletronica", "electro", "house", "techno", "edm"],
    };
    const baseNiche = (genreName ?? "").toLowerCase().trim();
    const nicheTerms: string[] = baseNiche ? (NICHE_ADJACENCY[baseNiche] ?? [baseNiche]) : [];

    // 3) Faixas atuais da playlist gerenciada
    tel.start("load_current_tracks");
    const { data: currentTracks } = await supabase
      .from("managed_playlist_tracks")
      .select("spotify_track_id, track_name, artist_name, position, added_at, isrc, duration_ms")
      .eq("playlist_id", pl.id)
      .order("position", { ascending: true });

    const trackIds = (currentTracks ?? []).map((t: any) => t.spotify_track_id).filter(Boolean);
    tel.end("load_current_tracks", "ok", `${trackIds.length} faixas`);


    // 3.a) CAMPANHAS ATIVAS NA PLAYLIST — faixas com deal em andamento entram em estado PROTEGIDO.
    // O analisador NÃO pode recomendar remover, rebaixar ou promover uma faixa em campanha ativa:
    // ela tem meta + obrigação operacional. Só ajustes suaves dentro da própria zona.
    type ProtectedTrack = {
      campaign_id: string;
      campaign_status: string;
      planned_streams: number;
      allocation_status: string;
    };
    const protectedTracks = new Map<string, ProtectedTrack>();
    {
      const { data: protRows } = await supabase
        .from("campaign_eco_allocations")
        .select("campaign_id, planned_streams, status, campaigns!inner(id, spotify_track_id, status)")
        .eq("managed_playlist_id", pl.id)
        .in("status", ["pending", "dispatched", "active"])
        .in("campaigns.status", ["draft", "active", "paused"]);
      for (const row of (protRows ?? []) as any[]) {
        const tid = row.campaigns?.spotify_track_id;
        if (!tid) continue;
        // Se a mesma faixa tiver várias allocations, mantém a mais "forte"
        const prev = protectedTracks.get(tid);
        const cur: ProtectedTrack = {
          campaign_id: row.campaign_id,
          campaign_status: row.campaigns.status,
          planned_streams: Number(row.planned_streams ?? 0),
          allocation_status: row.status,
        };
        if (!prev || cur.planned_streams > prev.planned_streams) protectedTracks.set(tid, cur);
      }
    }

    // 3.b) Denominador de saturação = nº de playlists do nicho varridas
    let nichePlaylistCount = 0;
    if (pl.genre_id) {
      const { count } = await supabase
        .from("search_results")
        .select("id", { count: "exact", head: true })
        .eq("genre_id", pl.genre_id);
      nichePlaylistCount = count ?? 0;
    }

    // 3.c) Busca sinais públicos do Spotify (popularity, release_date, artistas)
    type SpotMeta = {
      popularity: number | null;
      release_date: string | null;
      artist_id: string | null;
    };
    const spotMeta = new Map<string, SpotMeta>();
    const artistMeta = new Map<string, { popularity: number | null; followers: number | null; genres: string[] }>();

    if (trackIds.length > 0) {
      tel.start("spotify_current_tracks_and_artists");
      try {
        const token = await getSpotifyToken();
        // /v1/tracks?ids= (até 50)
        for (let i = 0; i < trackIds.length; i += 50) {
          const ids = trackIds.slice(i, i + 50);
          const r = await guardedSpotifyFetch(`https://api.spotify.com/v1/tracks?ids=${ids.join(",")}`, { headers: { Authorization: `Bearer ${token}` } }, { playlist_id: pl.id, owner_id: ownerSpotifyId, spotify_user_id: ownerSpotifyId, function_name: 'diagnose-managed-playlist' });
          tel.noteSpotifyStatus(r.status);
          if (r.status === 403) run403s++;
          if (!r.ok) continue;
          const j = await r.json();
          for (const tr of j.tracks ?? []) {
            if (!tr?.id) continue;
            spotMeta.set(tr.id, {
              popularity: typeof tr.popularity === "number" ? tr.popularity : null,
              release_date: tr.album?.release_date ?? null,
              artist_id: tr.artists?.[0]?.id ?? null,
            });
          }
        }
        // /v1/artists?ids= (até 50)
        const artistIds = uniq(
          Array.from(spotMeta.values()).map((m) => m.artist_id).filter(Boolean) as string[],
        );
        for (let i = 0; i < artistIds.length; i += 50) {
          const ids = artistIds.slice(i, i + 50);
          const r = await guardedSpotifyFetch(`https://api.spotify.com/v1/artists?ids=${ids.join(",")}`, { headers: { Authorization: `Bearer ${token}` } }, { playlist_id: pl.id, owner_id: ownerSpotifyId, spotify_user_id: ownerSpotifyId, function_name: 'diagnose-managed-playlist' });
          tel.noteSpotifyStatus(r.status);
          if (r.status === 403) run403s++;
          if (!r.ok) continue;
          const j = await r.json();
          for (const ar of j.artists ?? []) {
            if (!ar?.id) continue;
            artistMeta.set(ar.id, {
              popularity: typeof ar.popularity === "number" ? ar.popularity : null,
              followers: ar.followers?.total ?? null,
              genres: Array.isArray(ar.genres) ? ar.genres.map((g: string) => String(g).toLowerCase()) : [],
            });
          }
        }
        tel.end("spotify_current_tracks_and_artists", "ok", `${spotMeta.size} tracks · ${artistMeta.size} artistas`);
      } catch (e) {
        tel.noteThrow(e);
        tel.end("spotify_current_tracks_and_artists", "error", (e as Error)?.message);
        // Circuit breaker aberto: aborta o diagnóstico — propaga pro handler.
        if (e instanceof SpotifyCircuitOpenError) throw e;
        // Outras falhas: segue sem metadados (classificador degrada gracefully).
      }
    } else {
      tel.skip("spotify_current_tracks_and_artists", "sem trackIds");
    }


    // Helper: avalia se um artista (pelos seus spotify.genres) pertence ao nicho da playlist.
    // Retorna:
    //   "match"     → tem ao menos 1 gênero compatível com o nicho
    //   "off_niche" → tem gêneros mas nenhum bate com o nicho
    //   "unknown"   → artista sem gêneros mapeados (não dá pra decidir)
    function classifyArtistVsNiche(artistId: string | null): "match" | "off_niche" | "unknown" {
      if (!artistId || nicheTerms.length === 0) return "unknown";
      const meta = artistMeta.get(artistId);
      if (!meta || !meta.genres || meta.genres.length === 0) return "unknown";
      for (const g of meta.genres) {
        for (const term of nicheTerms) {
          if (g.includes(term) || term.includes(g)) return "match";
        }
      }
      return "off_niche";
    }


    // 4) Classificação por faixa — ZONAS EDITORIAIS
    //
    // A playlist é tratada como uma vitrine com 4 zonas, cada uma com função própria:
    //   - anchor    (pos 1-2)  : fachada. Só hits dominantes.
    //   - premium   (pos 3-6)  : zona principal de impulsionamento (campanhas e crescimento).
    //   - support   (pos 7-12) : sustentação, retenção, equilíbrio.
    //   - tail      (pos 13+)  : profundidade, descoberta, rotatividade leve.
    //
    // Cada faixa recebe scores por zona; o "melhor zone fit" determina onde ela DEVIA estar.
    // Status passa a ser "essa música faz sentido AQUI?", não "essa música é forte/fraca?".
    type Zone = "anchor" | "premium" | "support" | "tail";
    const ZONE_RANGES: Record<Zone, [number, number]> = {
      anchor:  [0, 1],   // posições 1-2
      premium: [2, 5],   // posições 3-6
      support: [6, 11],  // posições 7-12
      tail:    [12, 9999],
    };
    const ZONE_ORDER: Zone[] = ["anchor", "premium", "support", "tail"];
    const ZONE_LABELS: Record<Zone, string> = {
      anchor: "Fachada",
      premium: "Premium",
      support: "Sustentação",
      tail: "Cauda",
    };
    const totalTracks = (currentTracks ?? []).length;
    const NOW = Date.now();

    function zoneFromPos(pos: number): Zone {
      if (pos <= ZONE_RANGES.anchor[1]) return "anchor";
      if (pos <= ZONE_RANGES.premium[1]) return "premium";
      if (pos <= ZONE_RANGES.support[1]) return "support";
      return "tail";
    }
    function zoneMiddle(zone: Zone): number {
      const [a, b] = ZONE_RANGES[zone];
      const end = zone === "tail" ? Math.max(a, totalTracks - 1) : b;
      return Math.floor((a + end) / 2);
    }
    // Distribui N posições espalhadas naturalmente dentro de uma zona,
    // evitando colisão/empilhamento. Comportamento de editor humano:
    //   1 item  → meio da zona
    //   N itens → espaçamento uniforme entre [a, end]
    //   N > span → satura nos limites sem duplicar
    function distributeInZone(zone: Zone, count: number): number[] {
      if (count <= 0) return [];
      const [a, b] = ZONE_RANGES[zone];
      const end = zone === "tail" ? Math.max(a, totalTracks - 1) : b;
      const span = Math.max(0, end - a);
      if (count === 1) return [Math.floor((a + end) / 2)];
      const positions: number[] = [];
      for (let i = 0; i < count; i++) {
        positions.push(a + Math.round((i * span) / (count - 1)));
      }
      return positions;
    }

    type TrackScores = {
      anchor: number; premium: number; support: number; tail: number;
      anchorEligible: boolean;
    };

    // Top-3 artistas dominantes do nicho — recebem boost de elegibilidade pra fachada.
    // Regra: se o artista domina o nicho (top 3 por recorrência), ele entra na fachada
    // mesmo com popularity 55-69, porque a leitura editorial vem do nicho, não do número absoluto.
    const dominantArtists = new Set(
      genreArtistsTop.slice(0, 3).map((a) => a.artist.toLowerCase()),
    );

    // Pré-calcula sinais e scores de zona
    const rawTracks = (currentTracks ?? []).map((t: any) => {
      const meta = spotMeta.get(t.spotify_track_id);
      const rec = genreRecurrence.get(t.spotify_track_id);
      const recurrence = rec?.count ?? 0;
      const popularity = meta?.popularity ?? null;
      const releaseDate = meta?.release_date ?? null;
      const artist = meta?.artist_id ? artistMeta.get(meta.artist_id) : undefined;
      const artistPop = artist?.popularity ?? null;
      const artistFollowers = artist?.followers ?? null;
      const artistGenres = artist?.genres ?? [];
      const nicheFit = classifyArtistVsNiche(meta?.artist_id ?? null);
      const pos: number = t.position ?? 0;
      const saturationPct = nichePlaylistCount > 0
        ? Math.min(100, Math.round((recurrence / nichePlaylistCount) * 100))
        : 0;
      const addedAt = t.added_at ? new Date(t.added_at).getTime() : null;
      const ageDays = addedAt ? Math.floor((NOW - addedAt) / 86400000) : null;
      const releaseAgeYears = releaseDate
        ? Math.max(0, (NOW - new Date(releaseDate).getTime()) / (365 * 86400000))
        : null;

      // Normalizações 0-100
      const pop = popularity ?? 0;
      const aPop = artistPop ?? 0;
      const recNorm = Math.min(100, recurrence * 12); // 8× no nicho ≈ 96
      const freshness = releaseAgeYears == null ? 40
        : releaseAgeYears < 0.25 ? 100
        : releaseAgeYears < 1 ? 75
        : releaseAgeYears < 3 ? 50
        : 20;
      const stability = ageDays == null ? 50
        : ageDays > 90 ? 90
        : ageDays > 30 ? 70
        : 40;

      // Artista dominante no nicho (top 3 por recorrência)?
      const artistNameLower = String(t.artist_name ?? "").split(",")[0].trim().toLowerCase();
      const isDominantArtist = artistNameLower.length > 0 && dominantArtists.has(artistNameLower);
      const dominantBoost = isDominantArtist ? 20 : 0;

      // Score por zona — pesos refletem a função.
      // Artistas dominantes do nicho ganham +20 no anchorScore (leitura editorial > pop absoluto).
      const anchorScore  = Math.round(pop * 0.5  + aPop * 0.3  + recNorm * 0.2) + dominantBoost;
      const premiumScore = Math.round(pop * 0.4  + recNorm * 0.35 + freshness * 0.25);
      const supportScore = Math.round(recNorm * 0.5 + pop * 0.3 + stability * 0.2);
      const tailScore    = Math.round(freshness * 0.5 + Math.max(0, 60 - pop) * 0.3 + recNorm * 0.2);

      // Floor da fachada:
      //  - regra padrão: pop ≥ 70 E (artista forte OU muito recorrente), OU
      //  - regra dominante: artista top-3 do nicho com pop ≥ 55 (cultura do nicho > pop absoluto)
      const anchorEligible =
        (popularity != null && popularity >= 70 && (aPop >= 70 || recurrence >= 5)) ||
        (isDominantArtist && popularity != null && popularity >= 55);

      return {
        t, recurrence, popularity, releaseDate, artistPop, artistFollowers,
        artistGenres, nicheFit,
        pos, saturationPct, ageDays, releaseAgeYears, isDominantArtist,
        scores: { anchor: anchorScore, premium: premiumScore, support: supportScore, tail: tailScore, anchorEligible } as TrackScores,
      };
    });

    // Até 2 candidatas reais à fachada: top anchorScore que passam no floor.
    // Artistas dominantes do nicho vão na frente (mesmo critério, mas o boost +20 já os empurra).
    const anchorSet = new Set(
      rawTracks
        .filter(x => x.scores.anchorEligible && !protectedTracks.has(x.t.spotify_track_id))
        .sort((a, b) => {
          // Dominante > não-dominante; depois por anchorScore
          if (a.isDominantArtist !== b.isDominantArtist) return a.isDominantArtist ? -1 : 1;
          return b.scores.anchor - a.scores.anchor;
        })
        .slice(0, 2)
        .map(x => x.t.spotify_track_id),
    );

    function pickBestZone(x: typeof rawTracks[number]): Zone {
      const s = x.scores;
      const candidates: { z: Zone; v: number }[] = [
        { z: "premium", v: s.premium },
        { z: "support", v: s.support },
        { z: "tail",    v: s.tail },
      ];
      if (anchorSet.has(x.t.spotify_track_id)) {
        candidates.push({ z: "anchor", v: s.anchor + 5 }); // pequeno bias
      }
      candidates.sort((a, b) => b.v - a.v);
      return candidates[0].z;
    }

    const tracksAnalysis = rawTracks.map((x) => {
      const { t, recurrence, popularity, releaseDate, artistPop, artistFollowers, artistGenres, nicheFit, pos, saturationPct, ageDays, scores, isDominantArtist } = x;
      const currentZone = zoneFromPos(pos);
      const bestZone = pickBestZone(x);
      const bestZoneScore = scores[bestZone];

      let status: "keep" | "remove" | "promote" | "demote" | "protected" = "keep";
      const reasons: string[] = [];
      let targetPosition: number | null = null;
      const protectedInfo = protectedTracks.get(t.spotify_track_id);

      // 0) PROTEGIDA — campanha ativa. Não pode ser tocada automaticamente.
      if (protectedInfo) {
        status = "protected";
        const statusLabel = protectedInfo.campaign_status === "active" ? "ativa"
          : protectedInfo.campaign_status === "draft" ? "em rascunho"
          : "pausada";
        reasons.push(`campanha ${statusLabel} entregando meta nesta faixa`);
        if (protectedInfo.planned_streams > 0) {
          reasons.push(`${protectedInfo.planned_streams.toLocaleString("pt-BR")} streams planejados nesta playlist`);
        }
        reasons.push("zona reservada · só ajustes suaves dentro do bloco da campanha");
      }
      // 1) REMOVER fora-do-nicho — artista tem gêneros mapeados no Spotify e nenhum bate com o nicho,
      //    não é dominante e não tem recorrência. Pagode com funk no meio sai daqui.
      else if (nicheFit === "off_niche" && recurrence === 0 && !isDominantArtist) {
        status = "remove";
        const gShown = artistGenres.slice(0, 2).join(", ");
        reasons.push(`fora do nicho · artista é ${gShown || "outro gênero"}, playlist é ${genreName ?? "—"}`);
        reasons.push("nenhum gênero do artista bate com o nicho da playlist");
      }
      // 2) REMOVER saturada — enterrada e sem função em zona nenhuma
      else if (saturationPct >= 70 && pos >= 20 && bestZoneScore < 45) {
        status = "remove";
        reasons.push(`saturada no nicho (${saturationPct}%) e enterrada em #${pos + 1}`);
        reasons.push("não cumpre função em nenhuma zona");
      }
      // 3) REMOVER frio — sem força em zona nenhuma + sem recorrência + tempo de teste
      else if (popularity != null && popularity < 30 && recurrence === 0 && (ageDays == null || ageDays > 30) && bestZoneScore < 25) {
        status = "remove";
        reasons.push(`popularity ${popularity} e zero presença no nicho`);
        if (ageDays != null) reasons.push(`${ageDays}d sem cumprir função editorial`);
      }
      // 3) MOVER PRA ZONA CERTA — análise por função, não por número absoluto
      else if (bestZone !== currentZone) {
        const goingUp = ZONE_ORDER.indexOf(bestZone) < ZONE_ORDER.indexOf(currentZone);
        status = goingUp ? "promote" : "demote";
        targetPosition = zoneMiddle(bestZone);

        // Regra dura da fachada (pos 1-2):
        //   • só rebaixa se a faixa for realmente lixo (pop < 40 E recorrência 0)
        //   • caso contrário, fachada se mantém — só campanha GRANDE consegue reposicionar
        //     (campanhas grandes já chegam aqui via protectedInfo, então não é decidido aqui)
        if (currentZone === "anchor" && !scores.anchorEligible) {
          const isTrash = (popularity != null && popularity < 40) && recurrence === 0;
          if (isTrash) {
            status = "demote";
            targetPosition = zoneMiddle("premium");
            reasons.push(`na fachada (#${pos + 1}) sem força mínima — pop ${popularity ?? "—"} e zero recorrência no nicho`);
            reasons.push("fachada exige hit dominante ou artista top do nicho");
          } else {
            // mantém na fachada: faixa não é ideal mas não é trash; só campanha grande move
            status = "keep";
            targetPosition = null;
            reasons.push(`fachada preservada · pop ${popularity ?? "—"}${artistPop != null ? ` · artista ${artistPop}` : ""}`);
            reasons.push("posição 1-2 só muda por campanha grande ou faixa sem força mínima");
          }
        } else if (goingUp) {
          reasons.push(`função melhor em ${ZONE_LABELS[bestZone]} (score ${bestZoneScore})`);
          reasons.push(`hoje em ${ZONE_LABELS[currentZone]} (#${pos + 1}) — subir pra zona ${ZONE_LABELS[bestZone]}`);
        } else {
          reasons.push(`hoje em ${ZONE_LABELS[currentZone]} (#${pos + 1}) — não cumpre função desta zona`);
          reasons.push(`mover pra ${ZONE_LABELS[bestZone]} (score ${bestZoneScore})`);
        }
      }
      // 4) KEEP — faixa cumpre função da zona em que está
      else {
        if (currentZone === "anchor") {
          reasons.push(`âncora forte · popularity ${popularity ?? "—"}${artistPop != null ? ` · artista ${artistPop}` : ""}`);
        } else if (currentZone === "premium") {
          reasons.push(`encaixa em Premium (score ${scores.premium})`);
        } else if (currentZone === "support") {
          reasons.push(`sustenta o fluxo · ${recurrence}× no nicho`);
        } else {
          reasons.push(`profundidade da playlist · cauda saudável`);
        }
      }

      return {
        spotify_track_id: t.spotify_track_id,
        track_name: t.track_name,
        artist_name: t.artist_name,
        position: pos,
        status,
        reasons,
        // zona editorial
        current_zone: currentZone,
        best_zone: bestZone,
        zone_scores: scores,
        anchor_eligible: scores.anchorEligible,
        target_position: targetPosition,
        // sinais
        recurrence_in_genre: recurrence,
        saturation_pct: saturationPct,
        popularity,
        artist_popularity: artistPop,
        artist_followers: artistFollowers,
        artist_genres: artistGenres,
        niche_fit: nicheFit,
        release_date: releaseDate,
        age_days_in_playlist: ageDays,
        // proteção
        is_protected: !!protectedInfo,
        protected_campaign_id: protectedInfo?.campaign_id ?? null,
        protected_campaign_status: protectedInfo?.campaign_status ?? null,
        protected_planned_streams: protectedInfo?.planned_streams ?? null,
        // legacy fields (mantidos null pra compat)
        streams_28d: null,
        growth_28d_pct: null,
        saturation_index: nichePlaylistCount > 0 ? saturationPct / 100 : null,
        momentum: null,
        confidence: popularity != null ? 1 : null,
      };
    });

    // 4.b) Distribuição inteligente dentro das zonas — evita colisão/empilhamento
    // Agrupa por (status, best_zone) e espalha target_position naturalmente.
    // Ordem dentro do grupo:
    //   promote → maior popularity primeiro (pega a melhor posição da zona)
    //   demote  → quem está mais próximo do topo primeiro (sai mais cedo)
    const reorderGroups = new Map<string, any[]>();
    for (const t of tracksAnalysis) {
      if ((t.status === "promote" || t.status === "demote") && t.target_position != null) {
        const key = `${t.status}:${t.best_zone}`;
        if (!reorderGroups.has(key)) reorderGroups.set(key, []);
        reorderGroups.get(key)!.push(t);
      }
    }
    for (const [key, group] of reorderGroups) {
      const [status, zone] = key.split(":") as ["promote" | "demote", Zone];
      group.sort((a, b) => status === "promote"
        ? (b.popularity ?? 0) - (a.popularity ?? 0)
        : (a.position ?? 0) - (b.position ?? 0));
      const positions = distributeInZone(zone, group.length);
      group.forEach((t, i) => { t.target_position = positions[i]; });
    }

    // 5) Artistas presentes na playlist
    const presentArtists = new Set<string>(
      (currentTracks ?? [])
        .map((t: any) => String(t.artist_name ?? "").split(",")[0].trim().toLowerCase())
        .filter(Boolean),
    );
    const missingArtists = genreArtistsTop
      .filter((a) => !presentArtists.has(a.artist.toLowerCase()))
      .slice(0, 10);

    // 6) Resumo

    const counts = {
      total: totalTracks,
      keep: tracksAnalysis.filter((x) => x.status === "keep").length,
      remove: tracksAnalysis.filter((x) => x.status === "remove").length,
      promote: tracksAnalysis.filter((x) => x.status === "promote").length,
      demote: tracksAnalysis.filter((x) => x.status === "demote").length,
      protected: tracksAnalysis.filter((x) => x.status === "protected").length,
    };
    const saturatedCount = tracksAnalysis.filter((x) => x.saturation_pct >= 70).length;
    const noDataCount = tracksAnalysis.filter((x) => x.popularity == null).length;

    // Distribuição editorial por zona (atual vs. ideal)
    const zoneCurrent = { anchor: 0, premium: 0, support: 0, tail: 0 } as Record<Zone, number>;
    const zoneBest    = { anchor: 0, premium: 0, support: 0, tail: 0 } as Record<Zone, number>;
    for (const tr of tracksAnalysis) {
      zoneCurrent[tr.current_zone as Zone]++;
      zoneBest[tr.best_zone as Zone]++;
    }
    const anchorHasEligible = tracksAnalysis.some(
      (tr) => tr.current_zone === "anchor" && tr.anchor_eligible,
    );
    const anchorMisuse = tracksAnalysis.filter(
      (tr) => tr.current_zone === "anchor" && !tr.anchor_eligible && tr.status !== "protected",
    ).length;

    const tracksSummary = {
      ...counts,
      saturated: saturatedCount,
      saturated_pct: totalTracks ? Math.round((saturatedCount / totalTracks) * 100) : 0,
      no_data: noDataCount,
      missing_artists: missingArtists,
      niche_playlist_count: nichePlaylistCount,
      zone_current: zoneCurrent,
      zone_best: zoneBest,
      anchor_has_eligible: anchorHasEligible,
      anchor_misuse: anchorMisuse,
    };

    // 7) Sugestões de faixas a ADICIONAR — CAMADA 3: por FUNÇÃO EDITORIAL, não popularidade pura.
    //    A lógica passa de "o que tá quente no nicho" para "o que cumpre a função de cada zona".
    //    Cada sugestão carrega:
    //      - target_zone: em qual zona ela deveria entrar
    //      - function_role: qual papel ela cumpre (fachada, impulsionamento, sustentação, descoberta)
    //      - replaces_track_id/name: se é substituição direta de uma faixa que está saindo
    //      - suggested_position: posição calculada pela zona-alvo
    const currentIds = new Set(trackIds);
    const missingArtistSet = new Set(missingArtists.map((a) => a.artist.toLowerCase()));
    // Pool de sugestões — escala quando a playlist está subdimensionada vs benchmark do nicho
    const benchP50Pool = Number(benchmark?.tracks_p50 ?? 0);
    const undersizeGapPool = benchP50Pool > 0 ? Math.max(0, benchP50Pool - totalTracks) : 0;
    // Quando a playlist está sub-dimensionada vs benchmark, sugerimos até o gap inteiro (cap 80)
    const N_SUGGEST = Math.max(15, Math.min(undersizeGapPool + 5, 80));

    // 7.a) Top candidatas brutas (por recorrência) — limitamos antes de gastar API Spotify
    const rawCandidates = Array.from(genreRecurrence.entries())
      .filter(([id]) => !currentIds.has(id))
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, Math.max(120, N_SUGGEST * 2));

    // 7.a.bis) TRENDING SIGNAL — cruza candidatos com Top 200 BR enriquecido.
    //   - Marca cada candidato existente com a posição no chart (boost de score)
    //   - Injeta tracks do Top 50 BR que ainda não estão na lista, DESDE que o
    //     artista já apareça no pool do nicho (gate de gênero — evita poluir
    //     uma playlist de samba com funk só porque tá no chart).
    const trendingMap = new Map<string, { position: number; popularity: number | null; cover: string | null; artist_id: string | null }>();
    try {
      const { data: chartRows } = await supabase
        .from("raw_chart_daily")
        .select("position, spotify_track_id, popularity, cover_url, spotify_artist_id, artist, track")
        .eq("chart_name", "top200_br")
        .gte("chart_date", new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10))
        .order("chart_date", { ascending: false })
        .order("position", { ascending: true })
        .limit(200);
      const seenChart = new Set<string>();
      for (const row of chartRows ?? []) {
        if (!row.spotify_track_id || seenChart.has(row.spotify_track_id)) continue;
        seenChart.add(row.spotify_track_id);
        trendingMap.set(row.spotify_track_id, {
          position: row.position,
          popularity: row.popularity ?? null,
          cover: row.cover_url ?? null,
          artist_id: row.spotify_artist_id ?? null,
        });
      }

      // Injeta tracks do Top 50 ainda ausentes — gate por presença de artista no nicho
      const nicheArtists = new Set<string>();
      for (const v of genreRecurrence.values()) {
        const main = String(v.artist_name ?? "").split(",")[0].trim().toLowerCase();
        if (main) nicheArtists.add(main);
      }
      const existingIds = new Set(rawCandidates.map((c) => c.id));
      let injected = 0;
      for (const row of chartRows ?? []) {
        if (injected >= 15) break;
        if (!row.spotify_track_id || row.position > 50) continue;
        if (currentIds.has(row.spotify_track_id) || existingIds.has(row.spotify_track_id)) continue;
        const mainArtist = String(row.artist ?? "").split(",")[0].trim().toLowerCase();
        if (!mainArtist || !nicheArtists.has(mainArtist)) continue;
        rawCandidates.push({
          id: row.spotify_track_id,
          track_name: row.track ?? "—",
          artist_name: row.artist ?? "—",
          count: 3, // sinal de recorrência sintético (baixo, mas presente)
        } as any);
        existingIds.add(row.spotify_track_id);
        injected++;
      }
    } catch (_e) { /* degrade — trending é bonus, não bloqueia diagnóstico */ }


    // 7.b) Busca meta Spotify dos candidatos (popularity + artista) pra calcular zone scores
    const candMeta = new Map<string, { popularity: number | null; artistPop: number | null; cover: string | null }>();
    const coverMap = new Map<string, string>();
    if (rawCandidates.length > 0) {
      tel.start("spotify_candidates_tracks_and_artists");
      try {
        const token = await getSpotifyToken();
        const candArtistIds = new Map<string, string>(); // trackId → artistId
        for (let i = 0; i < rawCandidates.length; i += 50) {
          const ids = rawCandidates.slice(i, i + 50).map((c) => c.id);
          const r = await guardedSpotifyFetch(`https://api.spotify.com/v1/tracks?ids=${ids.join(",")}`, { headers: { Authorization: `Bearer ${token}` } }, { playlist_id: pl.id, owner_id: ownerSpotifyId, spotify_user_id: ownerSpotifyId, function_name: 'diagnose-managed-playlist' });
          tel.noteSpotifyStatus(r.status);
          if (r.status === 403) run403s++;
          if (!r.ok) continue;
          const j = await r.json();
          for (const tr of j.tracks ?? []) {
            if (!tr?.id) continue;
            const imgs = tr.album?.images ?? [];
            const cover = imgs[0]?.url ?? imgs[imgs.length - 1]?.url ?? null;
            if (cover) coverMap.set(tr.id, cover);
            candMeta.set(tr.id, {
              popularity: typeof tr.popularity === "number" ? tr.popularity : null,
              artistPop: null,
              cover,
            });
            if (tr.artists?.[0]?.id) candArtistIds.set(tr.id, tr.artists[0].id);
          }
        }
        const uniqueArtistIds = uniq(Array.from(candArtistIds.values()));
        const artistPopMap = new Map<string, number | null>();
        for (let i = 0; i < uniqueArtistIds.length; i += 50) {
          const ids = uniqueArtistIds.slice(i, i + 50);
          const r = await guardedSpotifyFetch(`https://api.spotify.com/v1/artists?ids=${ids.join(",")}`, { headers: { Authorization: `Bearer ${token}` } }, { playlist_id: pl.id, owner_id: ownerSpotifyId, spotify_user_id: ownerSpotifyId, function_name: 'diagnose-managed-playlist' });
          tel.noteSpotifyStatus(r.status);
          if (r.status === 403) run403s++;
          if (!r.ok) continue;
          const j = await r.json();
          for (const ar of j.artists ?? []) {
            if (!ar?.id) continue;
            artistPopMap.set(ar.id, typeof ar.popularity === "number" ? ar.popularity : null);
          }
        }
        for (const [tid, aid] of candArtistIds.entries()) {
          const cur = candMeta.get(tid);
          if (cur) cur.artistPop = artistPopMap.get(aid) ?? null;
        }
        tel.end("spotify_candidates_tracks_and_artists", "ok", `${candMeta.size} cands · ${uniqueArtistIds.length} artistas`);
      } catch (e) {
        tel.noteThrow(e);
        tel.end("spotify_candidates_tracks_and_artists", "error", (e as Error)?.message);
        if (e instanceof SpotifyCircuitOpenError) throw e;
        // outras falhas: degrade gracefully
      }
    } else {
      tel.skip("spotify_candidates_tracks_and_artists", "sem candidatos");
    }


    // 7.c) Calcula scores por zona pra cada candidato (mesma fórmula da camada 2)
    type Candidate = {
      spotify_track_id: string;
      nome: string;
      artista: string;
      count: number;
      from_missing_artist: boolean;
      popularity: number | null;
      artist_popularity: number | null;
      cover_url: string | null;
      zone_scores: { anchor: number; premium: number; support: number; tail: number };
      anchor_eligible: boolean;
      target_zone: Zone;
      function_role: string;
      trending_position: number | null;
      score: number;
    };
    const ROLE_LABEL: Record<Zone, string> = {
      anchor: "fachada · hit dominante",
      premium: "impulsionamento · zona principal",
      support: "sustentação · retenção",
      tail: "descoberta · catálogo",
    };
    const candidates: Candidate[] = rawCandidates.map((c) => {
      const m = candMeta.get(c.id);
      const trend = trendingMap.get(c.id) ?? null;
      // Se o Spotify não devolveu cover (ex: track injetada via chart), usa cover do chart.
      const popularity = m?.popularity ?? trend?.popularity ?? null;
      const artistPop = m?.artistPop ?? null;
      const cover = m?.cover ?? trend?.cover ?? null;
      const pop = popularity ?? 0;
      const aPop = artistPop ?? 0;
      const recNorm = Math.min(100, c.count * 12);
      // Sem release_date para candidatos — assumimos freshness neutra
      const freshness = 50;
      const stability = 50;
      const mainArtist = String(c.artist_name ?? "").split(",")[0].trim().toLowerCase();
      const isDominantArtist = mainArtist.length > 0 && dominantArtists.has(mainArtist);
      const dominantBoost = isDominantArtist ? 20 : 0;
      // Trending boost: #1-10 = +25, #11-25 = +15, #26-50 = +10, #51-200 = +5
      const trendingBoost = trend
        ? (trend.position <= 10 ? 25 : trend.position <= 25 ? 15 : trend.position <= 50 ? 10 : 5)
        : 0;
      const anchorScore  = Math.round(pop * 0.5  + aPop * 0.3  + recNorm * 0.2) + dominantBoost + trendingBoost;
      const premiumScore = Math.round(pop * 0.4  + recNorm * 0.35 + freshness * 0.25) + trendingBoost;
      const supportScore = Math.round(recNorm * 0.5 + pop * 0.3 + stability * 0.2);
      const tailScore    = Math.round(freshness * 0.5 + Math.max(0, 60 - pop) * 0.3 + recNorm * 0.2);
      // Mesmo critério do tracksAnalysis: dominante do nicho passa com pop ≥ 55
      const anchorEligible =
        (popularity != null && popularity >= 70 && (aPop >= 70 || c.count >= 5)) ||
        (isDominantArtist && popularity != null && popularity >= 55) ||
        (trend != null && trend.position <= 25); // top 25 chart já é anchor-eligible

      const zonePool: { z: Zone; v: number }[] = [
        { z: "premium", v: premiumScore },
        { z: "support", v: supportScore },
        { z: "tail",    v: tailScore },
      ];
      if (anchorEligible) zonePool.push({ z: "anchor", v: anchorScore + 5 });
      zonePool.sort((a, b) => b.v - a.v);
      const targetZone = zonePool[0].z;

      const fromMissing = !!(mainArtist && missingArtistSet.has(mainArtist));
      // Score global combinando função + recorrência + boost de artista faltando + boost dominante + trending
      const composite = Math.round(zonePool[0].v * 0.7 + recNorm * 0.3)
        + (fromMissing ? 8 : 0)
        + (isDominantArtist ? 10 : 0)
        + trendingBoost;

      return {
        spotify_track_id: c.id,
        nome: c.track_name ?? "—",
        artista: c.artist_name ?? "—",
        count: c.count,
        from_missing_artist: fromMissing,
        popularity,
        artist_popularity: artistPop,
        cover_url: cover,
        zone_scores: { anchor: anchorScore, premium: premiumScore, support: supportScore, tail: tailScore },
        anchor_eligible: anchorEligible,
        target_zone: targetZone,
        function_role: ROLE_LABEL[targetZone],
        trending_position: trend?.position ?? null,
        score: composite,
      };
    });


    // 7.d) Pareia substituições — cada faixa que SAI (remove/demote) ganha a melhor candidata
    //      que cumpre a MESMA função na zona-alvo da saída.
    const exitSlots = tracksAnalysis
      .filter((t) => t.status === "remove" || t.status === "demote")
      .map((t) => ({
        track_id: t.spotify_track_id,
        track_name: t.track_name,
        artist_name: t.artist_name,
        position: t.position,
        // Para remove: vaga na zona atual. Para demote: a vaga liberada também é na zona atual.
        slot_zone: t.current_zone as Zone,
      }));

    const usedCandidateIds = new Set<string>();
    const substitutions = exitSlots.map((slot) => {
      // Candidatas que se encaixam na MESMA zona que ficou vaga, ordenadas pelo score daquela zona
      const fit = candidates
        .filter((c) => !usedCandidateIds.has(c.spotify_track_id) && c.target_zone === slot.slot_zone)
        .sort((a, b) => b.zone_scores[slot.slot_zone] - a.zone_scores[slot.slot_zone]);
      const pick = fit[0] ?? null;
      if (pick) usedCandidateIds.add(pick.spotify_track_id);
      return {
        replaces_track_id: slot.track_id,
        replaces_track_name: slot.track_name,
        replaces_artist_name: slot.artist_name,
        replaces_position: slot.position,
        slot_zone: slot.slot_zone,
        slot_zone_label: ZONE_LABELS[slot.slot_zone],
        candidate: pick ? {
          spotify_track_id: pick.spotify_track_id,
          nome: pick.nome,
          artista: pick.artista,
          cover_url: pick.cover_url,
          popularity: pick.popularity,
          recurrence_in_genre: pick.count,
          zone_fit_score: pick.zone_scores[slot.slot_zone],
          function_role: pick.function_role,
          from_missing_artist: pick.from_missing_artist,
          trending_position: pick.trending_position,
          suggested_position: slot.position, // assume a vaga liberada
        } : null,

      };
    });

    // 7.e) Sugestões restantes — distribui pelo DEFICIT de cada zona.
    //      Meta de tamanho da playlist = benchmark.tracks_p50 do nicho (e não o tamanho atual).
    //      Sub-dimensionada → cauda vira a zona com mais deficit.
    const targetSize = benchP50Pool > 0 ? benchP50Pool : Math.max(totalTracks, 12);
    const zoneIdeal: Record<Zone, number> = {
      anchor: 2,
      premium: 4,
      support: 6,
      tail: Math.max(0, targetSize - 12),
    };
    const deficits: Record<Zone, number> = {
      anchor: Math.max(0, zoneIdeal.anchor - (zoneCurrent.anchor ?? 0)),
      premium: Math.max(0, zoneIdeal.premium - (zoneCurrent.premium ?? 0)),
      support: Math.max(0, zoneIdeal.support - (zoneCurrent.support ?? 0)),
      tail: Math.max(0, zoneIdeal.tail - (zoneCurrent.tail ?? 0)),
    };

    const remainingCandidates = candidates
      .filter((c) => !usedCandidateIds.has(c.spotify_track_id))
      .sort((a, b) => b.score - a.score);

    const extraSuggestions: any[] = [];
    const remainingByZone: Record<Zone, Candidate[]> = { anchor: [], premium: [], support: [], tail: [] };
    for (const c of remainingCandidates) remainingByZone[c.target_zone].push(c);

    for (const zone of ZONE_ORDER) {
      const need = deficits[zone];
      if (!need) continue;
      const picks = remainingByZone[zone].slice(0, need);
      for (const p of picks) {
        usedCandidateIds.add(p.spotify_track_id);
        extraSuggestions.push({
          spotify_track_id: p.spotify_track_id,
          nome: p.nome,
          artista: p.artista,
          cover_url: p.cover_url,
          count: p.count,
          popularity: p.popularity,
          from_missing_artist: p.from_missing_artist,
          trending_position: p.trending_position,
          target_zone: zone,
          target_zone_label: ZONE_LABELS[zone],
          function_role: p.function_role,
          zone_fit_score: p.zone_scores[zone],
          suggested_position: zoneMiddle(zone),
          fills_deficit: true,
          score: p.score,
        });

      }
    }

    // 7.f) Completa até N_SUGGEST com top score livre, mantendo função
    if (extraSuggestions.length + substitutions.filter((s) => s.candidate).length < N_SUGGEST) {
      const stillNeed = N_SUGGEST - extraSuggestions.length - substitutions.filter((s) => s.candidate).length;
      const fillers = candidates
        .filter((c) => !usedCandidateIds.has(c.spotify_track_id))
        .sort((a, b) => b.score - a.score)
        .slice(0, stillNeed);
      for (const p of fillers) {
        usedCandidateIds.add(p.spotify_track_id);
        extraSuggestions.push({
          spotify_track_id: p.spotify_track_id,
          nome: p.nome,
          artista: p.artista,
          cover_url: p.cover_url,
          count: p.count,
          popularity: p.popularity,
          from_missing_artist: p.from_missing_artist,
          trending_position: p.trending_position,
          target_zone: p.target_zone,
          target_zone_label: ZONE_LABELS[p.target_zone],
          function_role: p.function_role,
          zone_fit_score: p.zone_scores[p.target_zone],
          suggested_position: zoneMiddle(p.target_zone),
          fills_deficit: false,
          score: p.score,
        });

      }
    }

    // Lista final consolidada (substituições + adições por deficit/score)
    const tracksSuggestions = [
      ...substitutions
        .filter((s) => s.candidate)
        .map((s) => ({
          spotify_track_id: s.candidate!.spotify_track_id,
          nome: s.candidate!.nome,
          artista: s.candidate!.artista,
          cover_url: s.candidate!.cover_url,
          count: s.candidate!.recurrence_in_genre,
          popularity: s.candidate!.popularity,
          from_missing_artist: s.candidate!.from_missing_artist,
          trending_position: s.candidate!.trending_position,
          target_zone: s.slot_zone,
          target_zone_label: s.slot_zone_label,
          function_role: s.candidate!.function_role,
          zone_fit_score: s.candidate!.zone_fit_score,
          suggested_position: s.candidate!.suggested_position,
          replaces_track_id: s.replaces_track_id,
          replaces_track_name: s.replaces_track_name,
          replaces_artist_name: s.replaces_artist_name,
          fills_deficit: false,
          is_substitution: true,
          score: s.candidate!.zone_fit_score,
        })),

      ...extraSuggestions,
    ];

    // 7.g) Dedup de sugestões por spotify_track_id — uma faixa não pode aparecer
    // como substituição E adição ao mesmo tempo. Substituição tem prioridade
    // (já está ligada a uma remoção). Ordem original preservada.
    {
      const seenSugIds = new Set<string>();
      for (let i = tracksSuggestions.length - 1; i >= 0; i--) {
        const id = tracksSuggestions[i]?.spotify_track_id;
        if (!id) continue;
        if (seenSugIds.has(id)) tracksSuggestions.splice(i, 1);
        else seenSugIds.add(id);
      }
    }

    // 7.h) Distribuição inteligente de suggested_position nas adições — mesma lógica
    // do reorder: agrupa por target_zone e espalha pra evitar empilhamento.
    {
      const sugGroups = new Map<Zone, any[]>();
      for (const s of tracksSuggestions) {
        const z = s.target_zone as Zone;
        if (!z) continue;
        if (!sugGroups.has(z)) sugGroups.set(z, []);
        sugGroups.get(z)!.push(s);
      }
      for (const [zone, group] of sugGroups) {
        group.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        const positions = distributeInZone(zone, group.length);
        group.forEach((s, i) => { s.suggested_position = positions[i]; });
      }
    }


    // Adiciona contagem ao summary pra UI exibir KPI "ADICIONAR"
    (tracksSummary as any).add = tracksSuggestions.length;
    (tracksSummary as any).add_from_missing = tracksSuggestions.filter((t: any) => t.from_missing_artist).length;
    (tracksSummary as any).add_trending = tracksSuggestions.filter((t: any) => t.trending_position != null).length;
    (tracksSummary as any).substitutions = substitutions.filter((s) => s.candidate).length;
    (tracksSummary as any).zone_deficits = deficits;
    (tracksSummary as any).zone_ideal = zoneIdeal;


    // 8) Análise de nome (igual ao anterior)
    const nameLower = (pl.name ?? "").toLowerCase();
    const keywords: string[] = Array.isArray(model?.palavras_chave)
      ? model.palavras_chave
          .map((k: any) => (typeof k === "string" ? k : (k?.value ?? k?.termo ?? "")))
          .filter(Boolean)
      : [];
    const topKeywords = keywords.slice(0, 10);
    const present = topKeywords.filter((k) => nameLower.includes(k.toLowerCase()));
    const missing = topKeywords.filter((k) => !nameLower.includes(k.toLowerCase())).slice(0, 8);
    const nameScore = topKeywords.length > 0 ? Math.round((present.length / topKeywords.length) * 100) : null;
    const nameReasons: any[] = missing.map((k) => ({ type: "missing_keyword", value: k }));
    if (benchmark?.tracks_p50 && totalTracks > 0) {
      if (totalTracks > benchmark.tracks_p90) {
        nameReasons.push({ type: "too_many_tracks", value: totalTracks, benchmark_p90: benchmark.tracks_p90 });
      } else if (totalTracks < benchmark.tracks_p50 / 2) {
        nameReasons.push({ type: "too_few_tracks", value: totalTracks, benchmark_p50: benchmark.tracks_p50 });
      }
    }
    const nameSuggestion = missing.length > 0
      ? `${pl.name} ${missing.slice(0, 2).map((k) => k.toUpperCase()).join(" ")}`
      : null;

    // 8.b) Sugestão de DESCRIÇÃO — combina template do nicho + palavras faltando
    const descLower = (pl.description ?? "").toLowerCase();
    const missingInDesc = topKeywords
      .filter((k) => !descLower.includes(k.toLowerCase()))
      .slice(0, 5);
    const descTemplate: string | null = model?.insights?.descricao_padrao
      ?? model?.insights?.descricao
      ?? null;
    let suggestedDescription: string | null = null;
    if (descTemplate) {
      suggestedDescription = String(descTemplate);
    } else if (missingInDesc.length > 0) {
      // Template genérico: nome do nicho + palavras quentes + chamada
      const hot = missingInDesc.slice(0, 4).join(" · ");
      suggestedDescription = `As ${totalTracks} mais tocadas · ${hot} · atualizada toda semana`;
    }

    // 8.b.AI) Refino editorial via Lovable AI — gera título e descrição naturais.
    // Algoritmo acima vira baseline/fallback automático.
    const algoName = nameSuggestion;
    const algoDescription = suggestedDescription;
    let aiCopy: EditorialCopy | null = null;
    let aiError: string | null = null;
    tel.start("ai_editorial_copy");
    try {
      aiCopy = await generateEditorialCopy({
        skipAi,
        currentName: pl.name,
        currentDescription: pl.description ?? null,
        genreName: (model?.insights?.nicho_nome ?? model?.insights?.nicho ?? null) as string | null,
        topKeywords,
        missingKeywords: missing,
        topArtists: genreArtistsTop.slice(0, 8).map((a) => a.artist),
        topRecurringTracks: Array.from(genreRecurrence.entries())
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 6)
          .map(([, v]) => ({ title: v.track_name ?? "", artist: v.artist_name ?? "" })),
        benchmarkSize: benchmark?.tracks_p50 ?? null,
        currentSize: totalTracks,
        competitors: competitors.slice(0, 6).map((c) => ({ name: c.name })),
      });
      tel.end("ai_editorial_copy", aiCopy ? "ok" : "skipped", aiCopy ? undefined : "sem retorno/skipAi");
    } catch (e) {
      aiError = (e as Error).message;
      tel.failures.ai_editorial_failed = true;
      tel.end("ai_editorial_copy", "error", aiError);
    }

    // Ranking BR-viral: compara TODOS os candidatos (AI + algoName + nome atual) por score
    // de SEO/CTR e escolhe o maior. Garante que nome forte nunca vire abstrato.
    const titleCandidates: string[] = [
      ...(aiCopy?.titles ?? []),
      ...(algoName ? [algoName] : []),
      pl.name, // baseline: nome atual sempre concorre
    ].filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    const nicheLeaderNames = competitors.slice(0, 8).map((c) => c.name);
    const scored = titleCandidates.map((t) => ({
      title: t,
      score: scoreTitle({
        candidate: t,
        topKeywords,
        currentName: pl.name,
        nicheLeaders: nicheLeaderNames,
      }),
    })).sort((a, b) => b.score - a.score);
    const editorialName = scored[0]?.title ?? aiCopy?.titles?.[0] ?? algoName;
    const editorialDescription = aiCopy?.descriptions?.[0] ?? algoDescription;



    // 8.c) target_position — agora vem direto da zona-alvo (calculada no passo 4),
    //      então não há mais override por popularity rank.

    // 8.d) market_insights — curadoria visual editorial (não é mais "top recorrência pura")
    // Score final =
    //   recorrencia*0.35 + recencia*0.30 + presenca_em_playlists_lideres*0.20
    //   + qualidade_visual*0.10 + (diversidade aplicada na seleção)
    // Objetivo: referências MODERNAS, com viés a últimos 90 dias e playlists líderes do nicho.
    tel.start("market_insights_visual_ranking");
    let topRecurringTracks: Array<{

      spotify_track_id: string;
      title: string | null;
      artist: string | null;
      niche_playlists_count: number;
      cover_url: string | null;
      release_date: string | null;
      leader_followers: number;
      popularity: number | null;
      editorial_score: number;
      pool_age_days: number;
      coletado_em_latest: string | null;
      score_breakdown: {
        velocityN: number;
        recenciaN: number;
        recorrenciaN: number;
        leaderRelN: number;
        visualN: number;
        final: number;
      } | null;
      last_seen_run: number | null;
    }> = [];

    try {
      // 8.d.1 — Top 40 candidatos por recorrência (pool de seleção)
      const topByRecurrence = Array.from(genreRecurrence.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 40);
      const candidateIds = topByRecurrence.map(([id]) => id).filter(Boolean);

      // 8.d.2 — Sinais por track: leader_followers (max) e recencia no nicho (último coletado_em)
      const perTrack = new Map<string, { leaderF: number; lastSeen: number }>();
      if (candidateIds.length > 0 && pl.genre_id) {
        const { data: stEnriched } = await supabase
          .from("search_tracks")
          .select("spotify_track_id, result_id, coletado_em")
          .eq("genre_id", pl.genre_id)
          .in("spotify_track_id", candidateIds);
        const resultIds = [...new Set((stEnriched ?? []).map((r: any) => r.result_id).filter(Boolean))];
        const followersMap = new Map<string, number>();
        if (resultIds.length > 0) {
          const { data: srRows } = await supabase
            .from("search_results")
            .select("id,seguidores")
            .in("id", resultIds);
          for (const r of (srRows ?? []) as any[]) followersMap.set(r.id, r.seguidores ?? 0);
        }
        for (const row of (stEnriched ?? []) as any[]) {
          if (!row.spotify_track_id) continue;
          const f = followersMap.get(row.result_id) ?? 0;
          const ts = row.coletado_em ? new Date(row.coletado_em).getTime() : 0;
          const cur = perTrack.get(row.spotify_track_id);
          if (!cur) perTrack.set(row.spotify_track_id, { leaderF: f, lastSeen: ts });
          else {
            if (f > cur.leaderF) cur.leaderF = f;
            if (ts > cur.lastSeen) cur.lastSeen = ts;
          }
        }
      }

      // 8.d.2.b — leaderRelScore: presença nas TOP-N playlists do nicho (por followers).
      // Substitui max(seguidores) — que satura em nichos pequenos.
      // Boost x1.2 (cap 100) se track aparece em snapshot recente (<30d) de alguma top-N.
      const leaderRelMap = new Map<string, { count: number; recentlyAdded: boolean }>();
      let leaderRelN_total = 0;
      let _topLeaderIds: string[] = [];
      let _missingSnapshotLeaderIds: string[] = [];
      if (candidateIds.length > 0 && pl.genre_id) {
        // top-N playlists do nicho (N = min(10, total))
        const { data: nicheRows } = await supabase
          .from("search_results")
          .select("spotify_playlist_id, seguidores")
          .eq("genre_id", pl.genre_id)
          .not("spotify_playlist_id", "is", null)
          .not("seguidores", "is", null)
          .order("seguidores", { ascending: false })
          .limit(50);
        const dedupedTop: Array<{ id: string; followers: number }> = [];
        const seenTop = new Set<string>();
        for (const r of (nicheRows ?? []) as any[]) {
          if (seenTop.has(r.spotify_playlist_id)) continue;
          seenTop.add(r.spotify_playlist_id);
          dedupedTop.push({ id: r.spotify_playlist_id, followers: r.seguidores ?? 0 });
        }
        const N = Math.min(10, dedupedTop.length);
        leaderRelN_total = N;
        const topIds = dedupedTop.slice(0, N).map((p) => p.id);
        _topLeaderIds = topIds;

        if (topIds.length > 0) {
          // 1) busca os result_ids das top-N e mapeia quais candidate tracks aparecem em cada
          const { data: topResults } = await supabase
            .from("search_results")
            .select("id, spotify_playlist_id")
            .eq("genre_id", pl.genre_id)
            .in("spotify_playlist_id", topIds);
          const resultIdToPlaylist = new Map<string, string>();
          for (const r of (topResults ?? []) as any[]) resultIdToPlaylist.set(r.id, r.spotify_playlist_id);
          const topResultIds = Array.from(resultIdToPlaylist.keys());

          if (topResultIds.length > 0) {
            const { data: stInTop } = await supabase
              .from("search_tracks")
              .select("spotify_track_id, result_id")
              .in("result_id", topResultIds)
              .in("spotify_track_id", candidateIds);
            // count playlists distintas por track
            const perTrackTopPlaylists = new Map<string, Set<string>>();
            for (const row of (stInTop ?? []) as any[]) {
              if (!row.spotify_track_id) continue;
              const pid = resultIdToPlaylist.get(row.result_id);
              if (!pid) continue;
              const s = perTrackTopPlaylists.get(row.spotify_track_id) ?? new Set<string>();
              s.add(pid);
              perTrackTopPlaylists.set(row.spotify_track_id, s);
            }
            for (const [tid, set] of perTrackTopPlaylists.entries()) {
              leaderRelMap.set(tid, { count: set.size, recentlyAdded: false });
            }
          }

          // 2) Recency boost via playlist_track_snapshots:
          //    track aparece em snapshot (<30d) de alguma top-N E não aparece
          //    em snapshot mais antigo que 30d → "recém adicionada".
          const thirtyAgoISO = new Date(Date.now() - 30 * 86400_000).toISOString();
          const { data: snapsRecent } = await supabase
            .from("playlist_track_snapshots")
            .select("playlist_spotify_id, track_ids, captured_at")
            .in("playlist_spotify_id", topIds)
            .gte("captured_at", thirtyAgoISO);
          const { data: snapsOld } = await supabase
            .from("playlist_track_snapshots")
            .select("playlist_spotify_id, track_ids")
            .in("playlist_spotify_id", topIds)
            .lt("captured_at", thirtyAgoISO);

          // Track which top leaders have NO snapshot at all (root cause of leaderRelN=0)
          const snappedIds = new Set<string>([
            ...((snapsRecent ?? []) as any[]).map((s) => s.playlist_spotify_id),
            ...((snapsOld ?? []) as any[]).map((s: any) => s.playlist_spotify_id),
          ]);
          _missingSnapshotLeaderIds = topIds.filter((id) => !snappedIds.has(id));

          const inRecent = new Set<string>();
          for (const s of (snapsRecent ?? []) as any[]) {
            for (const tid of (s.track_ids ?? [])) inRecent.add(String(tid));
          }
          const inOld = new Set<string>();
          for (const s of (snapsOld ?? []) as any[]) {
            for (const tid of (s.track_ids ?? [])) inOld.add(String(tid));
          }
          for (const tid of candidateIds) {
            if (!inRecent.has(tid)) continue;
            if (inOld.has(tid)) continue; // já existia → não é "recém adicionada"
            const cur = leaderRelMap.get(tid);
            if (cur) cur.recentlyAdded = true;
            // se não está em leaderRelMap, não tem presença em top-N → boost irrelevante
          }
        }
      }

      // 8.d.3 — Metadata Spotify (cover HD, popularity, album.id) + release_date persistido
      const meta = new Map<string, any>();
      // PERSISTED release_date (preferido — vem de search_tracks após o run-search refeito)
      const persistedReleaseDate = new Map<string, string | null>();
      if (candidateIds.length > 0 && pl.genre_id) {
        try {
          const { data: stRows } = await supabase
            .from("search_tracks")
            .select("spotify_track_id, release_date, cover_url, popularity")
            .eq("genre_id", pl.genre_id)
            .in("spotify_track_id", candidateIds);
          for (const r of (stRows ?? []) as any[]) {
            if (!r?.spotify_track_id) continue;
            persistedReleaseDate.set(String(r.spotify_track_id), r.release_date ?? null);
            // Pre-popula cover/popularity caso o /v1/tracks abaixo falhe
            if (r.cover_url && !coverMap.get(String(r.spotify_track_id))) {
              coverMap.set(String(r.spotify_track_id), r.cover_url);
            }
            if (r.popularity != null) {
              meta.set(String(r.spotify_track_id), {
                ...(meta.get(String(r.spotify_track_id)) ?? {}),
                popularity: r.popularity,
              });
            }
          }
        } catch (e) {
          console.warn("[diagnose] persisted release_date load failed", (e as Error).message);
        }
      }
      if (candidateIds.length > 0) {
        try {
          const token = await getSpotifyToken();
          for (let i = 0; i < candidateIds.length; i += 50) {
            const slice = candidateIds.slice(i, i + 50);
            const r = await guardedSpotifyFetch(`https://api.spotify.com/v1/tracks?ids=${slice.join(",")}`, { headers: { Authorization: `Bearer ${token}` } }, { playlist_id: pl.id, owner_id: ownerSpotifyId, spotify_user_id: ownerSpotifyId, function_name: 'diagnose-managed-playlist' });
          if (r.status === 403) run403s++;
            if (!r.ok) continue;
            const j = await r.json();
            for (const tr of j.tracks ?? []) {
              if (!tr?.id) continue;
              const prev = meta.get(tr.id) ?? {};
              meta.set(tr.id, { ...prev, ...tr });
              const imgs = tr.album?.images ?? [];
              const cover = imgs[0]?.url ?? imgs[imgs.length - 1]?.url ?? null;
              if (cover) coverMap.set(tr.id, cover);
            }
          }
        } catch (e) {
          if (e instanceof SpotifyCircuitOpenError) throw e;
          /* segue sem metadata extra */
        }
      }


      // 8.d.4 — Score editorial
      // Feature flag: USE_LEGACY_SCORE=true mantém pesos antigos. Default = nova fórmula.
      const useLegacyScore = (Deno.env.get("USE_LEGACY_SCORE") ?? "").toLowerCase() === "true";

      const now = Date.now();

      // === Cross-run memory: editorial_history (últimos 7 dias) ============
      // Penalidade soft no score final (não exclui) p/ evitar capas repetidas.
      const historyMap = new Map<string, number>(); // track_id → days since last run
      if (pl.genre_id) {
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
        const { data: histRows } = await supabase
          .from("editorial_history")
          .select("track_id, run_date")
          .eq("genre_id", pl.genre_id)
          .gte("run_date", sevenDaysAgo);
        for (const r of (histRows ?? []) as any[]) {
          const tid = String(r.track_id);
          const daysAgo = Math.max(
            0,
            Math.round((Date.now() - new Date(r.run_date).getTime()) / 86400_000),
          );
          const prev = historyMap.get(tid);
          if (prev == null || daysAgo < prev) historyMap.set(tid, daysAgo);
        }
      }
      // relaxFactor ∈ [0..1]: 0 = penalidade cheia, 1 = sem penalidade (fallback).
      let historyRelaxFactor = 0;
      const historyPenalty = (trackId: string): number => {
        const d = historyMap.get(trackId);
        if (d == null) return 1.0;
        let base: number;
        if (d <= 1) base = 0.70;
        else if (d <= 3) base = 0.85;
        else if (d <= 7) base = 0.95;
        else base = 1.0;
        return base + (1 - base) * historyRelaxFactor;
      };

      // Legacy: bônus por release_date (mantido p/ A/B)
      const legacyTemporalBonus = (ageDays: number | null): number => {
        if (ageDays == null) return 45;
        if (ageDays <= 90) return 100;
        if (ageDays <= 180) return 70;
        if (ageDays <= 365) return 45;
        if (ageDays <= 730) return 20;
        return 5;
      };
      // NEW: buckets mais finos (release_date)
      const recenciaBuckets = (ageDays: number | null): number => {
        if (ageDays == null) return 40;          // neutro p/ sem release_date
        if (ageDays <= 30) return 100;
        if (ageDays <= 90) return 85;
        if (ageDays <= 180) return 65;
        if (ageDays <= 365) return 40;
        if (ageDays <= 730) return 20;
        return 5;
      };

      const qualityVisual = (t: any): number => {
        // Proxy de qualidade/estética moderna sem CV:
        // capa HD presente + popularity (sinal de relevância atual no Spotify).
        let q = 0;
        if (t.cover_url) q += 50;
        if (typeof t.popularity === "number") q += Math.min(50, t.popularity / 2);
        return q;
      };

      // NEW: trend velocity por track (genre_trends, janela 7d).
      // Staleness guard: se >80% do pool tem updated_at > 7d (ou sem row),
      // sinal é considerado stale e cai pra neutro (20) pra todos.
      const velocityMap = new Map<string, number>(); // track_id → velocity
      let velocityStale = false;
      if (!useLegacyScore && candidateIds.length > 0 && pl.genre_id) {
        const sevenDaysAgoISO = new Date(Date.now() - 7 * 86400_000).toISOString();
        const { data: trendRows } = await supabase
          .from("genre_trends")
          .select("track_id, velocity, updated_at")
          .eq("genre_id", pl.genre_id)
          .in("track_id", candidateIds)
          .gte("updated_at", sevenDaysAgoISO);
        for (const r of (trendRows ?? []) as any[]) {
          if (r.track_id != null && r.velocity != null) {
            velocityMap.set(String(r.track_id), Number(r.velocity));
          }
        }
        const freshPct = velocityMap.size / candidateIds.length;
        if (freshPct < 0.2) {
          velocityStale = true;
          const stalePct = Math.round((1 - freshPct) * 100);
          console.warn(`[WARN] velocity_signal_stale: pool=${pl.genre_id}, stale_pct=${stalePct}%`);
        }
      }
      const velocityScore = (trackId: string): number => {
        if (velocityStale) return 20;                                   // fallback global neutral
        const v = velocityMap.get(trackId);
        if (v == null) return 20;                                       // neutral (no signal ≠ zero)
        if (v >= 2.5) return 100;
        if (v >= 1.5) return 50 + ((v - 1.5) / 1.0) * 50;               // linear 50→100
        return 0;
      };

      const enriched = topByRecurrence.map(([id, v]) => {
        const m = meta.get(id);
        const sig = perTrack.get(id);
        // Prefer persisted release_date (search_tracks) → API meta → null.
        const persisted = persistedReleaseDate.get(id) ?? null;
        const apiRelease: string | null = m?.album?.release_date ?? null;
        const releaseDate: string | null = persisted ?? apiRelease ?? null;
        const release_date_source: "persisted" | "spotify_api" | "missing" =
          persisted ? "persisted" : apiRelease ? "spotify_api" : "missing";
        const ageDays = releaseDate
          ? Math.max(0, (now - new Date(releaseDate).getTime()) / 86400000)
          : null;
        return {
          spotify_track_id: id,
          title: v.track_name,
          artist: v.artist_name,
          niche_count: v.count,
          leader_followers: sig?.leaderF ?? 0,
          cover_url: coverMap.get(id) ?? null,
          album_id: m?.album?.id ?? null,
          release_date: releaseDate,
          release_date_source,
          popularity: typeof m?.popularity === "number" ? m.popularity : null,
          _ageDays: ageDays,
        };
      });


      const maxNiche = Math.max(1, ...enriched.map((t) => t.niche_count));
      const maxLeaderF = Math.max(1, ...enriched.map((t) => t.leader_followers)); // mantido p/ payload legacy/cockpit
      const computeScored = () => enriched.map((t) => {
        // recorrência sobre pool 90d já filtrado (vide prompt 2)
        const recorrenciaN = (t.niche_count / maxNiche) * 100;

        // leaderRelN: presença nas top-N playlists do nicho (substitui max-absoluto).
        // Fallback (sem dados): mantém método legado normalizado por max-followers.
        let leaderRelN: number;
        if (leaderRelN_total > 0) {
          const lr = leaderRelMap.get(t.spotify_track_id);
          const base = lr ? (lr.count / leaderRelN_total) * 100 : 0;
          leaderRelN = lr?.recentlyAdded ? Math.min(100, base * 1.2) : base;
        } else {
          leaderRelN = (t.leader_followers / maxLeaderF) * 100;
        }

        // Legacy score continua usando o leaderN antigo (max-followers) p/ A/B fiel.
        const leaderN_legacy = (t.leader_followers / maxLeaderF) * 100;

        const visualN = qualityVisual(t);

        let recenciaN: number;
        let velocityN: number;
        let finalRaw: number;
        if (useLegacyScore) {
          recenciaN = legacyTemporalBonus(t._ageDays);
          velocityN = 0;
          finalRaw =
            recorrenciaN * 0.35 +
            recenciaN * 0.30 +
            leaderN_legacy * 0.20 +
            visualN * 0.10;
        } else {
          recenciaN = recenciaBuckets(t._ageDays);
          velocityN = velocityScore(t.spotify_track_id);
          finalRaw =
            velocityN * 0.35 +
            recenciaN * 0.25 +
            recorrenciaN * 0.15 +
            leaderRelN * 0.15 +
            visualN * 0.10;
        }
        // Cross-run memory penalty (soft, relaxável)
        const penalty = historyPenalty(t.spotify_track_id);
        const final = finalRaw * penalty;
        return {
          ...t,
          _final: final,
          _breakdown: {
            velocityN: Math.round(velocityN),
            recenciaN: Math.round(recenciaN),
            recorrenciaN: Math.round(recorrenciaN),
            leaderRelN: Math.round(leaderRelN),
            visualN: Math.round(visualN),
            final: Math.round(final),
            release_date_source: t.release_date_source,
          },
        };

      }).sort((a, b) => b._final - a._final);

      const pickEight = (sortedScored: ReturnType<typeof computeScored>) => {
        const seenAlbums = new Set<string>();
        const seenCovers = new Set<string>();
        const artistCount = new Map<string, number>();
        const out: ReturnType<typeof computeScored> = [];
        let lastArtist: string | null = null;
        for (const t of sortedScored) {
          if (out.length >= 8) break;
          if (!t.cover_url) continue; // grid visual: sem capa, fora
          const album = t.album_id ?? "";
          const cover = t.cover_url ?? "";
          const artistKey = (t.artist ?? "").toLowerCase().split(",")[0].trim();
          if (album && seenAlbums.has(album)) continue;
          if (cover && seenCovers.has(cover)) continue;
          if (artistKey && (artistCount.get(artistKey) ?? 0) >= 2) continue;
          if (artistKey && artistKey === lastArtist) continue;
          out.push(t);
          if (album) seenAlbums.add(album);
          if (cover) seenCovers.add(cover);
          if (artistKey) artistCount.set(artistKey, (artistCount.get(artistKey) ?? 0) + 1);
          lastArtist = artistKey || lastArtist;
        }
        // Fallback diversidade: nichos pequenos
        if (out.length < 8) {
          for (const t of sortedScored) {
            if (out.length >= 8) break;
            if (out.includes(t)) continue;
            if (!t.cover_url) continue;
            out.push(t);
          }
        }
        return out;
      };

      let scored = computeScored();
      if (scored.length > 0 && scored.every((t: any) => (t._breakdown?.leaderRelN ?? 0) === 0)) {
        console.warn(
          `[INFO] leaderRelN_zero: genre=${pl.genre_id} ` +
          `snapshots_missing=${_missingSnapshotLeaderIds.length} ` +
          `top_leaders=${_topLeaderIds.slice(0, 3).join(",")}`,
        );
      }
      let picked = pickEight(scored);
      // Fallback: se penalidade derrubou demais e ficou < 8, relaxa progressivamente.
      const relaxSteps = [0.33, 0.66, 1.0];
      for (const step of relaxSteps) {
        if (picked.length >= 8) break;
        historyRelaxFactor = step;
        scored = computeScored();
        picked = pickEight(scored);
        console.info(
          `[INFO] history_penalty_relaxed: genre=${pl.genre_id}, ` +
          `relax=${step}, unique_available=${picked.length}`,
        );
      }

      const ageDaysFromIso = (iso: string | null): number => {
        if (!iso) return Number.POSITIVE_INFINITY;
        return Math.round((Date.now() - new Date(iso).getTime()) / 86400_000);
      };

      topRecurringTracks = picked.map((t) => {
        const rec = genreRecurrence.get(t.spotify_track_id);
        const latest = rec?.latest_coletado_em ?? null;
        const lastSeen = historyMap.get(t.spotify_track_id);
        return {
          spotify_track_id: t.spotify_track_id,
          title: t.title,
          artist: t.artist,
          niche_playlists_count: t.niche_count,
          cover_url: t.cover_url,
          release_date: t.release_date,
          leader_followers: t.leader_followers,
          popularity: t.popularity,
          editorial_score: Math.round(t._final),
          pool_age_days: ageDaysFromIso(latest),
          coletado_em_latest: latest,
          score_breakdown: t._breakdown ?? null,
          last_seen_run: lastSeen ?? null,
        };
      });

      // Persiste escolhas em editorial_history (cross-run memory).
      if (pl.genre_id && picked.length > 0) {
        try {
          const rows = picked.map((t, idx) => {
            const rec = genreRecurrence.get(t.spotify_track_id);
            return {
              genre_id: pl.genre_id,
              track_id: t.spotify_track_id,
              position: idx + 1,
              score_final: Math.round(t._final * 100) / 100,
              track_name: t.title ?? rec?.track_name ?? null,
              artist_name: t.artist ?? rec?.artist_name ?? null,
              cover_url: t.cover_url ?? coverMap.get(t.spotify_track_id) ?? null,
              release_date: t.release_date ?? null,
            };
          });
          const { error: ehErr } = await supabase.from("editorial_history").insert(rows);
          if (ehErr) console.warn("[diagnose] editorial_history insert err", ehErr);
        } catch (e) {
          console.warn("[diagnose] editorial_history insert failed", e);
        }
      }
    } catch (e) {
      console.error("[diagnose] visual ranking failed, falling back to legacy", e);
      // Fallback: top 8 por recorrência pura (compat com UI)
      const fb = Array.from(genreRecurrence.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 8);
      topRecurringTracks = fb.map(([id, v]) => ({
        spotify_track_id: id,
        title: v.track_name,
        artist: v.artist_name,
        niche_playlists_count: v.count,
        cover_url: coverMap.get(id) ?? null,
        release_date: null,
        leader_followers: 0,
        popularity: null,
        editorial_score: 0,
        pool_age_days: v.latest_coletado_em
          ? Math.round((Date.now() - new Date(v.latest_coletado_em).getTime()) / 86400_000)
          : Number.POSITIVE_INFINITY,
        coletado_em_latest: v.latest_coletado_em ?? null,
        score_breakdown: null,
        last_seen_run: null,
      }));
    }
    tel.end("market_insights_visual_ranking", "ok", `${topRecurringTracks.length} tracks`);

    const marketInsights = {
      ideal_track_count_range: benchmark

        ? [benchmark.tracks_p50, benchmark.tracks_p90].filter((x: any) => x != null)
        : null,
      followers_p50: benchmark?.followers_p50 ?? null,
      followers_p75: benchmark?.followers_p75 ?? null,
      followers_p90: benchmark?.followers_p90 ?? null,
      avg_saturation_pct: tracksAnalysis.length
        ? Math.round(tracksAnalysis.reduce((a, t) => a + (t.saturation_pct ?? 0), 0) / tracksAnalysis.length)
        : null,
      top_artists: genreArtistsTop.slice(0, 8).map((a) => ({
        name: a.artist,
        plays_in_niche: a.count,
      })),
      top_recurring_tracks: topRecurringTracks,
      leader_playlists: competitors.slice(0, 6),
      niche_playlist_count: nichePlaylistCount,
    };

    // 8.e) health_status — derivado de saturação + tamanho + sinais
    let healthStatus: "aquecido" | "saudavel" | "frio" = "saudavel";
    const removeRatio = counts.total > 0 ? counts.remove / counts.total : 0;
    if (removeRatio >= 0.25 || (saturatedCount / Math.max(1, counts.total)) >= 0.5) {
      healthStatus = "frio";
    } else if (counts.promote > 0 && removeRatio < 0.1) {
      healthStatus = "aquecido";
    }

    // 8.f) niche_rank — posição entre concorrentes do mesmo gênero por followers
    let nicheRank: number | null = null;
    let nicheTotal: number | null = null;
    if (pl.genre_id) {
      const { count: ahead } = await supabase
        .from("playlists")
        .select("id", { count: "exact", head: true })
        .eq("genre_id", pl.genre_id)
        .gt("followers", pl.followers ?? 0);
      const { count: total } = await supabase
        .from("playlists")
        .select("id", { count: "exact", head: true })
        .eq("genre_id", pl.genre_id);
      nicheRank = (ahead ?? 0) + 1;
      nicheTotal = total ?? null;
    }

    // 8.g) CAMADA EDITORIAL — cooldowns ativos + estado curatorial
    const { data: cdRows } = await supabase.rpc("get_active_cooldowns", { _playlist_id: pl.id });
    const activeCooldowns = ((cdRows ?? []) as any[]).map((c) => ({
      action_type: c.action_type,
      cooldown_until: c.cooldown_until,
      days_remaining: Number(c.days_remaining ?? 0),
      reason: c.reason ?? null,
    }));
    const hasCooldown = (a: string) => activeCooldowns.some((c) => c.action_type === a);
    const maxChangePctConfig: number = Number(pl.max_change_pct ?? 5);
    const saturatedRatio = counts.total > 0 ? saturatedCount / counts.total : 0;

    // 8.h) Decisão de modo — primeiro pergunta se vale a pena mexer
    let mode: "hold" | "light" | "moderate" | "structural" = "hold";
    const justifications: string[] = [];
    const tracksFullCooled = hasCooldown("structural") || hasCooldown("tracks_recycle");
    const tracksLightCooled = hasCooldown("tracks_light");
    const allCooled = tracksFullCooled && tracksLightCooled && hasCooldown("cover") && hasCooldown("description");

    // Playlist subdimensionada ou vazia: NÃO é "madura", é underbuilt.
    // Força modo que libera adições mesmo sem sinais de remove/promote.
    const benchP50Early = Number(benchmark?.tracks_p50 ?? 0);
    const isEmpty = totalTracks === 0;
    const isSeverelyUndersize = benchP50Early > 0 && totalTracks < benchP50Early * 0.5;

    if (allCooled) {
      mode = "hold";
      justifications.push("Todas as frentes estão em janela de observação. Aguardando maturação das últimas mudanças antes de qualquer nova intervenção.");
    } else if (isEmpty) {
      mode = tracksFullCooled ? "light" : "structural";
      justifications.push(`Playlist sem faixas. Construção inicial necessária — alvo de mercado: ~${benchP50Early || "?"} faixas.`);
    } else if (isSeverelyUndersize) {
      mode = tracksFullCooled ? "light" : "structural";
      justifications.push(`Playlist subdimensionada (${totalTracks} faixas vs. ~${benchP50Early} do mercado). Crescimento prioritário.`);
    } else if (removeRatio >= 0.25 || saturatedRatio >= 0.5) {
      mode = tracksFullCooled ? "light" : "structural";
      if (tracksFullCooled) {
        justifications.push(`Sinais críticos detectados (${Math.round(removeRatio * 100)}% das faixas pedem saída, ${Math.round(saturatedRatio * 100)}% saturadas), mas reciclagem está em cooldown. Recomendando apenas ajustes pontuais até a janela liberar.`);
      } else {
        justifications.push(`Sinais críticos: ${Math.round(removeRatio * 100)}% das faixas pedem saída e ${Math.round(saturatedRatio * 100)}% estão saturadas no nicho. Reciclagem estrutural justificada.`);
      }
    } else if (removeRatio >= 0.12 || saturatedRatio >= 0.3 || counts.promote >= 3) {
      mode = tracksFullCooled ? "light" : "moderate";
      justifications.push(`Sinais moderados: ${counts.remove} faixa(s) para remover, ${counts.promote} para promover. Intervenção controlada para preservar o algoritmo.`);
    } else if ((counts.remove + counts.promote + counts.demote) > 0) {
      mode = "light";
      justifications.push(`Apenas ${counts.remove + counts.promote + counts.demote} faixa(s) com sinal claro. Ajustes leves e pontuais, sem mexer na estrutura.`);
    } else {
      mode = "hold";
      justifications.push("Playlist madura e estável. Nenhuma alteração recomendada — manter como está e observar impacto.");
    }


    // 8.i) Aplica caps por modo + max_change_pct configurado
    const modeCapPct: Record<typeof mode, number> = { hold: 0, light: 5, moderate: 10, structural: 15 };
    const effectivePct = Math.min(maxChangePctConfig, modeCapPct[mode]);
    const maxChanges = Math.max(0, Math.floor(totalTracks * effectivePct / 100));

    // === Undersize override ===
    // Se a playlist está abaixo do tamanho de mercado (benchmark.tracks_p50),
    // o cap de % deixa de fazer sentido pra ADIÇÕES PURAS — uma playlist com
    // 51 faixas num nicho que pede 112+ precisa CRESCER. Substituições continuam
    // capadas (mexem em faixa existente = risco algorítmico).
    // Cap absoluto por ciclo: 30 adições — mantém ritmo seguro de crescimento.
    const benchP50 = Number(benchmark?.tracks_p50 ?? 0);
    const undersizeGap = benchP50 > 0 ? Math.max(0, benchP50 - totalTracks) : 0;
    const ADD_CAP_PER_CYCLE = 30;
    const additionsCap = mode === "hold"
      ? 0
      : Math.max(maxChanges, Math.min(undersizeGap, ADD_CAP_PER_CYCLE));

    let cappedSuggestions = tracksSuggestions;
    if (mode === "hold" || tracksFullCooled) {
      cappedSuggestions = [];
      if (tracksFullCooled && mode !== "hold") {
        const cd = activeCooldowns.find((c) => c.action_type === "tracks_recycle" || c.action_type === "structural");
        justifications.push(`Cooldown de reciclagem ativo (${Math.ceil(cd?.days_remaining ?? 0)}d restantes). Adições suprimidas.`);
      }
    } else {
      // Separa substituições (risco) de adições puras (crescimento)
      const subs = tracksSuggestions.filter((t: any) => t.is_substitution);
      const adds = tracksSuggestions.filter((t: any) => !t.is_substitution);
      const cappedSubs = subs.slice(0, maxChanges);
      const cappedAdds = adds.slice(0, additionsCap);
      cappedSuggestions = [...cappedSubs, ...cappedAdds];

      if (undersizeGap > 0 && additionsCap > maxChanges) {
        justifications.push(
          `Playlist subdimensionada: ${totalTracks} faixa(s) vs ${benchP50} ideais no nicho (gap de ${undersizeGap}). ` +
          `Cap de % suspenso para adições — liberadas ${cappedAdds.length} faixa(s) novas neste ciclo` +
          (cappedSubs.length > 0 ? ` + ${cappedSubs.length} substituição(ões)` : "") + ".",
        );
      } else if (maxChanges < tracksSuggestions.length) {
        justifications.push(`Limitando a ${maxChanges} adições (${effectivePct}% das ${totalTracks} faixas) para preservar estabilidade do algoritmo.`);
      }
    }

    const recommendedRemove = (tracksFullCooled || mode === "hold") ? 0 : Math.min(counts.remove, maxChanges);
    const recommendedPromote = (tracksLightCooled || mode === "hold") ? 0 : Math.min(counts.promote, maxChanges);
    const recommendedDemote = (tracksLightCooled || mode === "hold") ? 0 : Math.min(counts.demote, maxChanges);

    // Cooldowns de capa / descrição / nome (estrutural cobre nome)
    const coverSuggestion = hasCooldown("cover")
      ? {}
      : (model?.insights?.cover ?? model?.insights?.dna_visual ?? {});
    const finalNameSuggestion = hasCooldown("structural") ? null : editorialName;
    const finalDescriptionSuggestion = hasCooldown("description") ? null : editorialDescription;
    if (hasCooldown("cover")) justifications.push("Capa em cooldown — sugestão visual suspensa.");
    if (hasCooldown("description")) justifications.push("Descrição em cooldown — texto atual mantido.");

    const editorialJustification = justifications.join(" ");

    // 8.j) Atualiza estado curatorial da playlist
    const nextState =
      mode === "hold" && tracksFullCooled ? "cooldown" :
      mode === "hold" ? "saudavel" :
      mode === "light" ? "leve" :
      mode === "moderate" ? "moderada" :
      "estrutural";

    await supabase.from("managed_playlists")
      .update({
        curatorial_state: nextState,
        recommended_change_count: maxChanges,
      })
      .eq("id", pl.id);

    // === Lifecycle phase + roadmap (FASE 6C — preferir Brain como fonte oficial) ===
    // Mantém o cálculo local SEMPRE — usado como fallback e como referência para drift.
    const currentTracksCount = Number((pl as any).tracks_count ?? 0);
    const benchmarkTracksLocal: number | null = (benchmark?.tracks_p50 as number | null) ?? null;
    const { phase: lifecyclePhaseDiagRaw, ratio: ratioLocal } = derivePhase(currentTracksCount, benchmarkTracksLocal);
    const { data: mgdPhase } = await supabase
      .from("managed_playlists")
      .select("lifecycle_phase")
      .eq("id", pl.id)
      .maybeSingle();
    const lifecyclePhaseLocal = ((mgdPhase as any)?.lifecycle_phase as any) ?? lifecyclePhaseDiagRaw;
    const growthRoadmapLocal = buildRoadmap(currentTracksCount, benchmarkTracksLocal ?? 0, lifecyclePhaseLocal);

    // Decide a origem efetiva de cada campo. Brain só é usado se existe E tem confidence >= 40.
    const brainUsable = !!brain && Number((brain as any).confidence_score ?? 0) >= 40;
    const lifecyclePhaseDiag = brainUsable && (brain as any).lifecycle_phase ? (brain as any).lifecycle_phase : lifecyclePhaseLocal;
    const lifecyclePhaseSource: "brain" | "local" = brainUsable && (brain as any).lifecycle_phase ? "brain" : "local";

    const benchmarkTracksDiag = brainUsable && (brain as any).benchmark_tracks != null ? Number((brain as any).benchmark_tracks) : benchmarkTracksLocal;
    const benchmarkTracksSource: "brain" | "local" = brainUsable && (brain as any).benchmark_tracks != null ? "brain" : "local";

    const ratioDiag = brainUsable && (brain as any).ratio_to_benchmark != null ? Number((brain as any).ratio_to_benchmark) : ratioLocal;
    const ratioSource: "brain" | "local" = brainUsable && (brain as any).ratio_to_benchmark != null ? "brain" : "local";

    const growthRoadmapDiag = brainUsable && (brain as any).growth_roadmap
      ? (brain as any).growth_roadmap
      : growthRoadmapLocal;
    const growthRoadmapSource: "brain" | "local" = brainUsable && (brain as any).growth_roadmap ? "brain" : "local";

    const bloatedBudget = lifecyclePhaseDiag === "bloated"
      ? bloatedRemovalBudget(currentTracksCount, benchmarkTracksDiag ?? 0)
      : null;

    // === Drift audit (>5%) — só calcula quando temos brain e local lado a lado ===
    const driftEvents: Array<{ field: string; brain_value: any; local_value: any; diff_pct: number | null }> = [];
    if (brain) {
      const pushDrift = (field: string, b: any, l: any, diffPct: number | null) => {
        driftEvents.push({ field, brain_value: b, local_value: l, diff_pct: diffPct });
      };
      // lifecycle_phase — categórico: drift = 100 se diferente
      if ((brain as any).lifecycle_phase && (brain as any).lifecycle_phase !== lifecyclePhaseLocal) {
        pushDrift("lifecycle_phase", (brain as any).lifecycle_phase, lifecyclePhaseLocal, 100);
      }
      // ratio_to_benchmark — numérico
      const bRatio = (brain as any).ratio_to_benchmark != null ? Number((brain as any).ratio_to_benchmark) : null;
      if (bRatio != null && ratioLocal != null && ratioLocal !== 0) {
        const diff = Math.abs((bRatio - ratioLocal) / ratioLocal) * 100;
        if (diff > 5) pushDrift("ratio_to_benchmark", bRatio, ratioLocal, Number(diff.toFixed(2)));
      }
      // benchmark_tracks — numérico
      const bBench = (brain as any).benchmark_tracks != null ? Number((brain as any).benchmark_tracks) : null;
      if (bBench != null && benchmarkTracksLocal != null && benchmarkTracksLocal !== 0) {
        const diff = Math.abs((bBench - benchmarkTracksLocal) / benchmarkTracksLocal) * 100;
        if (diff > 5) pushDrift("benchmark_tracks", bBench, benchmarkTracksLocal, Number(diff.toFixed(2)));
      }
    }



    tel.start("persist_diagnosis");
    const { data: diag, error: dErr } = await supabase
      .from("playlist_diagnoses")
      .insert({

        playlist_id: pl.id,
        created_by: guard.via === "user" ? guard.userId : null,
        name_score: nameScore,
        name_current: pl.name,
        name_suggestion: finalNameSuggestion,
        name_reasons: nameReasons,
        tracks_suggestions: cappedSuggestions,
        tracks_analysis: tracksAnalysis,
        tracks_summary: tracksSummary,
        cover_suggestion: coverSuggestion,
        competitors,
        raw: {
          // === Lifecycle / Roadmap (FASE 6C — fonte oficial = Brain quando disponível) ===
          lifecycle_phase: lifecyclePhaseDiag,
          benchmark_tracks: benchmarkTracksDiag,
          ratio_to_benchmark: ratioDiag,
          growth_roadmap: growthRoadmapDiag,
          bloated_budget: bloatedBudget,
          // Marcadores de origem (FASE 6C)
          lifecycle_phase_source: lifecyclePhaseSource,
          growth_roadmap_source: growthRoadmapSource,
          ratio_to_benchmark_source: ratioSource,
          benchmark_tracks_source: benchmarkTracksSource,
          headroom_source: brainUsable ? "brain" : "local",
          // Snapshot do brain consumido (read-only) + cálculo local preservado p/ auditoria
          brain: brain ? {
            confidence_score: (brain as any).confidence_score ?? null,
            health_trend: (brain as any).health_trend ?? null,
            capacity_total: (brain as any).capacity_total ?? null,
            capacity_per_slot: (brain as any).capacity_per_slot ?? null,
            capacity_ceiling: (brain as any).capacity_ceiling ?? null,
            headroom_pct: (brain as any).headroom_pct ?? null,
            signals_count: Array.isArray((brain as any).signals) ? (brain as any).signals.length : 0,
            last_calculated_at: (brain as any).last_calculated_at ?? null,
            used: brainUsable,
            drift_count: driftEvents.length,
          } : null,
          local_calc: {
            lifecycle_phase: lifecyclePhaseLocal,
            benchmark_tracks: benchmarkTracksLocal,
            ratio_to_benchmark: ratioLocal,
            growth_roadmap: growthRoadmapLocal,
          },

          model_present: !!model,
          benchmark,
          top_keywords: topKeywords,
          present_keywords: present,
          sync_ok: syncRes?.ok ?? false,
          sync_error: syncRes?.ok ? null : (syncRes as any)?.body?.error ?? (syncRes as any)?.error ?? null,
          suggested_description: finalDescriptionSuggestion,
          description_current: pl.description ?? null,
          missing_keywords: missing,
          missing_in_description: missingInDesc,
          market_insights: marketInsights,
          health_status: healthStatus,
          niche_rank: nicheRank,
          niche_total: nicheTotal,
          // === Sprint 2 — camada editorial ===
          recommendation_mode: mode,
          editorial_justification: editorialJustification,
          curatorial_state: nextState,
          applied_caps: {
            max_change_pct: effectivePct,
            max_change_pct_config: maxChangePctConfig,
            max_changes: maxChanges,
            // Em 'bloated' o cap de remoção segue o budget editorial (25% do excesso, máx 50).
            // Em outras fases mantém o cap normal e ZERA adições só não-conformes.
            recommended_remove: bloatedBudget
              ? Math.max(recommendedRemove, bloatedBudget.max_per_cycle)
              : recommendedRemove,
            recommended_promote: recommendedPromote,
            recommended_demote: recommendedDemote,
            recommended_add: lifecyclePhaseDiag === "bloated" ? 0 : null,
            max_per_day: bloatedBudget?.max_per_day ?? null,
            capped_suggestions: cappedSuggestions.length,
            original_suggestions: tracksSuggestions.length,
          },
          active_cooldowns: activeCooldowns,
          // === Camada 3 — substituições por função editorial ===
          substitutions: substitutions,
          zone_deficits: deficits,
          zone_ideal: zoneIdeal,
          // === Camada IA editorial ===
          ai_used: !!aiCopy,
          ai_error: aiError,
          ai_titles: aiCopy?.titles ?? null,
          ai_descriptions: aiCopy?.descriptions ?? null,
          ai_reasoning: aiCopy?.reasoning ?? null,
          algo_name_baseline: algoName,
          algo_description_baseline: algoDescription,
          __telemetry: tel.report(),
        },
      })
      .select()
      .single();
    tel.end("persist_diagnosis", dErr ? "error" : "ok", dErr?.message);

    if (!dErr) {
      await supabase.from("managed_playlists")
        .update({ last_diagnosis_at: new Date().toISOString() })
        .eq("id", pl.id);
    }



    if (lockHandle) {
      await finishPlaylistOperation(supabase, lockHandle, {
        status: dErr ? "failed" : "success",
        error: dErr?.message ?? null,
      });
    }

    // FASE 2 — Atualiza streak de 403 e marca diagnose_blocked após 3 execuções consecutivas com 403.
    try {
      if (run403s > 0) {
        const prev = Number((pl as any).diagnose_403_streak ?? 0);
        const next = prev + 1;
        const upd: Record<string, unknown> = { diagnose_403_streak: next };
        if (next >= 3) {
          upd.diagnose_blocked = true;
          upd.diagnose_blocked_at = new Date().toISOString();
          upd.diagnose_blocked_reason = `403_persistent (${run403s} 403s na execução, streak=${next})`;
        }
        await supabase.from("managed_playlists").update(upd).eq("id", pl.id);
      } else if (Number((pl as any).diagnose_403_streak ?? 0) > 0) {
        await supabase.from("managed_playlists").update({ diagnose_403_streak: 0 }).eq("id", pl.id);
      }
    } catch (e) {
      console.error("[diagnose] streak update failed:", (e as Error).message);
    }

    return jr({ ok: true, diagnosis: diag, error: dErr?.message, sync: syncRes, _403_observed: run403s, _telemetry: tel.report() });
  } catch (e) {
    // Circuit breaker aberto: aborta com erro claro em vez de degradar.
    if (e instanceof SpotifyCircuitOpenError) {
      const blockedUntilMs = e.blockedUntil ? new Date(e.blockedUntil).getTime() : NaN;
      const retryAfter = Number.isFinite(blockedUntilMs)
        ? Math.max(1, Math.ceil((blockedUntilMs - Date.now()) / 1000))
        : Math.max(1, e.retryAfterSec || 60);
      if (lockHandle && supabaseRef) {
        await finishPlaylistOperation(supabaseRef, lockHandle, {
          status: "aborted",
          error: `SPOTIFY_CIRCUIT_OPEN retry_after=${retryAfter}s`,
        });
      }
      return jr({
        ok: false,
        error: "SPOTIFY_CIRCUIT_OPEN",
        code: "spotify_circuit_open",
        message: "Diagnóstico abortado: Spotify API bloqueada pelo circuit breaker.",
        blocked_until: e.blockedUntil,
        retry_after: retryAfter,
      }, 503);
    }
    if (lockHandle && supabaseRef) {
      await finishPlaylistOperation(supabaseRef, lockHandle, {
        status: "failed",
        error: formatPlaylistError(e),
      });
    }
    return jr({ ok: false, error: (e as Error).message }, 500);
  } finally {
    if (lockHandle && supabaseRef) {
      await releasePlaylistLock(supabaseRef, lockHandle);
    }
  }
});
