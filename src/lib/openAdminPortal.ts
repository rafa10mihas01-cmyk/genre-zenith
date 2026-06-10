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

  // IMPORTANTE: abrir a janela SINCRONAMENTE dentro do gesto do usuário,
  // senão browsers mobile (Safari iOS, Chrome Android) bloqueiam o popup
  // depois do await. Se conseguirmos abrir, navegamos depois; se não,
  // caímos pra navegação na mesma aba.
  const win = window.open("about:blank", "_blank", "noopener,noreferrer");

  const go = (url: string) => {
    if (win && !win.closed) {
      try { win.location.replace(url); return; } catch { /* fallthrough */ }
    }
    // Popup bloqueado → navega na mesma aba (não some o link do operador).
    window.location.href = url;
  };

  try {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess?.session?.access_token) {
      go(baseUrl);
      return;
    }
    const { data } = await supabase.functions.invoke("admin-campaign-access", {
      body: { token },
    });
    const jwt = (data as { jwt?: string } | null)?.jwt;
    if (jwt) {
      go(`${baseUrl}#admin_jwt=${encodeURIComponent(jwt)}`);
      return;
    }
    go(baseUrl);
  } catch {
    toast({ title: "Não consegui pré-autenticar", description: "Abrindo o portal normalmente.", variant: "destructive" });
    go(baseUrl);
  }
}
