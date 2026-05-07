// /comunidade — Dashboard do membro.
// Pontos + lista de campanhas (placeholder até Fase D) + progresso de tier.
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
      <div className="space-y-5">
        {/* Pontos */}
        <Card>
          <CardContent className="p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Pontos</div>
            <div className="mt-1 text-4xl font-semibold tracking-tight">
              {member.points.toLocaleString("pt-BR")}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Olá, {member.display_name.split(" ")[0]}
            </div>
          </CardContent>
        </Card>

        {/* Campanhas (placeholder Fase D) */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground">Campanhas para você</h2>
            <span className="text-xs text-muted-foreground">0</span>
          </div>
          <Card>
            <CardContent className="p-6 flex flex-col items-center text-center gap-2">
              <Music2 className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Nenhuma campanha disponível ainda. Você será avisado quando chegar.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Progresso */}
        <section>
          <h2 className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Progresso</h2>
          <Card>
            <CardContent className="p-5 space-y-2.5">
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
      </div>
    </ComunidadeShell>
  );
}
