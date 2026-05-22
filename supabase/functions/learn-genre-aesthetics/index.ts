// Phase 5 — Learn visual signature per subgenre via Lovable AI vision on top covers.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const MAX_COVERS_PER_SUBGENRE = 8;

async function analyzeCovers(urls: string[]): Promise<any | null> {
  if (!urls.length) return null;
  const content: any[] = [
    {
      type: "text",
      text:
        "Você é um analista visual de capas de playlist do Spotify. Analise estas capas (pertencem ao mesmo subgênero musical) e responda APENAS um JSON com este formato exato, sem markdown:\n" +
        '{"dominant_colors":["#RRGGBB", ...up to 5],"contrast_avg":0..1,"has_face_pct":0..1,"aggressiveness_score":0..1,"style_tags":["tag1","tag2", ...up to 6]}\n' +
        "Tags possíveis: minimal, maximal, tipografico, fotografico, ilustrado, neon, escuro, claro, vibrante, sensual, agressivo, rural, urbano, retro, moderno, 3d, glitch, gradient.",
    },
    ...urls.map((u) => ({ type: "image_url", image_url: { url: u } })),
  ];

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!LOVABLE_KEY) throw new Error("LOVABLE_API_KEY missing");
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const onlySubgenreId: string | undefined = body.subgenre_id;

    let q = supabase.from("subgenres").select("id, parent_genre_id, nome").eq("ativo", true);
    if (onlySubgenreId) q = q.eq("id", onlySubgenreId);
    const { data: subs } = await q;
    if (!subs?.length) throw new Error("no subgenres");

    const results: any[] = [];
    for (const s of subs as any[]) {
      // Pick top leadership playlists in parent genre with non-null cover
      const { data: pg } = await supabase
        .from("playlist_genres")
        .select("playlist_id")
        .eq("genre_id", s.parent_genre_id)
        .gte("confidence", 0.3)
        .limit(300);
      const ids = (pg ?? []).map((r: any) => r.playlist_id);
      if (ids.length < 3) { results.push({ subgenre: s.nome, skipped: "low_sample" }); continue; }

      const { data: pls } = await supabase
        .from("playlists")
        .select("id, cover_url, playlist_leadership(leadership_score)")
        .in("id", ids)
        .not("cover_url", "is", null)
        .limit(300);
      const ranked = (pls ?? [])
        .map((p: any) => ({
          url: p.cover_url,
          score: Array.isArray(p.playlist_leadership) ? (p.playlist_leadership[0]?.leadership_score ?? 0) : 0,
        }))
        .filter((p: any) => p.url)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, MAX_COVERS_PER_SUBGENRE)
        .map((p: any) => p.url);
      if (ranked.length < 3) { results.push({ subgenre: s.nome, skipped: "no_covers" }); continue; }

      const sig = await analyzeCovers(ranked);
      if (!sig) { results.push({ subgenre: s.nome, skipped: "ai_failed" }); continue; }

      await supabase.from("genre_visual_signature").upsert({
        subgenre_id: s.id,
        genre_id: s.parent_genre_id,
        dominant_colors: Array.isArray(sig.dominant_colors) ? sig.dominant_colors.slice(0, 5) : [],
        contrast_avg: typeof sig.contrast_avg === "number" ? sig.contrast_avg : null,
        has_face_pct: typeof sig.has_face_pct === "number" ? sig.has_face_pct : null,
        aggressiveness_score: typeof sig.aggressiveness_score === "number" ? sig.aggressiveness_score : null,
        style_tags: Array.isArray(sig.style_tags) ? sig.style_tags.slice(0, 6) : [],
        sample_size: ranked.length,
        calculated_at: new Date().toISOString(),
      }, { onConflict: "subgenre_id" });

      results.push({ subgenre: s.nome, sample: ranked.length, sig });
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
