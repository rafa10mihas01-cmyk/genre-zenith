// Helper para o operador admin abrir o portal do cliente sem PIN,
// mesmo quando o portal está em outro domínio (engine.nexcreatorx.com).
// Estratégia: chama admin-campaign-access (que valida role admin via JWT
// do Supabase), recebe o JWT do portal e abre a URL com `#admin_jwt=...`.
// A página `/p/plano/:token` lê o hash, grava em localStorage e libera.
import { supabase } from "@/integrations/supabase/client";
import { PUBLIC_DOMAIN } from "@/lib/curatorPublicUrl";
import { toast } from "@/hooks/use-toast";

export async function openAdminPortal(token: string) {
  const baseUrl = `${PUBLIC_DOMAIN}/p/plano/${token}`;
  try {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess?.session?.access_token) {
      window.open(baseUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const { data } = await supabase.functions.invoke("admin-campaign-access", {
      body: { token },
    });
    const jwt = (data as { jwt?: string } | null)?.jwt;
    if (jwt) {
      window.open(`${baseUrl}#admin_jwt=${encodeURIComponent(jwt)}`, "_blank", "noopener,noreferrer");
      return;
    }
    // Sem JWT (não é admin ou campanha sem PIN) → abre normal.
    window.open(baseUrl, "_blank", "noopener,noreferrer");
  } catch {
    toast({ title: "Não consegui pré-autenticar", description: "Abrindo o portal normalmente.", variant: "destructive" });
    window.open(baseUrl, "_blank", "noopener,noreferrer");
  }
}
