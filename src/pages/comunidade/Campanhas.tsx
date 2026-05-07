// /comunidade/campanhas — Lista de campanhas (placeholder Fase 0).
// Na Fase D vamos plugar deals reais filtrados pra comunidade.
import { Music2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ComunidadeShell } from "@/components/comunidade/ComunidadeShell";

export default function Campanhas() {
  return (
    <ComunidadeShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Campanhas</h1>
        <Card>
          <CardContent className="p-8 flex flex-col items-center text-center gap-3">
            <Music2 className="h-7 w-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-xs">
              Nenhuma campanha disponível agora. Quando tiver, ela aparece aqui.
            </p>
          </CardContent>
        </Card>
      </div>
    </ComunidadeShell>
  );
}
