import { ListMusic } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Playlist Deals — módulo de acompanhamento de deals com curadores.
 * Segue o padrão obrigatório do projeto: PageHeader + tokens semânticos +
 * componentes shadcn. Conteúdo real será implementado em iteração seguinte.
 */
export default function PlaylistDeals() {
  return (
    <div className="w-full space-y-6">
      <PageHeader
        kicker="Módulo"
        icon={ListMusic}
        title="Playlist Deals"
        subtitle="Acompanhe seus deals com curadores"
      />

      <Card className="max-w-2xl mx-auto">
        <CardContent className="p-8 text-center">
          <div className="h-14 w-14 rounded-full bg-elevated border border-border mx-auto flex items-center justify-center">
            <ListMusic className="h-6 w-6 text-muted-foreground" />
          </div>
          <h2 className="mt-4 font-bold text-lg text-foreground">Em breve</h2>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto leading-relaxed">
            O módulo de Playlist Deals está sendo preparado. Em breve você poderá
            registrar deals, metas de plays e acompanhar o progresso por curador.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
