// compute-genre-affinities — calcula afinidade entre subgêneros.
// Híbrido: lexicon (tokens compartilhados em genre_brain.top_tokens) + manual seeds.
// method='manual' tem prioridade e nunca é sobrescrito por lexicon puro.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Seeds manuais por slug (lowercase). Pares simétricos.
const MANUAL_SEEDS: Array<[string, string, number, string]> = [
  ["funk", "eletrofunk", 0.95, "Eletrofunk é derivação direta do funk"],
  ["funk", "trap", 0.80, "Trap-funk: BPM e estética próximos"],
  ["trap", "rap", 0.85, "Trap nasceu do rap"],
  ["piseiro", "forro", 0.90, "Piseiro é evolução do forró eletrônico"],
  ["sertanejo", "agro", 0.85, "Mesmo público / lifestyle agro"],
  ["sertanejo", "forro", 0.65, "Compartilham público nordestino/interior"],
  ["pagode", "pop", 0.55, "Pagode romântico cruza com pop nacional"],
  ["reggaeton", "funk", 0.70, "Estética urbana latina próxima do funk"],
  ["reggaeton", "trap", 0.75, "Reggaeton trap é categoria estabelecida"],
  ["forro", "axe", 0.55, "Festas nordestinas/regionais"],
];

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {


    // 1) Carrega gêneros ativos + brain
    const { data: genres, error: gErr } = await sb
      .from("genres")
      .select("id, slug, nome")
      .eq("ativo", true);
    if (gErr) throw gErr;
    if (!genres?.length) return jr({ ok: true, pairs: 0, message: "sem gêneros" });

    const bySlug = new Map<string, { id: string; nome: string }>();
    for (const g of genres) bySlug.set(String(g.slug).toLowerCase(), { id: g.id, nome: g.nome });

    const { data: brain } = await sb
      .from("genre_brain")
      .select("genre_id, top_tokens");
    const tokensByGenre = new Map<string, Map<string, number>>();
    for (const b of brain ?? []) {
      const m = new Map<string, number>();
      for (const t of (b.top_tokens as any[]) ?? []) {
        const tok = String(t?.token ?? "").toLowerCase().trim();
        const str = Number(t?.strength ?? 0);
        if (tok) m.set(tok, str);
      }
      tokensByGenre.set(b.genre_id, m);
    }

    // 2) Para cada par (a<b), calcula lexicon score
    const out: Array<{
      genre_a_id: string; genre_b_id: string;
      lexicon: number; manual: number | null; shared: string[];
    }> = [];

    const ids = genres.map(g => g.id).sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        const ta = tokensByGenre.get(a) ?? new Map();
        const tb = tokensByGenre.get(b) ?? new Map();
        let interSum = 0, unionSum = 0;
        const shared: Array<{ token: string; w: number }> = [];
        const all = new Set<string>([...ta.keys(), ...tb.keys()]);
        for (const tok of all) {
          const va = ta.get(tok) ?? 0;
          const vb = tb.get(tok) ?? 0;
          const mn = Math.min(va, vb);
          const mx = Math.max(va, vb);
          interSum += mn;
          unionSum += mx;
          if (mn > 0) shared.push({ token: tok, w: mn });
        }
        const lex = unionSum > 0 ? interSum / unionSum : 0; // Jaccard ponderado
        out.push({
          genre_a_id: a,
          genre_b_id: b,
          lexicon: Number(lex.toFixed(3)),
          manual: null,
          shared: shared.sort((x, y) => y.w - x.w).slice(0, 8).map(s => s.token),
        });
      }
    }

    // 3) Aplica manual seeds
    const seedMap = new Map<string, { score: number; note: string }>();
    for (const [sa, sb_, score, note] of MANUAL_SEEDS) {
      const ga = bySlug.get(sa.toLowerCase());
      const gb = bySlug.get(sb_.toLowerCase());
      if (!ga || !gb) continue;
      const [a, b] = orderPair(ga.id, gb.id);
      seedMap.set(`${a}|${b}`, { score, note });
    }

    const rows = out.map(r => {
      const key = `${r.genre_a_id}|${r.genre_b_id}`;
      const seed = seedMap.get(key);
      let method: "lexicon" | "manual" | "hybrid" = "lexicon";
      let score = r.lexicon;
      let notes: string | null = null;
      let manual_score: number | null = null;
      if (seed) {
        manual_score = seed.score;
        notes = seed.note;
        if (r.lexicon > 0) {
          method = "hybrid";
          score = Math.max(seed.score, 0.5 * seed.score + 0.5 * r.lexicon);
        } else {
          method = "manual";
          score = seed.score;
        }
      }
      return {
        genre_a_id: r.genre_a_id,
        genre_b_id: r.genre_b_id,
        score: Number(score.toFixed(3)),
        method,
        lexicon_score: r.lexicon,
        manual_score,
        shared_tokens: r.shared,
        notes,
        computed_at: new Date().toISOString(),
      };
    });

    // 4) Só persiste pares com score > 0 (descarta ruído puro)
    const toUpsert = rows.filter(r => r.score > 0);

    // Protege overrides manuais existentes: leitura prévia
    const { data: existing } = await sb
      .from("genre_affinities")
      .select("genre_a_id, genre_b_id, method, score, notes");
    const existingMap = new Map<string, { method: string; score: number; notes: string | null }>();
    for (const e of existing ?? []) {
      existingMap.set(`${e.genre_a_id}|${e.genre_b_id}`, { method: e.method, score: Number(e.score), notes: e.notes });
    }

    // Se já existe linha method='manual' SEM seed correspondente nesta rodada, preserva.
    const filtered = toUpsert.filter(r => {
      const ex = existingMap.get(`${r.genre_a_id}|${r.genre_b_id}`);
      if (!ex) return true;
      if (ex.method === "manual" && r.method === "lexicon") return false; // não pisa override humano
      return true;
    });

    if (filtered.length) {
      // upsert em chunks
      for (let i = 0; i < filtered.length; i += 200) {
        const { error: upErr } = await sb
          .from("genre_affinities")
          .upsert(filtered.slice(i, i + 200), { onConflict: "genre_a_id,genre_b_id" });
        if (upErr) throw upErr;
      }
    }

    const metrics = {
      computed: rows.length,
      persisted: filtered.length,
      manual_seeds: seedMap.size,
      with_lexicon: rows.filter(r => r.lexicon_score > 0).length,
    };
    await reportCronHealth(sb, {
      job_name: "compute-genre-affinities",
      status: "ok",
      startedAt,
      metrics,
    });
    return jr({ ok: true, ...metrics });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("compute-genre-affinities error", msg);
    await reportCronHealth(sb, {
      job_name: "compute-genre-affinities",
      status: "error",
      startedAt,
      message: msg,
    });
    return jr({ ok: false, error: msg }, 500);
  }
});
