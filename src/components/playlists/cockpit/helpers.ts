// -------------------- helpers (extraído do PlaylistCockpit.tsx) --------------------
// Movido 1:1 sem alteração de lógica.
import { Flame, Snowflake, Activity } from "lucide-react";
import type { Zone, Suggestion, AnalysisTrack } from "./types";

export function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("pt-BR").format(n);
}

export const HEALTH_META: Record<string, { label: string; tone: string; Icon: any }> = {
  aquecido: { label: "Aquecido", tone: "text-primary border-primary/40 bg-primary/10", Icon: Flame },
  saudavel: { label: "Saudável", tone: "text-foreground border-border bg-elevated", Icon: Activity },
  frio: { label: "Frio", tone: "text-destructive border-destructive/40 bg-destructive/10", Icon: Snowflake },
};

// Zonas curatoriais — espelham ZONE_RANGES do diagnose-managed-playlist.
export const ZONE_LABELS: Record<Zone, string> = {
  anchor: "Fachada",
  premium: "Premium",
  support: "Sustentação",
  tail: "Cauda",
};
// Tamanho real de cada zona — limita quantas sugestões podem brigar pelo mesmo trecho.
export const ZONE_CAPS: Record<Zone, number> = {
  anchor: 2,
  premium: 4,
  support: 6,
  tail: Number.POSITIVE_INFINITY,
};
export function zoneFromPos(pos: number): Zone {
  if (pos <= 1) return "anchor";
  if (pos <= 5) return "premium";
  if (pos <= 11) return "support";
  return "tail";
}
// Motivo curto e humano pra cada faixa sugerida — esconde o engine.
export function reasonForAdd(s: Suggestion): string {
  if (s.from_missing_artist) return "Artista dominante faltando";
  const c = s.count ?? 0;
  if (c >= 4) return "Muito forte no nicho";
  if (c >= 2) return `Recorrente no nicho (${c}×)`;
  return "Sugerida pelo modelo do nicho";
}
// Função editorial humana por zona — usada na linha do ADICIONAR.
export const ROLE_BY_ZONE: Record<Zone, string> = {
  anchor: "entra no topo",
  premium: "retenção forte",
  support: "recorrente no nicho",
  tail: "volume complementar",
};
export function roleLabel(s: Suggestion & { _zone?: Zone }): string {
  if (s.function_role) return s.function_role;
  return ROLE_BY_ZONE[(s._zone ?? s.target_zone ?? "support") as Zone];
}
// Range de posição (1-indexado) por zona — pra mostrar #1-2, #3-6 etc.
export const ZONE_RANGE_LABEL: Record<Zone, string> = {
  anchor: "#1-2",
  premium: "#3-6",
  support: "#7-12",
  tail: "#13+",
};
// Pega só o motivo mais relevante (primeiro), com fallback humano por ação.
export function shortReason(t: AnalysisTrack, kind: "remove" | "promote" | "demote"): string {
  const first = (t.reasons ?? []).find((r) => r && r.trim().length > 0);
  if (first) return first;
  if (kind === "remove") return "Baixa performance";
  if (kind === "promote") return "Mercado já reconheceu";
  return "Pouca tração na vitrine";
}
// Normaliza string pra comparar nomes (sem acento, sem case, sem espaços).
export function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}
