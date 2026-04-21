// run-search — executa um termo via Apify automation-lab/spotify-scraper
// Salva playlists com DEDUP via spotify_playlist_id (UPSERT) + filtro inteligente:
//   - precisa conter slug do gênero OU termo de busca
//   - rejeita se contém qualquer palavra da blacklist (genre_filters.blacklist)
//   - se já existe (genre_id, spotify_playlist_id): incrementa times_seen, atualiza last_seen_at + posição
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY")!;

interface Body {
  genre_id: string;
  term_id: string;
  search_term: string;
  max_results?: number;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (flag?.apify_blocked) {
    const blockedAt = flag.apify_blocked_at ? new Date(flag.apify_blocked_at).getTime() : 0;
    const ageMs = Date.now() - blockedAt;
    if (ageMs > 24 * 60 * 60 * 1000) {
      // Reset automático
      await supabase.from("system_flags").update({
        apify_blocked: false, apify_blocked_at: null, apify_blocked_reason: null,
      }).eq("id", flag.id);
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

  const maxResults = body.max_results ?? 20;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), 130_000);

  try {
    // Carrega slug do gênero + blacklist (filtro inteligente)
    const [{ data: genre }, { data: filt }] = await Promise.all([
      supabase.from("genres").select("slug,nome").eq("id", body.genre_id).maybeSingle(),
      supabase.from("genre_filters").select("blacklist").eq("genre_id", body.genre_id).maybeSingle(),
    ]);
    const slug = (genre?.slug ?? "").toLowerCase();
    const nome = (genre?.nome ?? "").toLowerCase();
    const termLower = body.search_term.toLowerCase();
    const blacklist = (filt?.blacklist as string[] | undefined)?.map(b => b.toLowerCase()) ?? DEFAULT_BLACKLIST;

    await supabase.from("genres").update({ status: "coletando" }).eq("id", body.genre_id);

    const { runId, items } = await runApify(body.search_term, maxResults, controller.signal);

    let savedResults = 0;
    let updatedResults = 0;
    let savedTracks = 0;
    let filteredOut = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type && it.type !== "playlist") continue;

      const nomePl = pickStr(it, "name", "title", "playlistName") ?? "Sem nome";
      const url = pickStr(it, "url", "spotifyUrl", "playlistUrl");
      const followers = pickNum(it, "followers", "followersCount", "totalFollowers");
      const imagem = pickStr(it, "imageUrl", "coverImage", "image");
      const descricao = pickStr(it, "description", "desc");
      const totalTracks = pickNum(it, "trackCount", "tracksCount", "totalTracks");
      const ownerCountry = pickStr(it.owner ?? {}, "country") ?? pickStr(it, "ownerCountry");
      const playlistId = pickStr(it, "playlistId", "id") ?? extractPlaylistId(url);

      // Filtro inteligente
      const haystack = `${nomePl} ${descricao ?? ""} ${termLower}`.toLowerCase();
      const containsGenre = (slug && haystack.includes(slug)) || (nome && haystack.includes(nome)) || haystack.includes(termLower);
      const hitsBlacklist = blacklist.some(b => b && haystack.includes(b));
      if (!containsGenre || hitsBlacklist) {
        filteredOut++;
        continue;
      }

      // 🛡️ Guard: rejeita playlists sem ID extraível ou URL truncada/inválida.
      // Sem isso, registro fica órfão (sem dedup, sem enrich) e polui o dataset.
      if (!playlistId || !url || !/playlist\/[A-Za-z0-9]{16,}/.test(url)) {
        filteredOut++;
        continue;
      }

      // UPSERT manual (tabela tem unique parcial em (genre_id, spotify_playlist_id))
      let resultId: string | null = null;
      if (playlistId) {
        const { data: existing } = await supabase
          .from("search_results")
          .select("id,times_seen")
          .eq("genre_id", body.genre_id)
          .eq("spotify_playlist_id", playlistId)
          .maybeSingle();
        if (existing) {
          const { error: updErr } = await supabase.from("search_results").update({
            posicao: i + 1,
            nome_playlist: nomePl,
            spotify_url: url,
            seguidores: followers,
            imagem_url: imagem,
            descricao,
            total_musicas: totalTracks,
            apify_run_id: runId,
            term_id: body.term_id,
            owner_country: ownerCountry,
            times_seen: (existing.times_seen ?? 1) + 1,
            last_seen_at: new Date().toISOString(),
          }).eq("id", existing.id);
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
            seguidores: followers,
            imagem_url: imagem,
            descricao,
            total_musicas: totalTracks,
            apify_run_id: runId,
            owner_country: ownerCountry,
            times_seen: 1,
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

    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      term_id: body.term_id,
      acao: "run-search",
      status: "sucesso",
      mensagem: `"${body.search_term}" → ${savedResults} novas, ${updatedResults} atualizadas, ${filteredOut} filtradas, ${savedTracks} músicas`,
      duracao_ms: Date.now() - start,
    });

    clearTimeout(timeoutHandle);
    return new Response(
      JSON.stringify({ ok: true, savedResults, updatedResults, filteredOut, savedTracks, runId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    clearTimeout(timeoutHandle);
    const msg = (e as Error).message ?? String(e);
    console.error("run-search error", msg);

    // Circuit breaker: bloqueio do Apify (limit exceeded / 403)
    if (e instanceof ApifyBlockedError) {
      // Ativa flag global
      const { data: f } = await supabase
        .from("system_flags").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (f?.id) {
        await supabase.from("system_flags").update({
          apify_blocked: true,
          apify_blocked_at: new Date().toISOString(),
          apify_blocked_reason: msg.slice(0, 300),
        }).eq("id", f.id);
      } else {
        await supabase.from("system_flags").insert({
          apify_blocked: true,
          apify_blocked_at: new Date().toISOString(),
          apify_blocked_reason: msg.slice(0, 300),
        });
      }
      await supabase.from("collection_logs").insert({
        genre_id: body.genre_id, term_id: body.term_id,
        acao: "apify-blocked", status: "erro",
        mensagem: "Apify limit exceeded - circuit breaker activated",
        duracao_ms: Date.now() - start,
      });
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
