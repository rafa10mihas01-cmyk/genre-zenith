// Abre o portal do curador para operador admin sem OTP/senha.
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export async function openAdminCuratorPortal(opts: { slug?: string | null; publicToken?: string | null }) {
  const token = ((opts.slug && opts.slug.trim()) || (opts.publicToken ?? "")).trim();
  const baseUrl = `${window.location.origin}/curador/${encodeURIComponent(token)}`;

  try {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess?.session?.access_token || !token) {
      window.open(baseUrl, "_blank", "noopener,noreferrer");
      return;
    }

    const { data } = await supabase.functions.invoke("admin-curator-access", {
      body: { token },
    });
    const jwt = (data as { jwt?: string } | null)?.jwt;
    const finalUrl = jwt ? `${baseUrl}#admin_jwt=${encodeURIComponent(jwt)}` : baseUrl;
    window.open(finalUrl, "_blank", "noopener,noreferrer");
  } catch {
    toast.error("Não consegui pré-autenticar. Abrindo o portal normalmente.");
    window.open(baseUrl, "_blank", "noopener,noreferrer");
  }
}