// Abre o portal do curador para operador admin sem OTP/senha.
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export async function openAdminCuratorPortal(opts: { slug?: string | null; publicToken?: string | null }) {
  const token = ((opts.slug && opts.slug.trim()) || (opts.publicToken ?? "")).trim();
  const baseUrl = `${window.location.origin}/curador/${encodeURIComponent(token)}`;
  const win = window.open("about:blank", "_blank");

  const navigate = (url: string) => {
    if (win) {
      try { win.opener = null; } catch { /* ignore */ }
      win.location.href = url;
    } else {
      window.location.assign(url);
    }
  };

  try {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess?.session?.access_token || !token) {
      navigate(baseUrl);
      return;
    }

    const { data } = await supabase.functions.invoke("admin-curator-access", {
      body: { token },
    });
    const jwt = (data as { jwt?: string } | null)?.jwt;
    if (jwt) {
      navigate(`${baseUrl}#admin_jwt=${encodeURIComponent(jwt)}`);
      return;
    }
    navigate(baseUrl);
  } catch {
    toast.error("Não consegui pré-autenticar. Abrindo o portal normalmente.");
    navigate(baseUrl);
  }
}