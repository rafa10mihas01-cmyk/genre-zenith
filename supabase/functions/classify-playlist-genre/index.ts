// classify-playlist-genre — sugere gênero para playlists sem classificação
// usando Lovable AI Gateway (Gemini Flash). Lê nome + amostra de tracks
// e escolhe o gênero mais provável entre os cadastrados em `genres`.
//
// Salva em managed_playlists.suggested_genre_id / suggestion_confidence /
// suggestion_reason / suggested_at. NÃO sobrescreve genre_id — o usuário
// confirma na UI.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const MODEL = "google/gemini-3-flash-preview";
const TRACK_SAMPLE = 25;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let playlistIds: string[] | null = null;
  let onlyMissing = true;
  try {
    const body = await req.json().catch(() => ({}));
    if (Array.isArray(body?.playlist_ids)) playlistIds = body.playlist_ids;
    if (body?.only_missing === false) onlyMissing = false;
  } catch { /* empty */ }

  // Genres disponíveis (alvo de classificação)
  const { data: genres, error: gErr } = await supabase
    .from("genres").select("id, nome").order("nome");
  if (gErr || !genres?.length) {
    return new Response(JSON.stringify({ error: "no_genres" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const genreList = genres.map((g) => g.nome).join(", ");
  const genreByName = new Map(genres.map((g) => [g.nome.toLowerCase(), g.id]));

  // Playlists candidatas
  let q = supabase
    .from("managed_playlists")
    .select("id, name, description, tracks_count")
    .neq("playlist_type", "ARCHIVED");
  if (onlyMissing) q = q.is("genre_id", null);
  if (playlistIds?.length) q = q.in("id", playlistIds);
  q = q.limit(500);
  const { data: playlists, error: pErr } = await q;
  if (pErr) {
    return new Response(JSON.stringify({ error: pErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<{
    id: string; suggested_genre: string | null;
    confidence: number; reason: string; ok: boolean; error?: string;
  }> = [];

  for (const pl of (playlists ?? [])) {
    try {
      const { data: tracks } = await supabase
        .from("managed_playlist_tracks")
        .select("track_name, artist_name")
        .eq("playlist_id", pl.id)
        .order("position", { ascending: true })
        .limit(TRACK_SAMPLE);

      const trackLines = (tracks ?? [])
        .filter((t) => t.track_name || t.artist_name)
        .map((t) => `- ${t.artist_name ?? "?"} — ${t.track_name ?? "?"}`)
        .join("\n") || "(sem faixas em cache)";

      const userPrompt =
        `Playlist: "${pl.name}"\n` +
        (pl.description ? `Descrição: ${pl.description}\n` : "") +
        `Total de faixas: ${pl.tracks_count}\n\n` +
        `Amostra de faixas:\n${trackLines}\n\n` +
        `Gêneros disponíveis: ${genreList}\n\n` +
        `Classifique a playlist em UM dos gêneros acima.`;

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: "Você é um classificador de playlists brasileiras. Responde sempre via function call. Se não houver evidência clara, use confiança baixa." },
            { role: "user", content: userPrompt },
          ],
          tools: [{
            type: "function",
            function: {
              name: "classify_playlist",
              description: "Retorna o gênero mais provável.",
              parameters: {
                type: "object",
                properties: {
                  genero: { type: "string", enum: genres.map((g) => g.nome), description: "Nome exato do gênero" },
                  confianca: { type: "integer", minimum: 0, maximum: 100, description: "0–100" },
                  motivo: { type: "string", description: "Frase curta (≤120 chars) explicando" },
                },
                required: ["genero", "confianca", "motivo"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "classify_playlist" } },
        }),
      });

      if (!aiResp.ok) {
        const txt = await aiResp.text();
        if (aiResp.status === 429) throw new Error("rate_limited");
        if (aiResp.status === 402) throw new Error("payment_required");
        throw new Error(`ai_${aiResp.status}: ${txt.slice(0, 200)}`);
      }
      const aiJson = await aiResp.json();
      const call = aiJson.choices?.[0]?.message?.tool_calls?.[0];
      const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : null;
      if (!args?.genero) throw new Error("no_classification");

      const genreId = genreByName.get(String(args.genero).toLowerCase()) ?? null;
      const confidence = Math.max(0, Math.min(100, Number(args.confianca) || 0));
      const reason = String(args.motivo ?? "").slice(0, 240);

      await supabase
        .from("managed_playlists")
        .update({
          suggested_genre_id: genreId,
          suggestion_confidence: confidence,
          suggestion_reason: reason,
          suggested_at: new Date().toISOString(),
        })
        .eq("id", pl.id);

      results.push({ id: pl.id, suggested_genre: args.genero, confidence, reason, ok: true });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      results.push({ id: pl.id, suggested_genre: null, confidence: 0, reason: "", ok: false, error: msg });
      if (msg === "rate_limited" || msg === "payment_required") break;
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  return new Response(JSON.stringify({ processed: results.length, ok, failed, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
