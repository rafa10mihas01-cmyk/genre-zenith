import { NexEngineLogo } from "@/components/NexEngineLogo";

/**
 * Footer global do app interno (sob o conteúdo das páginas).
 * Estilo: pequeno, centralizado, opacidade reduzida — sensação SaaS premium.
 *
 * Conteúdo: Powered by NexEngine · vX.Y.Z · Suporte
 */
const APP_VERSION = "v1.2.0";
const SUPPORT_EMAIL = "suporte@nexengine.app";

export function AppFooter() {
  return (
    <footer className="hidden lg:block mt-4 pt-3 pb-0 border-t border-border/40">
      <div className="flex flex-row flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] leading-none text-muted-foreground/60">
        <div className="flex items-center gap-2">
          <NexEngineLogo variant="auto" size={14} />
          <span>Powered by <span className="text-foreground/70 font-medium">NexEngine</span></span>
        </div>
        <span className="opacity-40">·</span>
        <span className="tabular-nums">{APP_VERSION}</span>
        <span className="opacity-40">·</span>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="hover:text-foreground transition-colors"
        >
          Suporte
        </a>
      </div>
    </footer>
  );
}
