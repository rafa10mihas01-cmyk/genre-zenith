import { Navigate } from "react-router-dom";
import { ReactNode } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import { Zap, ShieldAlert } from "lucide-react";

/**
 * Bloqueia rotas para usuários sem papel `admin`.
 * Usado para envolver páginas como /configuracoes que curadores não devem acessar.
 */
export default function AdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useUserRole();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Zap className="h-5 w-5 text-primary animate-pulse-soft" />
          <span>Verificando permissões…</span>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full nx-card p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <ShieldAlert className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="text-lg font-semibold mb-2">Acesso restrito</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Esta área é exclusiva de administradores. Fale com um admin para solicitar acesso.
          </p>
          <a
            href="/"
            className="inline-flex items-center justify-center h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            Voltar para o início
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
