// run-search — executa um termo via Apify automation-lab/spotify-scraper
// Salva playlists com DEDUP via spotify_playlist_id (UPSERT) + filtro inteligente:
//   - precisa conter slug do gênero OU termo de busca
//   - rejeita se contém qualquer palavra da blacklist (genre_filters.blacklist)
//   - se já existe (genre_id, spotify_playlist_id): incrementa times_seen, atualiza last_seen_at + posição
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY")!;

interface Body {
  genre_id: string;
  term_id: string;
  search_term: string;
  max_results?: number;
  recovery?: boolean; // 🆕 caller pode forçar modo recovery (ex: collect-batch)
}

const APIFY_ACTOR = "automation-lab~spotify-scraper";
const DEFAULT_BLACKLIST = [
  "workout","gym","treino","academia","sleep","study","focus","lofi",
  "edm","techno","house","trance","rock","metal","jazz","classical",
];

class ApifyBlockedError extends Error {
  reason = "APIFY_LIMIT";
  status = 403;
  constructor(msg: string) { super(msg); this.name = "ApifyBlockedError"; }
}

async function runApify(searchTerm: string, maxResults: number, signal: AbortSignal) {
  const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=120`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      mode: "search",
      searchTerms: [searchTerm],
      searchType: "playlists",
      maxResults,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    // Detectar bloqueio por limite mensal do Apify (circuit breaker)
    if (resp.status === 403 || /monthly usage hard limit exceeded/i.test(txt)) {
      throw new ApifyBlockedError(`Apify ${resp.status}: ${txt.slice(0, 300)}`);
    }
    throw new Error(`Apify ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const items = await resp.json();
  const runId = resp.headers.get("x-apify-pagination-total") ?? null;
  return { runId, items: Array.isArray(items) ? items : [] };
}

function pickStr(o: any, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}
function pickNum(o: any, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
  }
  return null;
}
function extractPlaylistId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/playlist\/([A-Za-z0-9]+)/);
  return m?.[1] ?? null;
}

// Quality score (0-100): saúde da playlist, independente do match de gênero.
// Sinais: seguidores (peso forte), nº de faixas, completude de metadata.
function computeQualityScore(opts: {
  followers: number | null;
  totalTracks: number | null;
  descricao: string | null;
  imagem: string | null;
}): number {
  const { followers, totalTracks, descricao, imagem } = opts;
  let q = 0;

  // Seguidores (até 50 pts) — escala log para não saturar com mega-playlists
  const f = followers ?? 0;
  if (f >= 100_000) q += 50;
  else if (f >= 10_000) q += 40;
  else if (f >= 1_000) q += 30;
  else if (f >= 100) q += 15;
  else if (f > 0) q += 5;

  // Quantidade de faixas (até 30 pts)
  const t = totalTracks ?? 0;
  if (t >= 100) q += 30;
  else if (t >= 50) q += 20;
  else if (t >= 30) q += 12;
  else if (t >= 10) q += 5;
  // < 10 faixas: 0 pts (playlist embrionária ou abandonada)

  // Completude (até 20 pts)
  if (imagem && imagem.length > 10) q += 10;
  if (descricao && descricao.trim().length >= 20) q += 10;

  return Math.min(100, Math.max(0, q));
}

