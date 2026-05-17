import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { CuradoresCRM } from "@/components/operacao/CuradoresCRM";

export default function Prospecao() {
  return (
    <PageContainer>
      <PageHeader
        title="Curadores"
        subtitle="Gerenciar curadores e oportunidades de playlist"
        actions={
          <Button
            variant="outline"
            size="icon"
            className="rounded-full h-9 w-9"
            onClick={() => window.location.reload()}
            aria-label="Recarregar"
            title="Recarregar"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        }
      />

      <section className="space-y-6">
        <CuradoresCRM />
      </section>
    </PageContainer>
  );
}