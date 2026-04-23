// Lista de selos majors brasileiros e curadores premium reconhecidos.
// Spotify Search API parou de retornar owner.id='spotify' em nov/2024,
// então tratamos esses selos como tier-1 equivalente a oficiais Spotify.
//
// Como adicionar: pegue o owner.id (slug) da playlist no Spotify (na URL do owner)
// e adicione minúsculo. Ex: open.spotify.com/user/filtr.br → "filtr.br"

export const MAJOR_LABEL_OWNERS = new Set<string>([
  // Filtr (Sony Music) — global, com presença forte BR
  "filtr.br",
  "filtr",
  "filtrbrasil",
  // Digster (Universal Music)
  "digster_brasil",
  "digster.brasil",
  "digster",
  // Som Livre (Globo) — sertanejo, MPB
  "somlivre",
  "somlivrebrasil",
  // Warner Music BR
  "warnermusicbrasil",
  "warnermusicbr",
  // Universal Music BR direto
  "universalmusicbrasil",
  "universalmusicbr",
  // Sony Music BR direto
  "sonymusicbrasil",
  "sonymusicbr",
  // Selos Indie / Distribuição
  "onerpm",
  "altafonte",
  "kondzilla",
  "gr6explode",
  // Spotify oficial (mantemos por garantia, mesmo que raro)
  "spotify",
]);

// Classifica owner_id em tipo: spotify | label | user
export function classifyOwner(ownerId: string | null | undefined): "spotify" | "label" | "user" {
  if (!ownerId) return "user";
  const id = ownerId.toLowerCase().trim();
  if (id === "spotify") return "spotify";
  if (MAJOR_LABEL_OWNERS.has(id)) return "label";
  return "user";
}

// Multiplicador de score por fonte. Usado em extract-blueprints e replicate-top.
// spotify e label = 2.5x (curadoria profissional comprovada)
// user = 1.0x (usuário comum, mesmo se grande)
export function sourceMultiplier(ownerType: string | null | undefined): number {
  if (ownerType === "spotify" || ownerType === "label") return 2.5;
  return 1.0;
}

// Label legível pra logs/UI
export function sourceLabel(ownerType: string | null | undefined): string {
  if (ownerType === "spotify") return "oficial_spotify";
  if (ownerType === "label") return "selo_major";
  if (ownerType === "user") return "user_grande";
  return "desconhecido";
}
