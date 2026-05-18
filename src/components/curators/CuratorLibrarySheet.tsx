// CuratorLibrarySheet — wrapper Sheet em volta de <CuratorLibraryPanel/>.
// Mantido por compatibilidade; novas telas devem usar o panel direto em uma página dedicada.
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { CuratorLibraryPanel } from "@/components/curators/CuratorLibraryPanel";
import type { Curator, CuratorBalance } from "@/hooks/useCuratorDeals";
import type { CuratorDeal } from "@/lib/curatorDealsUtils";

interface Props {
  curator: Curator | null;
  deals: CuratorDeal[];
  balance?: CuratorBalance | null;
  onAddPurchase?: (curatorId: string, input: { plays_purchased: number; amount: number; note?: string | null }) => Promise<void>;
  onClose: () => void;
}

export function CuratorLibrarySheet({ curator, deals, balance, onAddPurchase, onClose }: Props) {
  const open = !!curator;
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="sm:max-w-2xl flex flex-col p-0 gap-0">
        {curator && (
          <>
            <SheetHeader className="px-6 py-5 border-b border-border/40">
              <SheetTitle className="text-xl">{curator.name}</SheetTitle>
              <SheetDescription>
                Biblioteca de playlists e histórico de campanhas.
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <CuratorLibraryPanel
                curator={curator}
                deals={deals}
                balance={balance}
                onAddPurchase={onAddPurchase}
                flush
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
