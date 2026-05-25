export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

/**
 * formatCompact — formatador ÚNICO pra números grandes em KPI hero/default.
 *
 * Regras:
 *  - >= 1_000_000 → "1.2M" (1 decimal, sem ".0")
 *  - >= 1_000     → "137k" (sem decimais)
 *  - menores      → número cheio com separador pt-BR ("503", "1.000")
 *
 * NUNCA concatenar "k"/"M" manualmente em componente — usar este helper.
 */
export function formatCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    return sign + (abs / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (abs >= 1_000) {
    return sign + Math.round(abs / 1_000) + "k";
  }
  return sign + Math.round(abs).toLocaleString("pt-BR");
}

/**
 * BRL pra KPI hero — sem decimais ("R$ 137k", "R$ 1.250").
 * Usa formatCompact pra números grandes.
 */
export function formatBRLHero(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000) return "R$ " + formatCompact(n);
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/**
 * BRL pra detalhes / tabelas / linhas — 2 decimais ("R$ 453.717,50").
 */
export function formatBRLDetail(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(d: string | null | undefined): string {
  if (!d) return "—";
  const seconds = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s atrás`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const days = Math.floor(h / 24);
  return `${days}d atrás`;
}
