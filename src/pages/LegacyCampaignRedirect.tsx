// LegacyCampaignRedirect — redireciona /campanha/:token (portal antigo) para
// /p/plano/:token (portal novo). Faz lookup via edge function pública
// resolve-legacy-token. Mantém compat com links já enviados a clientes.
import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Zap } from "lucide-react";

export default function LegacyCampaignRedirect() {
  const { token } = useParams<{ token: string }>();
  const [target, setTarget] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!token) { setNotFound(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("resolve-legacy-token", {
          body: { client_token: token },
        });
        if (cancelled) return;
        if (error || !data?.ok || !data?.public_plan_token) {
          setNotFound(true);
          return;
        }
        setTarget(`/p/plano/${data.public_plan_token}`);
      } catch {
        if (!cancelled) setNotFound(true);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (notFound) return <Navigate to="/" replace />;
  if (target) return <Navigate to={target} replace />;
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Zap className="h-5 w-5 text-primary animate-pulse-soft" />
        <span>Redirecionando…</span>
      </div>
    </div>
  );
}
