// Helper para o operador admin abrir o portal do cliente sem PIN,
// mesmo quando o portal está em outro domínio (engine.nexcreatorx.com).
// Estratégia: chama admin-campaign-access (que valida role admin via JWT
// do Supabase), recebe o JWT do portal e abre a URL com `#admin_jwt=...`.
// A página `/p/plano/:token` lê o hash, grava em localStorage e libera.
//
// IMPORTANTE: no mobile (iOS Safari / Chrome Android), `window.open` depois
// de um await vira about:blank em branco — o gesto do clique já expirou.
// Pra evitar isso, navegamos sempre na MESMA aba via window.location.
// O operador volta com o botão "voltar" do navegador.
import { supabase } from "@/integrations/supabase/client";
import { PUBLIC_DOMAIN } from "@/lib/curatorPublicUrl";
import { toast } from "@/hooks/use-toast";

export async function openAdminPortal(token: string) {
  const baseUrl = `${PUBLIC_DOMAIN}/p/plano/${token}`;
  try {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess?.session?.access_token) {
      window.location.assign(baseUrl);
      return;
    }
    const { data } = await supabase.functions.invoke("admin-campaign-access", {
      body: { token },
    });
    const jwt = (data as { jwt?: string } | null)?.jwt;
    if (jwt) {
      window.location.assign(`${baseUrl}#admin_jwt=${encodeURIComponent(jwt)}`);
      return;
    }
    window.location.assign(baseUrl);
  } catch {
    toast({ title: "Não consegui pré-autenticar", description: "Abrindo o portal normalmente.", variant: "destructive" });
    window.location.assign(baseUrl);
  }
}
