import { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export default function CuradoriaPreview() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("curator_deals")
        .select("public_token")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data?.public_token) {
        setEmpty(true);
      } else {
        setToken(data.public_token);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (empty) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold text-foreground">Nenhum deal encontrado</h1>
          <p className="text-sm text-muted-foreground">
            Crie uma negociação na página Negociações para visualizar a página do curador.
          </p>
          <Link
            to="/playlist-deals"
            className="inline-block mt-2 text-sm text-primary hover:underline"
          >
            Ir para Negociações
          </Link>
        </div>
      </div>
    );
  }

  return <Navigate to={`/curador/${token}`} replace />;
}
