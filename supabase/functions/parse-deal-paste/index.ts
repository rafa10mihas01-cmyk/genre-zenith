// parse-deal-paste — recebe texto colado pelo usuário com info de playlists/plays
// e usa Lovable AI para estruturar em JSON limpo. O cliente usa esse JSON
// pra gerar um PDF organizado.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM = `Você organiza dados colados sobre playlists do Spotify e plays de músicas.
A entrada é um texto cru (copiar/colar) que pode vir bagunçado, com lixo, headers de site, emojis.
Sua missão: extrair APENAS o que importa e devolver JSON estrito.

Regras CRÍTICAS sobre LINKS (chave de identidade):
- TODA playlist do Sposity aparece com uma URL no formato https://open.spotify.com/playlist/<ID>.
- O LINK é a IDENTIDADE ÚNICA da playlist. SEMPRE capture o "spotify_url" se ele aparecer no texto, mesmo que esteja em outra linha próxima ao nome.
- NÃO invente links. Se não houver URL clara associada à playlist, deixe "spotify_url" como null.
- Se o link aparece "colado" ao nome (ex.: "Funk 2026https://open.spotify.com/playlist/abc"), separe corretamente.

Outras regras:
- Identifique cada playlist mencionada e o número de plays (ou ouvintes/streams) associado a ela.
- Se houver um total geral de plays da música, extraia em "total_plays".
- Se houver nome da música ou artista, extraia também.
- Ignore cabeçalhos, menus, propaganda, datas irrelevantes.
- Números podem vir como "1.234", "1,234", "1.2k", "1.2M" — converta para inteiro absoluto (1234, 1200, 1200000).
- NUNCA invente dados. Se não tem certeza, omita o campo.

Devolva JSON EXATAMENTE neste formato (sem markdown, sem texto extra):
{
  "song_name": "string ou null",
  "song_artist": "string ou null",
  "total_plays": number ou null,
  "playlists": [
    { "name": "string", "plays": number ou null, "spotify_url": "string ou null" }
  ]
}`;

// Extrai o ID canônico de uma URL de playlist do Spotify.
// Aceita variações com query string, http/https, com ou sem www.
function extractSpotifyPlaylistId(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/playlist[/:]([a-zA-Z0-9]{16,})/);
  return m ? m[1] : null;
}

function firstJson(raw: string): unknown | null {
  if (!raw) return null;
  // remove fences ```json ... ```
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { /* continua */ }
  // fallback: pega primeiro { ... } balanceado
  let depth = 0, start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && start >= 0) {
      try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
    }}
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const text = typeof body?.text === "string" ? body.text : "";
    if (!text || text.trim().length < 5) {
      return jr({ ok: false, error: "Texto vazio ou muito curto" }, 400);
    }

    // limita pra não estourar contexto
    const safeText = text.slice(0, 60_000);

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
        max_tokens: 4096,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      if (aiRes.status === 429) {
        return jr({ ok: false, error: "Limite de IA atingido, tente em alguns instantes" }, 200);
      }
      if (aiRes.status === 402) {
        return jr({ ok: false, error: "Créditos de IA esgotados" }, 200);
      }
      return jr({ ok: false, error: `IA falhou: ${errText.slice(0, 300)}` }, 200);
    }

    const aiJson = await aiRes.json();
    const content = aiJson?.choices?.[0]?.message?.content ?? "";
    const parsed = firstJson(content);

    if (!parsed || typeof parsed !== "object") {
      return jr({ ok: false, error: "IA não retornou JSON válido", raw: String(content).slice(0, 500) }, 200);
    }

    // sanitiza
    const p = parsed as Record<string, unknown>;
    const playlistsRaw = Array.isArray(p.playlists) ? p.playlists : [];
    const playlists = playlistsRaw
      .filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
      .map((it) => {
        const url = typeof it.spotify_url === "string" ? it.spotify_url.trim() : null;
        const spotify_id = extractSpotifyPlaylistId(url);
        return {
          name: typeof it.name === "string" ? it.name.trim() : "",
          plays: typeof it.plays === "number" && Number.isFinite(it.plays) ? Math.round(it.plays) : null,
          spotify_url: url && url.length > 0 ? url : null,
          spotify_id,
        };
      })
      .filter((it) => it.name.length > 0);

    const totalFromAi = typeof p.total_plays === "number" && Number.isFinite(p.total_plays)
      ? Math.round(p.total_plays as number) : null;
    const sumPlays = playlists.reduce((acc, x) => acc + (x.plays ?? 0), 0);
    const total_plays = totalFromAi ?? (sumPlays > 0 ? sumPlays : null);

    return jr({
      ok: true,
      song_name: typeof p.song_name === "string" ? p.song_name : null,
      song_artist: typeof p.song_artist === "string" ? p.song_artist : null,
      total_plays,
      playlists,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
