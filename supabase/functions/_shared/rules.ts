// _shared/rules.ts — utilitários para consumir replication_rules nas funções de replicação.
// Carrega regras ativas de um gênero (+ globais), formata pro prompt da LLM
// e expõe helpers para forçar nomes/tracks de forma determinística.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export type ReplicationRule = {
  id: string;
  scope: string;
  rule_type: string;     // naming | tracks | format | structure | avoid
  target: string;        // ex: naming.year, format.subgenre, tracks.artist_boost
  value: any;
  condition: any;
  priority: "alta" | "media" | "baixa";
  confidence: "alta" | "media" | "baixa";
  evidence: string | null;
};

export async function loadActiveRules(
  supabase: SupabaseClient,
  genreId: string,
): Promise<ReplicationRule[]> {
  const { data, error } = await supabase.rpc("get_active_replication_rules", {
    p_genre_id: genreId,
  });
  if (error) {
    console.error("loadActiveRules error:", error.message);
    return [];
  }
  return (data ?? []) as ReplicationRule[];
}

/** Formata regras como bloco de texto pra injetar no system prompt da LLM. */
export function rulesAsPromptBlock(rules: ReplicationRule[]): string {
  if (rules.length === 0) return "";
  const grouped: Record<string, ReplicationRule[]> = {};
  for (const r of rules) (grouped[r.rule_type] ??= []).push(r);

  const blocks: string[] = [];
  for (const [type, list] of Object.entries(grouped)) {
    const lines = list.map((r) => {
      const tag = r.priority === "alta" ? "🔴 OBRIGATÓRIO" : r.priority === "media" ? "🟡 PREFERIR" : "⚪ EVITAR";
      const val = typeof r.value === "object" ? JSON.stringify(r.value) : String(r.value);
      const ev = r.evidence ? ` (${r.evidence})` : "";
      return `- ${tag} [${r.target}] → ${val}${ev}`;
    }).join("\n");
    blocks.push(`## REGRAS DE ${type.toUpperCase()}\n${lines}`);
  }
  return `\n\n# REGRAS APRENDIDAS DE PERFORMANCE (Claude → executar)\n${blocks.join("\n\n")}\n`;
}

/** Aplica regras de naming determinísticas em cima do nome retornado pela LLM. */
export function enforceNamingRules(name: string, rules: ReplicationRule[]): string {
  let out = name.trim();
  const naming = rules.filter((r) => r.rule_type === "naming" && r.priority === "alta");

  for (const r of naming) {
    // naming.year → força ano no nome
    if (r.target === "naming.year") {
      const year = r.value?.year ?? new Date().getFullYear();
      const yearRegex = /\b(20\d{2})\b/;
      if (!yearRegex.test(out)) {
        out = `${out} ${year}`;
      } else {
        out = out.replace(yearRegex, String(year));
      }
    }
    // naming.suffix / naming.prefix → adiciona texto se ausente
    if (r.target === "naming.suffix" && typeof r.value?.text === "string") {
      const sfx = r.value.text.trim();
      if (sfx && !out.toLowerCase().includes(sfx.toLowerCase())) out = `${out} ${sfx}`;
    }
    if (r.target === "naming.prefix" && typeof r.value?.text === "string") {
      const pfx = r.value.text.trim();
      if (pfx && !out.toLowerCase().includes(pfx.toLowerCase())) out = `${pfx} ${out}`;
    }
    // naming.subgenre → garante subgênero presente
    if (r.target === "naming.subgenre" && typeof r.value?.subgenre === "string") {
      const sg = r.value.subgenre.trim();
      if (sg && !out.toLowerCase().includes(sg.toLowerCase())) out = `${out} ${sg}`;
    }
    // avoid.words → remove palavras proibidas (rule_type=avoid também)
  }

  // avoid.words (qualquer prioridade): remove
  for (const r of rules) {
    if (r.rule_type === "avoid" && r.target === "avoid.words") {
      const words: string[] = Array.isArray(r.value?.words) ? r.value.words : [];
      for (const w of words) {
        out = out.replace(new RegExp(`\\b${w}\\b`, "gi"), "").replace(/\s+/g, " ").trim();
      }
    }
  }

  return out.replace(/\s+/g, " ").trim().slice(0, 100);
}

/** Boost para track_seeds quando há regra de artistas/subgênero priorizado. */
export function reorderTracksByRules<T extends { artista?: string; nome?: string }>(
  seeds: T[],
  rules: ReplicationRule[],
): T[] {
  const boostArtists = new Set<string>();
  const avoidArtists = new Set<string>();
  for (const r of rules) {
    if (r.rule_type === "tracks" && r.target === "tracks.artist_boost") {
      for (const a of r.value?.artists ?? []) boostArtists.add(String(a).toLowerCase());
    }
    if (r.rule_type === "avoid" && r.target === "avoid.artists") {
      for (const a of r.value?.artists ?? []) avoidArtists.add(String(a).toLowerCase());
    }
  }
  if (boostArtists.size === 0 && avoidArtists.size === 0) return seeds;

  return [...seeds]
    .filter((s) => !avoidArtists.has(String(s.artista ?? "").toLowerCase()))
    .sort((a, b) => {
      const ab = boostArtists.has(String(a.artista ?? "").toLowerCase()) ? 0 : 1;
      const bb = boostArtists.has(String(b.artista ?? "").toLowerCase()) ? 0 : 1;
      return ab - bb;
    });
}

/** Resumo curto para logging/UI. */
export function summarizeRules(rules: ReplicationRule[]): { total: number; by_type: Record<string, number>; high: number } {
  const by_type: Record<string, number> = {};
  let high = 0;
  for (const r of rules) {
    by_type[r.rule_type] = (by_type[r.rule_type] ?? 0) + 1;
    if (r.priority === "alta") high++;
  }
  return { total: rules.length, by_type, high };
}
