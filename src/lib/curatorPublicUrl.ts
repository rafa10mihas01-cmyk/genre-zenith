// Domínio público canônico para os links de curador.
// Sempre usa engine.nexcreatorx.com (mesmo quando o admin acessa
// pelo preview), pra que o link colado seja sempre estável e branded.
export const PUBLIC_DOMAIN = "https://engine.nexcreatorx.com";

// Edge function que devolve HTML com Open Graph (preview rico no WhatsApp,
// iMessage, Telegram, Slack) e redireciona pro portal canônico.
const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;
const SHARE_BASE = SUPABASE_PROJECT_ID
  ? `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/share-link`
  : `${PUBLIC_DOMAIN}/share-link`;

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

/**
 * Versão "share" do link do curador — passa por edge function que devolve
 * Open Graph com nome do curador, capa e meta. WhatsApp/iMessage/Telegram
 * mostram o preview correto antes do clique. Usuário real é redirecionado
 * automaticamente pro portal `/curador/...`.
 */
export function curatorShareUrl(opts: {
  slug?: string | null;
  public_token?: string | null;
}): string {
  const id = ((opts.slug && opts.slug.trim()) || (opts.public_token ?? "")).trim();
  return `${SHARE_BASE}/curador/${encodeURIComponent(id)}`;
}

/**
 * Monta a URL pública sanitizada para o cliente/artista acompanhar a campanha.
 * Prefere slug amigável (ex: /campanha/meu-funk-mc-fulano).
 * Cai pro client_token (hex) quando o slug não estiver disponível.
 * Não expõe curadores, custos ou métricas internas.
 */
export function clientCampaignUrl(opts: {
  client_token?: string | null;
  slug?: string | null;
}): string {
  const id = ((opts.slug && opts.slug.trim()) || (opts.client_token ?? "")).trim();
  return `${PUBLIC_DOMAIN}/campanha/${id}`;
}

/**
 * Versão "share" do link do cliente — preview rico no WhatsApp.
 */
export function clientShareUrl(opts: {
  client_token?: string | null;
  slug?: string | null;
}): string {
  const id = ((opts.slug && opts.slug.trim()) || (opts.client_token ?? "")).trim();
  return `${SHARE_BASE}/campanha/${encodeURIComponent(id)}`;
}
