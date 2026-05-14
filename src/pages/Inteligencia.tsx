import { Link } from "react-router-dom";
import { BarChart2, Grid3x3, Flame, Users, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";

const TOOLS = [
  {
    title: "Benchmarks de gênero",
    subtitle: "Percentis de seguidores, faixas e crescimento por nicho",
    href: "/benchmarks",
    icon: BarChart2,
  },
  {
    title: "Matriz de prioridade",
    subtitle: "Cruze headroom × confiança para priorizar playlists",
    href: "/matriz",
    icon: Grid3x3,
  },
  {
    title: "Heatmap de entregas",
    subtitle: "Dias e horários em que curadores reportam mais plays",
    href: "/heatmap",
    icon: Flame,
  },
  {
    title: "Comparar curadores",
    subtitle: "Confronte dois cérebros lado a lado",
    href: "/curadores/comparar",
    icon: Users,
  },
];

export default function Inteligencia() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Inteligência"
        subtitle="Acesse análises comparativas, benchmarks e priorização de playlists"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.href} to={t.href}>
              <Card className="p-5 h-full hover:bg-accent transition group cursor-pointer">
                <div className="flex items-start gap-4">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{t.title}</h3>
                      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{t.subtitle}</p>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
