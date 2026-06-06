// -------------------- trackExplain --------------------
// Camada PURAMENTE de apresentação. Não recalcula scores, não chama backend,
// não muda regra de recomendação. Apenas reorganiza campos JÁ existentes em
// AnalysisTrack / Suggestion para expor:
//   primary  — motivo dominante (1 linha)
//   secondary[] — até 2 sinais de apoio
//   confidence — alta | media | baixa (derivada de quantidade de sinais)
//   impact   — rótulo de impacto esperado (afinidade / cobertura / headroom / saturação / concentração)
//
// Fase 7A.3 — explicabilidade dos buckets do Plano.

import type { AnalysisTrack, Suggestion, Zone } from "../types";
import { ZONE_LABELS, ZONE_RANGE_LABEL, reasonForAdd, roleLabel } from "./../helpers";

export type Confidence = "alta" | "media" | "baixa";

export type TrackExplanation = {
  primary: string;
  secondary: string[];
  confidence: Confidence;
  impact: string;
};

function pickConfidence(signals: number): Confidence {
  if (signals >= 4) return "alta";
  if (signals >= 2) return "media";
  return "baixa";
}

export function explainAnalysis(
  t: AnalysisTrack,
  kind: "remove" | "promote" | "demote",
): TrackExplanation {
  const reasons = (t.reasons ?? []).filter((r) => r && r.trim().length > 0);
  const primary =
    reasons[0] ??
    (kind === "remove"
      ? "Baixa performance"
      : kind === "promote"
      ? "Mercado já reconheceu"
      : "Pouca tração na vitrine");

  const secondary: string[] = [];
  if (typeof t.recurrence_in_genre === "number") {
    secondary.push(`Recorrência ${Math.round(t.recurrence_in_genre)}%`);
  }
  if (typeof t.saturation_pct === "number") {
    secondary.push(`Saturação ${Math.round(t.saturation_pct)}%`);
  }
  if (typeof t.popularity === "number") {
    secondary.push(`Pop ${t.popularity}`);
  }
  if (typeof t.age_days_in_playlist === "number" && t.age_days_in_playlist >= 180) {
    secondary.push(`${t.age_days_in_playlist}d na playlist`);
  }
  // Próximos motivos do array (já vêm humanizados do backend)
  for (const r of reasons.slice(1)) {
    if (secondary.length >= 2) break;
    if (!secondary.includes(r)) secondary.push(r);
  }

  const signalCount =
    reasons.length +
    (typeof t.saturation_pct === "number" ? 1 : 0) +
    (typeof t.recurrence_in_genre === "number" ? 1 : 0) +
    (typeof t.popularity === "number" ? 1 : 0);

  let impact = "Headroom";
  if (kind === "remove") {
    impact =
      typeof t.saturation_pct === "number" && t.saturation_pct >= 50
        ? "Saturação ↓"
        : "Concentração ↓";
  } else if (kind === "promote") {
    impact =
      typeof t.recurrence_in_genre === "number" && t.recurrence_in_genre >= 50
        ? "Afinidade de nicho"
        : "Cobertura de artistas";
  } else {
    impact = "Headroom";
  }

  return {
    primary,
    secondary: secondary.slice(0, 2),
    confidence: pickConfidence(signalCount),
    impact,
  };
}

export function explainSuggestion(
  s: Suggestion & { _zone?: Zone },
): TrackExplanation {
  const zone = (s._zone ?? s.target_zone ?? "support") as Zone;
  const primary = reasonForAdd(s);

  const secondary: string[] = [];
  const count = s.count ?? 0;
  if (count >= 2) secondary.push(`Recorrência ${count}×`);
  if (s.from_missing_artist && !secondary.some((x) => x.startsWith("Artista"))) {
    secondary.push("Artista faltando no nicho");
  }
  if (typeof s.popularity === "number") secondary.push(`Pop ${s.popularity}`);
  // contexto editorial sempre útil
  if (secondary.length < 2) {
    secondary.push(`${ZONE_LABELS[zone]} ${ZONE_RANGE_LABEL[zone]} · ${roleLabel(s)}`);
  }

  const signalCount =
    (count >= 4 ? 2 : count >= 2 ? 1 : 0) +
    (s.from_missing_artist ? 1 : 0) +
    (typeof s.popularity === "number" ? 1 : 0) +
    1; // zona/role sempre presente

  const impact = s.from_missing_artist
    ? "Cobertura de artistas"
    : count >= 3
    ? "Afinidade de nicho"
    : "Headroom";

  return {
    primary,
    secondary: secondary.slice(0, 2),
    confidence: pickConfidence(signalCount + (count >= 4 ? 1 : 0)),
    impact,
  };
}

export const CONFIDENCE_META: Record<
  Confidence,
  { label: string; tone: string }
> = {
  alta: { label: "Confiança alta", tone: "border-primary/40 bg-primary/10 text-primary" },
  media: { label: "Confiança média", tone: "border-border bg-elevated text-foreground" },
  baixa: { label: "Confiança baixa", tone: "border-warning/40 bg-warning/10 text-warning" },
};
