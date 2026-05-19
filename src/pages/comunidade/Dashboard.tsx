// /comunidade — Dashboard do membro.
// Mesmo padrão visual da CuratorPage: cards nx-card, kickers em caps verde,
// barra de progresso fina. Sem saudações ("Olá") — proibido pelo design system.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Music2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { ComunidadeShell } from "@/components/comunidade/ComunidadeShell";

type Member = {
  id: string;
  display_name: string;
  tier: "bronze" | "prata" | "ouro";
  points: number;
};

const TIER_RANGES = {
  bronze: { next: "Prata", max: 500 },
  prata: { next: "Ouro", max: 2000 },
  ouro: { next: null, max: 2000 },
} as const;

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("community_members")
      .select("id,display_name,tier,points")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) {
          nav("/comunidade/onboarding", { replace: true });
          return;
        }
        setMember(data as Member);
        setLoading(false);
      });
  }, [user, nav]);

  if (loading || !member) {
    return (
      <ComunidadeShell>
        <div className="text-sm text-muted-foreground">Carregando…</div>
      </ComunidadeShell>
    );
  }

  const tierInfo = TIER_RANGES[member.tier];
  const pct = tierInfo.next ? Math.min(100, Math.round((member.points / tierInfo.max) * 100)) : 100;
  const remaining = tierInfo.next ? Math.max(0, tierInfo.max - member.points) : 0;

  return (
    <ComunidadeShell>
      {/* Pontos — card "hero" no padrão CuratorPage */}
      <Card className="nx-card !p-0 overflow-hidden border-border">
        <CardContent className="p-5 sm:p-6 space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
            Pontos
          </div>
          <div className="text-4xl font-semibold tracking-tight leading-none">
            {member.points.toLocaleString("pt-BR")}
          </div>
        </CardContent>
      </Card>

      {/* Campanhas */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
            Campanhas para você
          </h2>
          <span className="text-[11px] text-muted-foreground">0</span>
        </div>
        <Card className="nx-card !p-0 overflow-hidden border-border">
          <CardContent className="p-6 flex flex-col items-center text-center gap-2">
            <Music2 className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Sem campanhas no momento.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Progresso */}
      <section className="space-y-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
          Progresso
        </h2>
        <Card className="nx-card !p-0 overflow-hidden border-border">
          <CardContent className="p-5 sm:p-6 space-y-2.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium capitalize">{member.tier}</span>
              <span className="text-muted-foreground">{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-border overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            {tierInfo.next ? (
              <p className="text-xs text-muted-foreground">
                Faltam {remaining.toLocaleString("pt-BR")} pontos para {tierInfo.next}.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Você atingiu o nível máximo.</p>
            )}
          </CardContent>
        </Card>
      </section>
    </ComunidadeShell>
  );
}