Deno.serve(async (req) => {
  const __dep = await deprecationGate(req, "run-search");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  const start = Date.now();
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  if (!body.genre_id || !body.term_id || !body.search_term) {
    return new Response(JSON.stringify({ error: "genre_id, term_id e search_term são obrigatórios" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!APIFY_API_KEY) {
    return new Response(JSON.stringify({ error: "APIFY_API_KEY não configurada" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Circuit breaker: se Apify já foi bloqueado globalmente, não chama a API.
  // Reset automático após 24h.
  const { data: flag } = await supabase
    .from("system_flags")
    .select("id,apify_blocked,apify_blocked_at")
    .eq("singleton_key", "app")
    .maybeSingle();
  if (flag?.apify_blocked) {
    const blockedAt = flag.apify_blocked_at ? new Date(flag.apify_blocked_at).getTime() : 0;
    const ageMs = Date.now() - blockedAt;
    if (ageMs > 24 * 60 * 60 * 1000) {
      // Reset automático
      await supabase.from("system_flags").upsert({
        singleton_key: "app",
        apify_blocked: false, apify_blocked_at: null, apify_blocked_reason: null,
      }, { onConflict: "singleton_key" });
    } else {
      await supabase.from("collection_logs").insert({
        genre_id: body.genre_id, term_id: body.term_id,
        acao: "apify-blocked", status: "erro",
        mensagem: "Pulado: Apify globalmente bloqueado (circuit breaker)",
      });
      return new Response(JSON.stringify({ ok: false, blocked: true, reason: "APIFY_BLOCKED_GLOBAL" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // ============= APIFY OPTIMIZATION POLICY =============
  // 1 chamada Apify ≈ 1 unidade de custo, INDEPENDENTE de maxResults (até o teto do actor).
  // Logo: pedir 20 itens custa o MESMO que pedir 100 → SEMPRE pedir alto.
  // MIN_MAX_RESULTS = 50  (nunca menos que isso)
  // DEFAULT_MAX_RESULTS = 100 (padrão otimizado)
  const MIN_MAX_RESULTS = 50;
  const DEFAULT_MAX_RESULTS = 100;
  const requested = body.max_results ?? DEFAULT_MAX_RESULTS;
  const maxResults = Math.max(MIN_MAX_RESULTS, Math.min(requested, 200));

  // ============= COOLDOWN ANTI-DUPLICAÇÃO =============
  // Bloqueia re-execução de term_id se foi executado nas últimas COOLDOWN_HOURS
  // E já trouxe pelo menos 1 resultado. Use force=true pra ignorar.
  const COOLDOWN_HOURS = 24;
  if (!(body as any).force) {
    const { data: termRow } = await supabase
      .from("search_terms")
      .select("ultima_execucao,total_resultados")
      .eq("id", body.term_id)
      .maybeSingle();
    if (termRow?.ultima_execucao && (termRow.total_resultados ?? 0) > 0) {
      const ageH = (Date.now() - new Date(termRow.ultima_execucao).getTime()) / 36e5;
      if (ageH < COOLDOWN_HOURS) {
        await supabase.from("collection_logs").insert({
          genre_id: body.genre_id, term_id: body.term_id,
          acao: "run-search", status: "skipped",
          mensagem: `cooldown: termo "${body.search_term}" executado há ${ageH.toFixed(1)}h (<${COOLDOWN_HOURS}h) com ${termRow.total_resultados} resultados. Use force=true pra ignorar.`,
          duracao_ms: Date.now() - start,
        });
        return new Response(JSON.stringify({
          ok: true, skipped: true, reason: "cooldown",
          ageH: Number(ageH.toFixed(2)), cooldownH: COOLDOWN_HOURS,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), 130_000);

  try {
    // Carrega slug do gênero + blacklist + modelo (keywords, artistas, subgêneros)
    const [{ data: genre }, { data: filt }, { data: model }] = await Promise.all([
      supabase.from("genres").select("slug,nome").eq("id", body.genre_id).maybeSingle(),
      supabase.from("genre_filters").select("blacklist").eq("genre_id", body.genre_id).maybeSingle(),
      supabase.from("genre_models").select("palavras_chave,musicas_recorrentes,insights").eq("genre_id", body.genre_id).maybeSingle(),
    ]);
    const slug = (genre?.slug ?? "").toLowerCase();
    const nome = (genre?.nome ?? "").toLowerCase();
    const slugOrNome = (genre?.slug ?? "").toLowerCase() || nome;
    const termLower = body.search_term.toLowerCase();
    const blacklist = (filt?.blacklist as string[] | undefined)?.map(b => b.toLowerCase()) ?? DEFAULT_BLACKLIST;

    // STRONG_BLACKLIST: rejeição imediata por gênero (escopo: funk BR)
    const STRONG_BLACKLIST_BY_GENRE: Record<string, string[]> = {
      funk: [
        "phonk","kordhell","eternxlkz","boogie","disco","oldies","chicano",
        "bruno mars","uptown funk","pocoyo","meow","anime","jjk","yuji","edit anime",
      ],
    };
    const strongBlacklist = STRONG_BLACKLIST_BY_GENRE[slugOrNome] ?? [];

    // BR_BOOST: sinais que reforçam autenticidade Brasil (escopo: funk BR)
    const BR_BOOST_BY_GENRE: Record<string, string[]> = {
      funk: ["brasil","br","bailão","bailao","mandelão","mandelao","automotivo","tropa","dj","mtg"],
    };
    const brBoostTerms = BR_BOOST_BY_GENRE[slugOrNome] ?? [];

    // Match com word-boundary para evitar falsos positivos (ex.: "br" em "brunette")
    const wordHit = (hay: string, term: string) => new RegExp(`(^|[^a-záéíóúâêôãõç])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-záéíóúâêôãõç]|$)`, "i").test(hay);

    // Extrai sinais do modelo (cold-start safe: arrays vazios)
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

    // 🆕 RECOVERY MODE — gênero esfomeado: < 50 playlists vistas em 14d.
    // Pode vir explícito do caller (collect-batch) ou ser auto-detectado.
    // Em recovery: relaxa SCORE_THRESHOLD_STRICT (60→50) — aceita borderline,
    // mantendo STRONG_BLACKLIST e gate de nome (relevância) intactos.
    let isRecovery = body.recovery === true;
    if (!isRecovery) {
      const sinceISO = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { count: freshCount } = await supabase
        .from("search_results")
        .select("id", { count: "exact", head: true })
        .eq("genre_id", body.genre_id)
        .eq("is_valid", true)
        .gte("last_seen_at", sinceISO);
      isRecovery = (freshCount ?? 0) < 50;
    }

    // Detecta termo de expansão (sinais semânticos amplos, não vinculados ao gênero core)
    const EXPANSION_MARKERS = ["remix", "viral", "cover", "tiktok", "tik tok", "edit", "phonk", "2026", "2025", "mashup"];
    const isExpansionTerm = EXPANSION_MARKERS.some(m => termLower.includes(m));
    const SCORE_THRESHOLD_STRICT = isRecovery ? 50 : 60;       // 🆕 recovery: 60→50
    const SCORE_THRESHOLD_EXPANSION = isRecovery ? 40 : 50;    // 🆕 recovery: 50→40
    const EXPANSION_BONUS = 10; // reduz threshold efetivo em 10 pra termos de expansão
    const effectiveThreshold = isExpansionTerm
      ? SCORE_THRESHOLD_EXPANSION - EXPANSION_BONUS  // strict=40, recovery=30
      : SCORE_THRESHOLD_STRICT;                       // strict=60, recovery=50
    const FOLLOWERS_THRESHOLD = 5000;

    function scorePlaylist(opts: { nomePl: string; descricao: string | null; followers: number | null; }) {
      const { nomePl, descricao, followers } = opts;
      const nameLow = nomePl.toLowerCase();
      const descLow = (descricao ?? "").toLowerCase();
      const haystack = `${nameLow} ${descLow}`;
      let score = 0;
      const reasons: string[] = [];

      // STRONG_BLACKLIST: rejeição imediata se nome OU descrição contém termo proibido
      const strongHit = strongBlacklist.find(b => b && haystack.includes(b));
      if (strongHit) {
        reasons.push(`strong_blacklist:${strongHit}`);
        return { score: -999, reasons, hardBlock: true };
      }

      // GENRE-IN-NAME GATE: nome da playlist DEVE conter slug ou nome do gênero
      // (descrição não é mais aceita como sinal primário de gênero)
      const nameHasGenre = (slug && nameLow.includes(slug)) || (nome && nameLow.includes(nome));
      if (!nameHasGenre) {
        reasons.push(`no_${slug || nome || "genre"}_in_name`);
        return { score: -999, reasons, hardBlock: true };
      }

      // Positivos
      if (nameLow.includes(termLower)) { score += 30; reasons.push("+30 name~term"); }
      else if (slug && nameLow.includes(slug)) { score += 20; reasons.push("+20 name~slug"); }
      else if (nome && nameLow.includes(nome)) { score += 20; reasons.push("+20 name~nome"); }

      if (descLow && descLow.includes(termLower)) { score += 15; reasons.push("+15 desc~term"); }

      const artistHit = modelArtists.some(a => haystack.includes(a));
      if (artistHit) { score += 25; reasons.push("+25 artist"); }

      const kwHits = modelKeywords.filter(k => k && haystack.includes(k)).slice(0, 3);
      if (kwHits.length > 0) { score += 20; reasons.push(`+20 kw(${kwHits.length})`); }

      const subHit = subgenresList.find(s => s && haystack.includes(s));
      if (subHit) { score += 15; reasons.push(`+15 sub:${subHit}`); }

      if ((followers ?? 0) > FOLLOWERS_THRESHOLD) { score += 10; reasons.push("+10 followers"); }

      // BR_BOOST: +15 se nome OU descrição contém algum sinal de funk brasileiro
      const brHit = brBoostTerms.find(t => t && wordHit(haystack, t));
      if (brHit) { score += 15; reasons.push(`+15 br:${brHit}`); }

      // Negativos
      const blHits = blacklist.filter(b => b && haystack.includes(b));
      if (blHits.length > 0) { score -= 40; reasons.push(`-40 bl:${blHits[0]}`); }

      const containsGenreAny = (slug && haystack.includes(slug)) || (nome && haystack.includes(nome)) || haystack.includes(termLower);
      if (!containsGenreAny) { score -= 30; reasons.push("-30 genre-mismatch"); }

      return { score, reasons, hardBlock: blHits.length > 0 };
    }

    await supabase.from("genres").update({ status: "coletando" }).eq("id", body.genre_id);

    const { runId, items } = await runApify(body.search_term, maxResults, controller.signal);

    let savedResults = 0;
    let updatedResults = 0;
    let savedTracks = 0;
    let filteredOut = 0;
    const scoreLog: Array<{ name: string; score: number; accepted: boolean; reasons: string[] }> = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type && it.type !== "playlist") continue;

      const nomePl = pickStr(it, "name", "title", "playlistName") ?? "Sem nome";
      const url = pickStr(it, "url", "spotifyUrl", "playlistUrl");
      const followers = null;
      const imagem = pickStr(it, "imageUrl", "coverImage", "image");
      const descricao = pickStr(it, "description", "desc");
      const totalTracks = pickNum(it, "trackCount", "tracksCount", "totalTracks");
      const ownerCountry = pickStr(it.owner ?? {}, "country") ?? pickStr(it, "ownerCountry");
      const playlistId = pickStr(it, "playlistId", "id") ?? extractPlaylistId(url);

      // ============= PHASE 1 (COLLECTION — PERMISSIVA) =============
      // Aceita se: nome contém slug do gênero + NÃO em STRONG_BLACKLIST + URL Spotify válida.
      // NÃO rejeita por followers nem total_tracks (Apify devolve null com frequência).
      // Quality + is_valid definitivos são definidos em PHASE 2 (enrich-playlists).
      const { score, reasons, hardBlock } = scorePlaylist({ nomePl, descricao, followers });

      let rejected = false;
      let rejectReason: string | null = null;

      // Hard-reject só por sinais TEXTUAIS (não dependem de enrich):
      //   - strong_blacklist:<termo>  (palavra proibida no nome/descrição)
      //   - no_<slug>_in_name         (gate textual: nome não contém o gênero)
      if (hardBlock) {
        rejected = true;
        rejectReason = reasons.find(r => r.startsWith("strong_blacklist"))
          ?? reasons.find(r => r.startsWith("no_"))
          ?? "hard_block";
      }
      // URL/ID inválida — lixo do scraper, não há o que enriquecer
      else if (!playlistId || !url || !/playlist\/[A-Za-z0-9]{16,}/.test(url)) {
        rejected = true;
        rejectReason = "invalid_url_or_id";
      }
      // ⚠️ Removido em Phase 1: low_score (depende de followers que vem null), low_quality_no_followers.
      // Score é informativo aqui; gating por score acontece em downstream (analyze-genre rank cutoff).

      scoreLog.push({
        name: nomePl.slice(0, 60),
        score,
        accepted: !rejected,
        reasons: rejected ? [...reasons, rejectReason ?? "rejected"] : reasons,
      });

      if (rejected) {
        filteredOut++;
        continue;
      }
      // ============= FIM PHASE 1 =============

      // UPSERT manual (tabela tem unique parcial em (genre_id, spotify_playlist_id))
      // 🔁 REGRA ÚNICA DE VERDADE (Fase 1):
      //    needs_enrich = (seguidores IS NULL)
      // Se a linha JÁ tem followers, NÃO resetamos needs_enrich nem destruímos quality_score.
      // Isso preserva dados enriquecidos e mata o loop de re-enrich.
      let resultId: string | null = null;
      if (playlistId) {
        const { data: existing } = await supabase
          .from("search_results")
          .select("id,times_seen,seguidores,quality_score,quality_flag,is_valid,validation_reason,followers_source,followers_verified_at,needs_enrich")
          .eq("genre_id", body.genre_id)
          .eq("spotify_playlist_id", playlistId)
          .maybeSingle();
        if (existing) {
          // Followers do actor são descartados; somente Spotify API pode preencher seguidores.
          const alreadyVerified = existing.followers_source === "spotify_api" && existing.followers_verified_at != null;
          const updatePatch: Record<string, unknown> = {
            posicao: i + 1,
            nome_playlist: nomePl,
            spotify_url: url,
            imagem_url: imagem,
            descricao,
            apify_run_id: runId,
            term_id: body.term_id,
            times_seen: (existing.times_seen ?? 1) + 1,
            last_seen_at: new Date().toISOString(),
            score,
          };
          if (alreadyVerified) {
            updatePatch.needs_enrich = false;
            // needs_enrich/is_valid/quality_* PRESERVADOS — fase 2 já mandou
          } else {
            updatePatch.seguidores = null;
            updatePatch.total_musicas = totalTracks;
            updatePatch.needs_enrich = true;
            updatePatch.followers_source = null;
            updatePatch.followers_verified_at = null;
            updatePatch.is_valid = true;
            updatePatch.validation_reason = "pre_enrich";
            updatePatch.quality_score = null;
            updatePatch.quality_flag = null;
            updatePatch.quality_flagged_at = null;
          }
          const { error: updErr } = await supabase
            .from("search_results")
            .update(updatePatch)
            .eq("id", existing.id);
          if (updErr) {
            console.error("update result err", updErr);
            continue;
          }
          updatedResults++;
          resultId = existing.id;
        }
      }
      if (!resultId) {
        const { data: inserted, error: insErr } = await supabase
          .from("search_results")
          .insert({
            genre_id: body.genre_id,
            term_id: body.term_id,
            nome_playlist: nomePl,
            posicao: i + 1,
            spotify_url: url,
            spotify_playlist_id: playlistId,
            seguidores: null,
            imagem_url: imagem,
            descricao,
            total_musicas: totalTracks,
            apify_run_id: runId,
            // owner_country removido — coluna não existe no schema (PGRST204)
            times_seen: 1,
            score,
            // 🔁 Followers entram somente após enrich oficial via Spotify API.
            needs_enrich: true,
            followers_source: null,
            followers_verified_at: null,
            is_valid: true,
            validation_reason: "pre_enrich",
            quality_score: null,
            quality_flag: null,
            quality_flagged_at: null,
          })
          .select("id")
          .single();
        if (insErr) {
          console.error("insert result err", insErr);
          continue;
        }
        savedResults++;
        resultId = inserted.id;
      }

      const tracks = Array.isArray(it.tracks) ? it.tracks : [];
      if (tracks.length > 0 && resultId) {
        const nowIso = new Date().toISOString();
        const trackRows = tracks.slice(0, 100).map((t: any, idx: number) => {
          let artista = pickStr(t, "artist", "artistName") ?? "Desconhecido";
          if (Array.isArray(t.artists)) {
            artista = t.artists.map((a: any) => typeof a === "string" ? a : (a.name ?? a.artist ?? "")).filter(Boolean).join(", ") || artista;
          }
          return {
            genre_id: body.genre_id,
            result_id: resultId,
            nome_musica: pickStr(t, "name", "title", "trackName") ?? "Desconhecida",
            artista,
            spotify_track_id: pickStr(t, "id", "trackId", "spotifyId"),
            posicao_na_playlist: idx + 1,
            coletado_em: nowIso,
          };
        });
        // Para evitar acumular tracks em re-execuções, limpa antes (só nas que estamos atualizando)
        await supabase.from("search_tracks").delete().eq("result_id", resultId);
        const { error: trkErr } = await supabase.from("search_tracks").insert(trackRows);
        if (!trkErr) savedTracks += trackRows.length;
        else console.error("insert tracks err", trkErr);
      }
    }

    await supabase
      .from("search_terms")
      .update({ executado: true, total_resultados: savedResults + updatedResults, ultima_execucao: new Date().toISOString() })
      .eq("id", body.term_id);

    const [{ count: pCount }, { count: tCount }] = await Promise.all([
      supabase.from("search_results").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id),
      supabase.from("search_tracks").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id),
    ]);
    await supabase.from("genres").update({
      total_playlists: pCount ?? 0,
      total_musicas: tCount ?? 0,
      ultima_coleta: new Date().toISOString(),
      status: "coletando",
    }).eq("id", body.genre_id);

    // Top-3 aceitas (maior score) e top-3 rejeitadas (mais "perto de passar" → maior score primeiro)
    const acceptedTop = scoreLog.filter(s => s.accepted).sort((a,b) => b.score - a.score).slice(0, 3);
    const rejectedTop = scoreLog.filter(s => !s.accepted).sort((a,b) => b.score - a.score).slice(0, 3);
    const fmt = (s: typeof scoreLog[0]) => `[${s.score}] "${s.name}" → ${s.reasons.join(", ") || "—"}`;
    const acceptedBlock = acceptedTop.length
      ? acceptedTop.map((s, i) => `  #${i+1} ${fmt(s)}`).join("\n")
      : "  —";
    const rejectedBlock = rejectedTop.length
      ? rejectedTop.map((s, i) => `  #${i+1} ${fmt(s)}`).join("\n")
      : "  —";
    const diag =
      `"${body.search_term}" | mode=${isExpansionTerm ? "EXPANSION" : "STRICT"}${isRecovery ? "+RECOVERY" : ""} thr=${effectiveThreshold} | ` +
      `${savedResults} novas, ${updatedResults} atualizadas, ${filteredOut} filtradas, ${savedTracks} músicas (${scoreLog.length} avaliadas)\n` +
      `TOP 3 ACEITAS:\n${acceptedBlock}\n` +
      `TOP 3 REJEITADAS:\n${rejectedBlock}`;

    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      term_id: body.term_id,
      acao: "run-search",
      status: "sucesso",
      mensagem: diag.slice(0, 4000),
      duracao_ms: Date.now() - start,
    });

    clearTimeout(timeoutHandle);
    return new Response(
      JSON.stringify({
        ok: true, savedResults, updatedResults, filteredOut, savedTracks, runId,
        scoring: {
          mode: isExpansionTerm ? "expansion" : "strict",
          recovery: isRecovery,
          threshold: effectiveThreshold,
          evaluated: scoreLog.length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    clearTimeout(timeoutHandle);
    const msg = (e as Error).message ?? String(e);
    console.error("run-search error", msg);

    // Circuit breaker: bloqueio do Apify (limit exceeded / 403)
    if (e instanceof ApifyBlockedError) {
      // Ativa flag global
      // 🚨 Audit #9 — singleton UPSERT
      await supabase.from("system_flags").upsert({
        singleton_key: "app",
        apify_blocked: true,
        apify_blocked_at: new Date().toISOString(),
        apify_blocked_reason: msg.slice(0, 300),
      }, { onConflict: "singleton_key" });
      await supabase.from("collection_logs").insert({
        genre_id: body.genre_id, term_id: body.term_id,
        acao: "apify-blocked", status: "erro",
        mensagem: "Apify limit exceeded - circuit breaker activated",
        duracao_ms: Date.now() - start,
      });
      // 🔔 Notificação CRITICAL
      await supabase.rpc("create_notification", {
        p_type: "critical",
        p_title: "Apify bloqueado",
        p_message: "Limite do Apify atingido. Coletas pausadas pelo circuit breaker (24h).",
        p_action_url: "/operacao",
        p_metadata: { reason: msg.slice(0, 300) },
      }).then(() => {}, (e) => console.error("[run-search] log/op failed:", e?.message ?? e));
      return new Response(JSON.stringify({ ok: false, blocked: true, reason: "APIFY_LIMIT" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      term_id: body.term_id,
      acao: "run-search",
      status: "erro",
      mensagem: msg.slice(0, 500),
      duracao_ms: Date.now() - start,
    });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
