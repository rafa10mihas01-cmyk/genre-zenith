// editorial-flag.ts — feature flag para o motor editorial AI (generateEditorialCopy).
//
// Substitui o hard-coded `skip_ai: true` que existia nos fluxos automáticos
// (diagnose-managed-playlists-batch, evaluate-plan-snapshots, playlist-queue-processor).
//
// Configuração: system_flags.ai_editorial_tier (singleton_key='app').
//   off  → AI desligada (comportamento equivalente ao skip_ai=true legado).
//   top  → AI só pra playlists com >= 10.000 seguidores. (padrão atual)
//   mid  → AI pra playlists com >= 1.000 seguidores.
//   all  → AI pra todas as playlists.
//
// Como mudar:
//   UPDATE public.system_flags SET ai_editorial_tier = 'mid' WHERE singleton_key='app';
//   UPDATE public.system_flags SET ai_editorial_tier = 'all' WHERE singleton_key='app';
//
// Como desligar instantaneamente (kill-switch):
//   UPDATE public.system_flags SET ai_editorial_tier = 'off' WHERE singleton_key='app';

export type EditorialTier = "off" | "top" | "mid" | "all";

export const EDITORIAL_TIER_THRESHOLDS: Record<EditorialTier, number> = {
  off: Number.POSITIVE_INFINITY,
  top: 10_000,
  mid: 1_000,
  all: 0,
};

const VALID: EditorialTier[] = ["off", "top", "mid", "all"];

/** Lê a flag atual. Default `top` em caso de erro / valor inválido. */
export async function getEditorialTier(sb: any): Promise<EditorialTier> {
  try {
    const { data } = await sb
      .from("system_flags")
      .select("ai_editorial_tier")
      .eq("singleton_key", "app")
      .maybeSingle();
    const t = data?.ai_editorial_tier as EditorialTier | undefined;
    if (t && VALID.includes(t)) return t;
  } catch { /* fail-safe */ }
  return "top";
}

/** Decide se a AI editorial deve rodar pra uma playlist com X seguidores. */
export function shouldUseEditorialAI(followers: number | null | undefined, tier: EditorialTier): boolean {
  if (tier === "off") return false;
  const f = Number(followers ?? 0);
  return f >= EDITORIAL_TIER_THRESHOLDS[tier];
}
