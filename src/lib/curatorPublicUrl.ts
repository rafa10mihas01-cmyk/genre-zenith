// Domínio público canônico para os links de curador.
// Sempre usa engine.nexcreatorx.com (mesmo quando o admin acessa
// pelo preview), pra que o link colado seja sempre estável e branded.
export const PUBLIC_DOMAIN = "https://engine.nexcreatorx.com";

/**
 * Monta a URL pública do curador para um deal.
 * Prefere slug (amigável). Cai em public_token se não houver slug.
 */
export function curatorPublicUrl(opts: {
  slug?: string | null;
  public_token?: string | null;
}): string {
  const id = (opts.slug && opts.slug.trim()) || (opts.public_token ?? "");
  return `${PUBLIC_DOMAIN}/curador/${id}`;
}
