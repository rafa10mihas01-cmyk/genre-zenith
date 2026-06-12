// enrich-curator-paste — recebe texto colado do "Spotify for Artists" (Playlists)
// e usa Lovable AI (Gemini Flash) pra estruturar em JSON. Depois busca cada
// playlist no Spotify, classifica (curator/baseline/editorial/suspicious/organic)
// e salva em curator_playlists + grava o histórico em curator_paste_imports.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  classifyPlaylist,
  fetchPlaylistMeta,
  type MatchStatus,
} from "../_shared/curator-playlist.ts";
import { bumpAiQuota, checkAiQuota, aiQuotaResponse, logAiUsage } from "../_shared/rate-limit.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM = `Você organiza dados colados da tela "Playlists" do Spotify for Artists.
A entrada é um texto cru com a lista de playlists onde uma música apareceu.
Cada linha (ou bloco) traz: posição (#), nome da playlist, criador (curador ou "Editorial Spotify"), seguidores, streams (7 dias / 28 dias / total), data em que a música foi adicionada.

Sua missão: extrair APENAS o que importa em JSON estrito.

Regras:
- "creator" pode ser "Editorial Spotify", "Organic" ou nome do curador. Se aparecer "Editorial Spotify", devolva exatamente "Editorial Spotify".
- "added_at" é a data em que a música entrou na playlist (formato YYYY-MM-DD). Aceite "Apr 12, 2026", "12/04/26", "12 de abr de 2026", "Apr 12" (assuma ano atual). Converta sempre pra YYYY-MM-DD. Se não aparecer, use null.
- "streams_7d", "streams_28d", "streams_total" são números. Aceite "1.234", "1,234", "1.2k", "1.2M", "1B". Converta pro inteiro absoluto. Se não aparecer, use null.
- "followers" é o número de seguidores da playlist. Mesma conversão. Se não aparecer, null.
- "position" é o número da linha (#1, #2…). Se não aparecer, null.
- Ignore cabeçalhos da página, navegação, propaganda.
- NUNCA invente dados.

Devolva JSON EXATO (sem markdown):
{
  "playlists": [
    {
      "position": number ou null,
      "name": "string",
      "creator": "string ou null",
      "followers": number ou null,
      "streams_7d": number ou null,
      "streams_28d": number ou null,
      "streams_total": number ou null,
      "added_at": "YYYY-MM-DD ou null"
    }
  ]
}`;

function firstJson(raw: string): unknown | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch { /* continua */ }
  let depth = 0, start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch { return null; }
      }
    }
  }
  return null;
}

type ParsedRow = {
  position: number | null;
  name: string;
  creator: string | null;
  followers: number | null;
  streams_7d: number | null;
  streams_28d: number | null;
  streams_total: number | null;
  added_at: string | null;
};

async function callAI(text: string): Promise<{ rows: ParsedRow[]; tokens: number }> {
  const safeText = text.slice(0, 80_000);
  const aiRes = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: safeText },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 8192,
      }),
    },
  );
  if (!aiRes.ok) {
    const errText = await aiRes.text();
    if (aiRes.status === 429) throw new Error("Limite de IA atingido, tente em alguns instantes");
    if (aiRes.status === 402) throw new Error("Créditos de IA esgotados");
    throw new Error(`IA falhou: ${errText.slice(0, 300)}`);
  }
  const aiJson = await aiRes.json();
  const content = aiJson?.choices?.[0]?.message?.content ?? "";
  const tokens = Number(aiJson?.usage?.total_tokens ?? 0) || 0;
  const parsed = firstJson(content) as { playlists?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.playlists)) {
    throw new Error("IA não retornou JSON válido");
  }
  const rows = (parsed.playlists as Record<string, unknown>[])
    .map((it): ParsedRow => ({
      position: typeof it.position === "number" ? Math.round(it.position) : null,
      name: typeof it.name === "string" ? it.name.trim() : "",
      creator: typeof it.creator === "string" ? it.creator.trim() : null,
      followers: typeof it.followers === "number" ? Math.round(it.followers) : null,
      streams_7d: typeof it.streams_7d === "number" ? Math.round(it.streams_7d) : null,
      streams_28d: typeof it.streams_28d === "number" ? Math.round(it.streams_28d) : null,
      streams_total: typeof it.streams_total === "number" ? Math.round(it.streams_total) : null,
      added_at: typeof it.added_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.added_at)
        ? it.added_at
        : null,
    }))
    .filter((it) => it.name.length > 0);
  return { rows, tokens };
}

/** Busca a playlist no Spotify pelo nome + creator. Retorna o melhor match. */
async function searchSpotifyPlaylist(
  name: string,
  creator: string | null,
): Promise<string | null> {
  const { getSpotifyToken, guardedSpotifyFetch } = await import("../_shared/spotify.ts");
  const token = await getSpotifyToken();
  const q = encodeURIComponent(name);
  const res = await guardedSpotifyFetch(
    `https://api.spotify.com/v1/search?type=playlist&limit=10&q=${q}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const j = await res.json();
  const items = (j?.playlists?.items ?? []).filter(Boolean) as Array<{
    id: string;
    name: string;
    owner?: { display_name?: string; id?: string };
  }>;
  if (items.length === 0) return null;

  const targetName = name.trim().toLowerCase();
  const targetCreator = (creator || "").trim().toLowerCase();

  // 1) Match exato de nome + creator
  if (targetCreator) {
    const exact = items.find(
      (p) =>
        p.name?.trim().toLowerCase() === targetName &&
        (p.owner?.display_name?.toLowerCase() === targetCreator ||
          p.owner?.id?.toLowerCase() === targetCreator),
    );
    if (exact) return exact.id;
  }
  // 2) Match exato só de nome
  const nameMatch = items.find((p) => p.name?.trim().toLowerCase() === targetName);
  if (nameMatch) return nameMatch.id;
  // 3) Primeiro resultado
  return items[0]?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const dealId = typeof body?.deal_id === "string" ? body.deal_id : null;
    const songId = typeof body?.song_id === "string" ? body.song_id : null;
    const text = typeof body?.text === "string" ? body.text : "";
    const dryRun = body?.dry_run === true;

    if (!dealId) return jr({ ok: false, error: "deal_id obrigatório" }, 400);
    if (!text || text.trim().length < 10) {
      return jr({ ok: false, error: "Texto vazio ou muito curto" }, 400);
    }

    // Auth: precisa ser admin (dono do deal). Public token NÃO acessa esse fluxo.
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await supabaseAuth.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return jr({ ok: false, error: "Não autenticado" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Carrega o deal e valida ownership
    const { data: deal, error: dealErr } = await supabase
      .from("curator_deals")
      .select("id, user_id, started_at, spotify_owner_id")
      .eq("id", dealId)
      .maybeSingle();
    if (dealErr) return jr({ ok: false, error: dealErr.message }, 500);
    if (!deal) return jr({ ok: false, error: "Deal não encontrado" }, 404);
    if (deal.user_id !== userId) return jr({ ok: false, error: "Sem permissão" }, 403);

    // Carrega playlists existentes do deal pra detectar sósia
    const { data: existing } = await supabase
      .from("curator_playlists")
      .select("playlist_name, spotify_owner_id, match_status")
      .eq("deal_id", dealId);
    const curatorNames = (existing ?? [])
      .filter((p) => p.match_status === "curator" || p.match_status === "baseline")
      .map((p) => p.playlist_name);

    // Onda 1: carrega IDs do ecossistema ativo pra impedir gravar como curator_playlist.
    const { data: ecoRows } = await supabase
      .from("managed_playlists")
      .select("spotify_playlist_id")
      .is("archived_at", null);
    const ecoIds = new Set(
      (ecoRows ?? [])
        .map((r) => r.spotify_playlist_id)
        .filter((v): v is string => !!v),
    );

    // Quota check: bloqueia se usuário estourou cap mensal.
    const quota = await checkAiQuota(userId);
    if (!quota.allowed) return aiQuotaResponse(corsHeaders);

    // 1) Parse via IA
    let parsed: ParsedRow[];
    let aiTokens = 0;
    const aiStart = Date.now();
    try {
      const out = await callAI(text);
      parsed = out.rows;
      aiTokens = out.tokens;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logAiUsage({
        userId,
        functionName: "enrich-curator-paste",
        model: "google/gemini-2.5-flash",
        durationMs: Date.now() - aiStart,
        status: "error",
        error: msg.slice(0, 300),
        metadata: { deal_id: dealId },
      });
      return jr({ ok: false, error: msg }, 200);
    }

    // Conta tokens (quota) e loga o uso (observabilidade).
    if (aiTokens > 0) await bumpAiQuota(userId, aiTokens);
    await logAiUsage({
      userId,
      functionName: "enrich-curator-paste",
      model: "google/gemini-2.5-flash",
      tokensTotal: aiTokens,
      durationMs: Date.now() - aiStart,
      status: "ok",
      metadata: { deal_id: dealId, parsed_rows: parsed.length },
    });

    if (parsed.length === 0) {
      return jr({ ok: false, error: "Nenhuma playlist encontrada no texto" }, 200);
    }

    // 2) Para cada linha, tenta achar a playlist no Spotify e classificar
    const results: Array<{
      name: string;
      spotify_url: string | null;
      match_status: MatchStatus;
      match_reason: string;
      streams_7d: number;
      streams_28d: number;
      streams_total: number;
      followers: number | null;
      added_at: string | null;
      position: number | null;
      isNew: boolean;
      error?: string;
    }> = [];

    const counts = {
      new: 0,
      baseline: 0,
      editorial: 0,
      curator: 0,
      suspicious: 0,
      organic: 0,
    };

    for (const row of parsed) {
      try {
        let spotifyId: string | null = null;
        // Editorial Spotify: força owner=spotify, dispensa busca
        const isEditorialHint = (row.creator || "").toLowerCase().includes("editorial");

        if (!isEditorialHint) {
          spotifyId = await searchSpotifyPlaylist(row.name, row.creator);
        }

        let meta = spotifyId ? await fetchPlaylistMeta(spotifyId) : null;

        // Se não achou no Spotify, tenta como editorial sintético (sem URL)
        if (!meta) {
          if (isEditorialHint) {
            meta = {
              id: "",
              name: row.name,
              owner_id: "spotify",
              owner_name: "Spotify",
              followers: row.followers ?? 0,
              image_url: null,
              total_tracks: 0,
            };
          } else {
            results.push({
              name: row.name,
              spotify_url: null,
              match_status: "organic",
              match_reason: "playlist não encontrada no Spotify",
              streams_7d: row.streams_7d ?? 0,
              streams_28d: row.streams_28d ?? 0,
              streams_total: row.streams_total ?? 0,
              followers: row.followers,
              added_at: row.added_at,
              position: row.position,
              isNew: false,
              error: "not_found",
            });
            counts.organic++;
            continue;
          }
        }

        const cls = classifyPlaylist({
          playlist: meta,
          dealOwnerId: deal.spotify_owner_id ?? null,
          dealStartedAt: deal.started_at,
          addedAtSpotify: row.added_at,
          curatorPlaylistNames: curatorNames,
        });

        const spotifyUrl = meta.id ? `https://open.spotify.com/playlist/${meta.id}` : null;

        // 3) Upsert na curator_playlists (se não for dry_run)
        let isNew = false;
        if (!dryRun && meta.id) {
          const { data: foundExisting } = await supabase
            .from("curator_playlists")
            .select("id")
            .eq("deal_id", dealId)
            .eq("spotify_playlist_id", meta.id)
            .maybeSingle();

          isNew = !foundExisting;

          const payload = {
            deal_id: dealId,
            song_id: songId,
            spotify_url: spotifyUrl,
            spotify_playlist_id: meta.id,
            spotify_owner_id: meta.owner_id,
            spotify_owner_name: meta.owner_name,
            playlist_name: meta.name,
            followers: meta.followers,
            image_url: meta.image_url,
            added_at_spotify: row.added_at,
            match_status: cls.match_status,
            match_reason: cls.match_reason,
            streams_7d: row.streams_7d ?? 0,
            streams_28d: row.streams_28d ?? 0,
            streams_total: row.streams_total ?? 0,
            position_in_paste: row.position,
            last_paste_at: new Date().toISOString(),
            is_baseline: cls.match_status === "baseline",
          };

          if (foundExisting) {
            await supabase
              .from("curator_playlists")
              .update(payload)
              .eq("id", foundExisting.id);
          } else {
            await supabase.from("curator_playlists").insert(payload);
          }
        }

        results.push({
          name: meta.name,
          spotify_url: spotifyUrl,
          match_status: cls.match_status,
          match_reason: cls.match_reason,
          streams_7d: row.streams_7d ?? 0,
          streams_28d: row.streams_28d ?? 0,
          streams_total: row.streams_total ?? 0,
          followers: meta.followers,
          added_at: row.added_at,
          position: row.position,
          isNew,
        });
        counts[cls.match_status]++;
        if (isNew) counts.new++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({
          name: row.name,
          spotify_url: null,
          match_status: "organic",
          match_reason: `erro: ${msg}`,
          streams_7d: row.streams_7d ?? 0,
          streams_28d: row.streams_28d ?? 0,
          streams_total: row.streams_total ?? 0,
          followers: row.followers,
          added_at: row.added_at,
          position: row.position,
          isNew: false,
          error: msg,
        });
      }
    }

    const totalStreams7d = results.reduce((acc, r) => acc + (r.streams_7d ?? 0), 0);

    // 4) Salva histórico de import
    if (!dryRun) {
      await supabase.from("curator_paste_imports").insert({
        deal_id: dealId,
        song_id: songId,
        raw_text: text.slice(0, 200_000),
        parsed_count: results.length,
        new_count: counts.new,
        baseline_count: counts.baseline,
        editorial_count: counts.editorial,
        curator_count: counts.curator,
        suspicious_count: counts.suspicious,
        organic_count: counts.organic,
        total_streams_7d: totalStreams7d,
        imported_by: userId,
      });
    }

    // Fire-and-forget: regenera plano de entrega após paste real
    if (!dryRun) {
      fetch(`${SUPABASE_URL}/functions/v1/build-deal-plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ deal_id: dealId }),
      }).catch((err) => console.error("[enrich-curator-paste] build-deal-plan trigger falhou", err));
    }

    return jr({
      ok: true,
      dry_run: dryRun,
      counts: { ...counts, total: results.length },
      total_streams_7d: totalStreams7d,
      results,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
