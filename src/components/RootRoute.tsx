// RootRoute — decide o que renderizar em "/":
// - Se o usuário está autenticado: mostra o Cockpit (Home) com layout do app.
// - Se não está: mostra a landing pública institucional.
// Mantém a rota "/" intacta para todos os links internos existentes.
import { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Zap } from "lucide-react";
import Landing from "@/pages/Landing";
import AppLayout from "@/components/AppLayout";
import Home from "@/pages/Home";
import { getCuratorPublicPath, isCuratorPublicMode } from "@/lib/publicRouteMode";
import { Navigate } from "react-router-dom";

export default function RootRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Zap className="h-5 w-5 text-primary animate-pulse-soft" />
          <span>Carregando…</span>
        </div>
      </div>
    );
  }

  if (isCuratorPublicMode()) return <Navigate to={getCuratorPublicPath()} replace />;
  if (!user) return <Landing />;

  return (
    <AppLayout>
      <Home />
    </AppLayout>
  );
}

export function PublicWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
