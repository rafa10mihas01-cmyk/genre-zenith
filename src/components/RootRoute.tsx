// RootRoute — decide o que renderizar em "/":
// - Se o usuário está autenticado: mostra o Cockpit (Home) com layout do app.
// - Se não está: mostra a landing pública institucional.
// Mantém a rota "/" intacta para todos os links internos existentes.
import { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useBootGate } from "@/contexts/LoadingContext";
import Landing from "@/pages/Landing";
import AppLayout from "@/components/AppLayout";
import Home from "@/pages/Home";
import { getCuratorPublicPath, isCuratorPublicMode } from "@/lib/publicRouteMode";
import { Navigate } from "react-router-dom";

export default function RootRoute() {
  const { user, loading } = useAuth();
  useBootGate(loading);

  if (loading) return null;

  // Modo curador só redireciona visitantes não autenticados.
  if (!user && isCuratorPublicMode()) return <Navigate to={getCuratorPublicPath()} replace />;
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
