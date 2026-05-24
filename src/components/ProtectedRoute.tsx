import { Navigate } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useBootGate } from "@/contexts/LoadingContext";
import { getCuratorPublicPath, isCuratorPublicMode } from "@/lib/publicRouteMode";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  // Mantém o splash global ligado enquanto a auth não terminou.
  // Sem UI própria: o SplashLoader já está em tela via AppLayout/LoadingProvider.
  useBootGate(loading);

  if (loading) return null;
  if (!user && isCuratorPublicMode()) return <Navigate to={getCuratorPublicPath()} replace />;
  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
}
