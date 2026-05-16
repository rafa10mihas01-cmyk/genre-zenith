// generate-terms — gera termos de busca para um gênero (ou todos)
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  genre_id?: string;
  all?: boolean;
}

function buildTerms(nome: string): { termo: string; tipo: string }[] {
  const terms: { termo: string; tipo: string }[] = [];
  // PREFIXO: progressive typing
  const stripped = nome.toLowerCase();
  const prefixLens = new Set<number>();
  for (let i = 1; i <= Math.min(4, stripped.length); i++) {
    prefixLens.add(i);
  }
  for (const len of prefixLens) {
    terms.push({ termo: stripped.slice(0, len), tipo: "prefixo" });
  }
  // COMPLETO
  terms.push({ termo: nome, tipo: "completo" });

  const variations = [
    `${nome} 2024`, `${nome} 2025`, `${nome} 2026`, `${nome} viral`,
    `${nome} atualizado`, `${nome} novo`, `${nome} hit`, `${nome} top`,
    `${nome} hits`, `${nome} brasil`, `${nome} br`, `playlist ${nome}`,
    `músicas de ${nome}`, `${nome} lançamento`, `melhor ${nome}`, `top ${nome}`,
  ];
  for (const v of variations) terms.push({ termo: v, tipo: "variacao" });

  const contextual = [
    `${nome} para academia`, `${nome} para festa`, `${nome} para relaxar`,
    `${nome} para trabalhar`, `${nome} para dirigir`, `${nome} para dormir`,
    `${nome} remix`, `${nome} ao vivo`, `o melhor do ${nome}`, `só ${nome}`,
  ];
  for (const v of contextual) terms.push({ termo: v, tipo: "contextual" });

  // Dedupe
  const seen = new Set<string>();
  return terms.filter((t) => {
    const k = t.termo.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

Deno.serve(async (req) => {
  const __dep = await deprecationGate(req, "generate-terms");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  try {
    const body: Body = req.method === "POST" ? await req.json() : {};
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: genres, error: gErr } = body.all
      ? await supabase.from("genres").select("id,nome").eq("ativo", true)
      : await supabase.from("genres").select("id,nome").eq("id", body.genre_id!).limit(1);

    if (gErr) throw gErr;
    if (!genres || genres.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum gênero encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let totalCreated = 0;
    const summary: { genre: string; created: number; total: number }[] = [];

    for (const g of genres) {
      const start = Date.now();
      const all = buildTerms(g.nome);

      // Get existing terms to avoid duplicates
      const { data: existing } = await supabase.from("search_terms").select("termo").eq("genre_id", g.id);
      const existingSet = new Set((existing ?? []).map((e: any) => e.termo.toLowerCase()));
      const fresh = all.filter((t) => !existingSet.has(t.termo.toLowerCase()));

      if (fresh.length > 0) {
        const rows = fresh.map((t) => ({ genre_id: g.id, termo: t.termo, tipo: t.tipo }));
        const { error: iErr } = await supabase.from("search_terms").insert(rows);
        if (iErr) throw iErr;
      }

      // Update genre.total_termos
      const { count } = await supabase
        .from("search_terms")
        .select("*", { count: "exact", head: true })
        .eq("genre_id", g.id);
      await supabase.from("genres").update({ total_termos: count ?? 0 }).eq("id", g.id);

      await supabase.from("collection_logs").insert({
        genre_id: g.id,
        acao: "generate-terms",
        status: "sucesso",
        mensagem: `${fresh.length} termos novos (total ${count})`,
        duracao_ms: Date.now() - start,
      });

      totalCreated += fresh.length;
      summary.push({ genre: g.nome, created: fresh.length, total: count ?? 0 });
    }

    return new Response(
      JSON.stringify({ ok: true, totalCreated, summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("generate-terms error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
