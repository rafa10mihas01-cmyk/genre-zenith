import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export async function generateTerms(genre_id: string) {
  const { data, error } = await supabase.functions.invoke("generate-terms", {
    body: { genre_id },
  });
  if (error) {
    toast.error("Erro ao gerar termos", { description: error.message });
    return null;
  }
  toast.success(`Termos gerados`, {
    description: data?.summary?.[0]
      ? `${data.summary[0].created} novos termos (${data.summary[0].total} no total)`
      : undefined,
  });
  return data;
}

export async function generateAllTerms() {
  toast.loading("Gerando termos para todos os gêneros…", { id: "gen-all" });
  const { data, error } = await supabase.functions.invoke("generate-terms", {
    body: { all: true },
  });
  toast.dismiss("gen-all");
  if (error) {
    toast.error("Erro ao gerar termos", { description: error.message });
    return null;
  }
  toast.success(`Termos gerados`, { description: `${data?.totalCreated ?? 0} termos novos no total` });
  return data;
}

export async function runSearch(args: { genre_id: string; term_id: string; search_term: string; max_results?: number; force?: boolean }) {
  // Política Apify: 1 chamada custa o mesmo independente do maxResults.
  // Forçamos mínimo 50 (default 100) pra maximizar yield por execução.
  const payload = { ...args, max_results: Math.max(50, args.max_results ?? 100) };
  const { data, error } = await supabase.functions.invoke("run-search", { body: payload });
  if (error) {
    toast.error("Erro na busca", { description: error.message });
    return null;
  }
  return data;
}

/**
 * Collect all pending terms for a genre, sequentially with 2s delay.
 * Updates a progress callback. Returns when done or aborted.
 */
export async function collectGenre(
  genre_id: string,
  opts: { delayMs?: number; maxResults?: number; onProgress?: (done: number, total: number, currentTerm: string) => void; abortSignal?: AbortSignal } = {},
) {
  // Default otimizado: 100 itens por chamada (mesmo custo que 20).
  const { delayMs = 2000, maxResults = 100, onProgress, abortSignal } = opts;

  const { data: terms, error } = await supabase
    .from("search_terms")
    .select("id,termo")
    .eq("genre_id", genre_id)
    .eq("executado", false)
    .order("created_at");

  if (error) {
    toast.error("Erro ao listar termos", { description: error.message });
    return;
  }
  if (!terms || terms.length === 0) {
    toast.info("Sem termos pendentes para este gênero. Gere os termos primeiro.");
    return;
  }

  toast.success(`Iniciando coleta`, { description: `${terms.length} termos na fila` });

  for (let i = 0; i < terms.length; i++) {
    if (abortSignal?.aborted) {
      toast.info("Coleta interrompida pelo usuário");
      break;
    }
    const t = terms[i];
    onProgress?.(i, terms.length, t.termo);
    await runSearch({ genre_id, term_id: t.id, search_term: t.termo, max_results: maxResults });
    if (i < terms.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  onProgress?.(terms.length, terms.length, "");

  // After collecting, mark for analysis (Phase 3 will set 'analisado')
  await supabase.from("genres").update({ status: "coletando" }).eq("id", genre_id);
  toast.success("Coleta finalizada");
}
