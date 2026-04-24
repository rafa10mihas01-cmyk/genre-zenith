// seed-editorial-terms — usa LLM pra gerar 6-10 termos editoriais específicos por gênero
// (Top, Viral, Hits, Novidades, etc) e insere em search_terms (skip se já existem).
//
// Esses termos puxam playlists de curadoria editorial (Spotify oficial + grandes
// curadores), elevando a qualidade da base de replicação.
//
// POST { genre_id: string } → { ok, created, total, terms: [...] }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SCHEMA = {
  type: "object",
  properties: {
    terms: {
      type: "array",
      minItems: 6,
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          termo: { type: "string", description: "Termo de busca em português, curto e direto" },
          rationale: { type: "string", description: "Por que esse termo traz playlists editoriais/oficiais" },
        },
        required: ["termo", "rationale"],
      },
    },
  },
  required: ["terms"],
};

async function callLLM(genreNome: string): Promise<{ termo: string; rationale: string }[]> {
  const system = `Você gera TERMOS DE BUSCA EDITORIAIS pro Spotify.
Objetivo: termos que tipicamente trazem playlists de CURADORIA EDITORIAL (oficiais Spotify
ou de grandes curadores), não playlists pessoais comuns.

Padrões editoriais conhecidos no mercado brasileiro:
- "Top [Gênero]" / "Top [Gênero] Brasil"
- "Viral [Gênero]" / "Viral Brasil [Gênero]"
- "[Gênero] Hits" / "Hits [Gênero]"
- "Novidades [Gênero]"
- "[Gênero] em Alta"
- "Esquenta [Gênero]" (se aplicável)
- BPM/sub-categorias quando o gênero tem (ex: "Funk 150 BPM", "Sertanejo Universitário")

Regras:
- 6 a 10 termos
- Foco em editorial, evite genéricos como só "Sertanejo"
- Se o gênero tem sub-estilos famosos (ex: Sertanejo Universitário, Funk Carioca, Piseiro Atualizado), inclua 1-2
- Português brasileiro
- NÃO inclua emojis, anos (2024/2025/2026 são genéricos demais)`;

  const user = `Gere termos editoriais para o gênero: "${genreNome}"`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      max_tokens: 800,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{
        type: "function",
        function: { name: "emit_terms", description: "Emit editorial search terms.", parameters: SCHEMA },
      }],
      tool_choice: { type: "function", function: { name: "emit_terms" } },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Lovable AI ${resp.status}: ${t.slice(0, 300)}`);
  }
  const j = await resp.json();
  const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("LLM returned no tool_call");
  const parsed = JSON.parse(args);
  return parsed.terms ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);
  if (!LOVABLE_API_KEY) return jr({ error: "LOVABLE_API_KEY not configured" }, 500);

  let body: { genre_id?: string };
  try { body = await req.json(); } catch { return jr({ error: "invalid json" }, 400); }
  if (!body.genre_id) return jr({ error: "genre_id required" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const start = Date.now();

  const { data: genre } = await supabase
    .from("genres").select("id,nome").eq("id", body.genre_id).maybeSingle();
  if (!genre) return jr({ error: "genre not found" }, 404);

  let terms: { termo: string; rationale: string }[] = [];
  try {
    terms = await callLLM(genre.nome);
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
  if (terms.length === 0) return jr({ ok: false, error: "LLM returned 0 terms" }, 500);

  // Dedup contra existentes (case-insensitive)
  const { data: existing } = await supabase
    .from("search_terms").select("termo").eq("genre_id", body.genre_id);
  const existingSet = new Set((existing ?? []).map((e: any) => (e.termo ?? "").toLowerCase()));
  const fresh = terms.filter(t => !existingSet.has(t.termo.toLowerCase()));

  if (fresh.length > 0) {
    const rows = fresh.map(t => ({
      genre_id: body.genre_id!,
      termo: t.termo,
      tipo: "editorial",
    }));
    const { error: iErr } = await supabase.from("search_terms").insert(rows);
    if (iErr) return jr({ ok: false, error: iErr.message }, 500);
  }

  const { count } = await supabase
    .from("search_terms").select("*", { count: "exact", head: true }).eq("genre_id", body.genre_id);
  await supabase.from("genres").update({ total_termos: count ?? 0 }).eq("id", body.genre_id);

  await supabase.from("collection_logs").insert({
    genre_id: body.genre_id,
    acao: "seed-editorial-terms",
    status: "sucesso",
    mensagem: `${fresh.length} termos editoriais novos (total ${count}) • LLM gerou ${terms.length}`,
    duracao_ms: Date.now() - start,
  });

  return jr({
    ok: true,
    genre: genre.nome,
    created: fresh.length,
    skipped: terms.length - fresh.length,
    total_terms: count ?? 0,
    terms: terms.map(t => ({ termo: t.termo, rationale: t.rationale, novo: !existingSet.has(t.termo.toLowerCase()) })),
  });
});
