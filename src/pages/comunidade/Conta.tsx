// /comunidade/conta — Perfil do membro (somente leitura na fase 0).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { ComunidadeShell } from "@/components/comunidade/ComunidadeShell";

type Member = {
  display_name: string;
  instagram_handle: string | null;
  playlist_name: string | null;
  playlist_url: string | null;
  playlist_followers: number | null;
  tier: string;
  status: string;
};

export default function Conta() {
  const { user } = useAuth();
  const [m, setM] = useState<Member | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("community_members")
      .select("display_name,instagram_handle,playlist_name,playlist_url,playlist_followers,tier,status")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setM(data as Member | null));
  }, [user]);

  return (
    <ComunidadeShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Conta</h1>
        {!m ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <Card>
            <CardContent className="p-5 space-y-3 text-sm">
              <Row label="Nome" value={m.display_name} />
              {m.instagram_handle && <Row label="Instagram" value={m.instagram_handle} />}
              <Row label="Email" value={user?.email ?? "—"} />
              <Row label="Playlist" value={m.playlist_name ?? "—"} />
              {m.playlist_followers != null && (
                <Row label="Seguidores" value={m.playlist_followers.toLocaleString("pt-BR")} />
              )}
              <Row label="Nível" value={m.tier} className="capitalize" />
              <Row label="Status" value={m.status} className="capitalize" />
            </CardContent>
          </Card>
        )}
      </div>
    </ComunidadeShell>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium truncate ${className ?? ""}`}>{value}</span>
    </div>
  );
}
