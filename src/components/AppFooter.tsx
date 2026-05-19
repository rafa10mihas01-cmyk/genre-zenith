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
    <footer className="mt-6 pt-4 pb-2 border-t border-border/40">
      <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-[11px] text-muted-foreground/60">
        <div className="flex items-center gap-2">
          <NexEngineLogo variant="auto" size={14} />
          <span>Powered by <span className="text-foreground/70 font-medium">NexEngine</span></span>
        </div>
        <span className="hidden sm:inline opacity-40">·</span>
        <span className="tabular-nums">{APP_VERSION}</span>
        <span className="hidden sm:inline opacity-40">·</span>
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
