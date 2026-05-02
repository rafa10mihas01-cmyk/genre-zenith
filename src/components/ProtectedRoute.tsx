import { Navigate } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Zap } from "lucide-react";
import { getCuratorPublicPath, isCuratorPublicMode } from "@/lib/publicRouteMode";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
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
  // Visitantes vão para a Landing (rota /), não para /login.
  // /login fica reservado para uso interno/admin.
  if (isCuratorPublicMode()) return <Navigate to={getCuratorPublicPath()} replace />;
  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
}
