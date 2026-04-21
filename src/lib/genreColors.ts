/**
 * Identidade visual por gênero — cor base em HSL.
 * Aplicada de forma SUTIL: glow leve, borda, hover.
 * Fallback automático quando o gênero não está mapeado: cor derivada do hash do nome.
 */

export type GenreColor = {
  /** HSL string sem hsl(): "141 76% 48%" */
  hsl: string;
  /** Label amigável (debug) */
  label: string;
};

const MAP: Record<string, GenreColor> = {
  funk:        { hsl: "141 90% 55%", label: "verde neon" },
  sertanejo:   { hsl: "42 95% 58%",  label: "amarelo/dourado" },
  piseiro:     { hsl: "200 90% 65%", label: "azul claro" },
  trap:        { hsl: "280 75% 65%", label: "roxo" },
  pagode:      { hsl: "20 85% 58%",  label: "laranja" },
  gospel:      { hsl: "220 70% 65%", label: "azul celestial" },
  rock:        { hsl: "0 75% 58%",   label: "vermelho" },
  pop:         { hsl: "330 80% 65%", label: "rosa" },
  forro:       { hsl: "35 90% 60%",  label: "âmbar" },
  "forró":     { hsl: "35 90% 60%",  label: "âmbar" },
  rap:         { hsl: "260 70% 62%", label: "violeta" },
  eletronica:  { hsl: "180 85% 55%", label: "ciano" },
  eletrônica:  { hsl: "180 85% 55%", label: "ciano" },
  reggae:      { hsl: "100 60% 55%", label: "verde lima" },
  mpb:         { hsl: "160 55% 55%", label: "verde água" },
  samba:       { hsl: "10 75% 60%",  label: "vermelho samba" },
};

/** Hash simples e estável → matiz consistente para gêneros não mapeados. */
function fallbackHsl(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `${hue} 70% 60%`;
}

export function getGenreColor(nameOrSlug: string): GenreColor {
  const key = (nameOrSlug ?? "").toLowerCase().trim();
  if (MAP[key]) return MAP[key];
  return { hsl: fallbackHsl(key), label: "auto" };
}

/** Helpers prontos pra usar em style={{...}} */
export function genreStyleVars(nameOrSlug: string) {
  const c = getGenreColor(nameOrSlug);
  return { ["--g" as any]: c.hsl } as React.CSSProperties;
}
