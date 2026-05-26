import { NexEngineLogo } from "@/components/NexEngineLogo";

/**
 * Footer global do app interno — minimal: logo em cima, wordmark embaixo.
 */
export function AppFooter() {
  return (
    <footer className="mt-2 pt-3 pb-2 border-t border-border/40">
      <div className="flex flex-col items-center justify-center gap-1 text-muted-foreground/60">
        <NexEngineLogo variant="auto" size={16} />
        <span className="text-[11px] text-foreground/70 font-medium tracking-wide">NexEngine</span>
      </div>
    </footer>
  );
}
