// Utilitário de cópia de links do Spotify (só UI — não toca em dados).
import { toast } from "@/hooks/use-toast";

export const trackUrl = (id: string) => `https://open.spotify.com/track/${id}`;
export const playlistUrl = (id: string) => `https://open.spotify.com/playlist/${id}`;

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback pra contextos sem permissão de clipboard
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

/** Copia um único link. */
export async function copyLink(url: string, label = "Link copiado") {
  const ok = await writeClipboard(url);
  toast(ok ? { title: label, description: url } : { title: "Não foi possível copiar", variant: "destructive" });
}

/** Copia vários links, um por linha. */
export async function copyLinks(urls: string[], label = "Links copiados") {
  const list = urls.filter(Boolean);
  if (list.length === 0) {
    toast({ title: "Nenhum link para copiar" });
    return;
  }
  const ok = await writeClipboard(list.join("\n"));
  toast(
    ok
      ? { title: label, description: `${list.length} link${list.length > 1 ? "s" : ""} na área de transferência` }
      : { title: "Não foi possível copiar", variant: "destructive" },
  );
}
