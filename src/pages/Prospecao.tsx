import { useState } from "react";
import { RefreshCw, CheckCircle2, UserSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { CuradoresCRM } from "@/components/operacao/CuradoresCRM";
import { cn } from "@/lib/utils";

type Segment = "ativos" | "prospeccao";

export default function Prospecao() {
  const [segment, setSegment] = useState<Segment>("ativos");

  return (
    <PageContainer>
      <PageHeader
        title="Curadores"
        subtitle="Gerenciar curadores ativos e prospecção de novos"
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

      {/* Segmento de alto nível: Ativos = curadores com quem já fechei deal; Prospecção = leads ainda não fechados */}
      <div className="sticky top-0 z-30 -mt-px bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-md border-b border-border -mx-4 md:-mx-6">
        <div className="nx-tab-rail items-center gap-1 px-4 md:px-6">
          {([
            { id: "ativos" as const,     label: "Ativos",     icon: CheckCircle2, hint: "Curadores que já trabalho" },
            { id: "prospeccao" as const, label: "Prospecção", icon: UserSearch,   hint: "Leads para abordar" },
          ]).map((t) => {
            const Icon = t.icon;
            const active = segment === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSegment(t.id)}
                title={t.hint}
                className={cn(
                  "px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 transition-colors -mb-px shrink-0 whitespace-nowrap",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <section className="space-y-6 animate-tab-in" key={segment}>
        <CuradoresCRM segment={segment} />
      </section>
    </PageContainer>
  );
}
