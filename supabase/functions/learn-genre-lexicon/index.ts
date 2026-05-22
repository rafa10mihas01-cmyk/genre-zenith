// Phase 5 — Learn SEO lexicon per subgenre from leader playlist titles.
// Strength weighted by leadership_score × recency(last_seen_at).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { recencyWeight } from "../_shared/recency.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STOPWORDS = new Set([
  "de","da","do","das","dos","e","o","a","os","as","para","pra","com","em","no","na","nos","nas",
  "um","uma","uns","umas","mais","que","por","sem","ao","aos","la","ja","sao","ser","ter","muito",
  "the","of","and","to","in","on","for","by","at","my","your","mix","playlist","top","best","new",
]);

const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

interface Tokens { words: string[]; numbers: string[]; emojis: string[]; }

function tokenize(title: string): Tokens {
  const out: Tokens = { words: [], numbers: [], emojis: [] };
  if (!title) return out;
  const emojis = title.match(EMOJI_RE) ?? [];
  out.emojis = emojis;
  const clean = title.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(EMOJI_RE, " ")
    .replace(/[^a-z0-9\s]/g, " ");
  for (const tok of clean.split(/\s+/)) {
    if (!tok) continue;
    if (/^\d{2,4}$/.test(tok)) out.numbers.push(tok);
    else if (tok.length >= 3 && !STOPWORDS.has(tok)) out.words.push(tok);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: subs } = await supabase.from("subgenres").select("id, parent_genre_id, nome").eq("ativo", true);
    if (!subs?.length) throw new Error("no subgenres");

    const results: any[] = [];

    for (const s of subs as any[]) {
      // Get playlists in this subgenre's parent genre with high confidence, then rank by leadership.
      const { data: pg } = await supabase
        .from("playlist_genres")
        .select("playlist_id")
        .eq("genre_id", s.parent_genre_id)
        .gte("confidence", 0.3)
        .limit(500);
      const ids = (pg ?? []).map((r: any) => r.playlist_id);
      if (ids.length < 5) { results.push({ subgenre: s.nome, skipped: "low_sample" }); continue; }

      const { data: pls } = await supabase
        .from("playlists")
        .select("id, name, last_seen_at, playlist_leadership(leadership_score)")
        .in("id", ids)
        .limit(500);

      // Aggregate tokens with weight
      const agg = new Map<string, { type: string; strength: number; occ: number }>();
      for (const p of (pls ?? []) as any[]) {
        const lead = Array.isArray(p.playlist_leadership) ? (p.playlist_leadership[0]?.leadership_score ?? 0) : 0;
        const w = (0.3 + lead) * recencyWeight(p.last_seen_at);
        const toks = tokenize(p.name ?? "");
        const push = (tok: string, type: string) => {
          const k = `${type}::${tok}`;
          const cur = agg.get(k) ?? { type, strength: 0, occ: 0 };
          cur.strength += w; cur.occ += 1;
          agg.set(k, cur);
        };
        toks.words.forEach((t) => push(t, "word"));
        toks.numbers.forEach((t) => push(t, "numero"));
        toks.emojis.forEach((t) => push(t, "emoji"));
      }
      if (!agg.size) { results.push({ subgenre: s.nome, skipped: "no_tokens" }); continue; }

      // Normalize strength to 0–1 per subgenre and classify status
      const max = Math.max(...Array.from(agg.values()).map((v) => v.strength));
      const rows = Array.from(agg.entries()).map(([k, v]) => {
        const token = k.split("::")[1];
        const strength = Number((v.strength / max).toFixed(4));
        const status = strength >= 0.6 ? "forte" : strength >= 0.25 ? "ativo" : "fraco";
        return {
          subgenre_id: s.id,
          genre_id: s.parent_genre_id,
          token,
          token_type: v.type,
          strength,
          occurrences: v.occ,
          status,
          last_seen: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      })
      .filter((r) => r.occurrences >= 2) // signal floor
      .slice(0, 200);

      if (rows.length) {
        await supabase.from("genre_seo_lexicon").upsert(rows, { onConflict: "subgenre_id,token,token_type" });
      }

      // Mark stale tokens as 'morto' (not seen in this run, last_seen > 60d)
      const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString();
      await supabase
        .from("genre_seo_lexicon")
        .update({ status: "morto" })
        .eq("subgenre_id", s.id)
        .lt("last_seen", cutoff);

      results.push({ subgenre: s.nome, tokens: rows.length, sample: pls?.length ?? 0 });
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
