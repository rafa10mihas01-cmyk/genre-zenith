import { lazy, type ComponentType } from "react";

/**
 * Wrapper para React.lazy que trata o erro clássico
 * "Failed to fetch dynamically imported module" — que acontece quando o
 * usuário está com uma aba antiga aberta após um novo deploy (o hash do
 * chunk muda e o arquivo antigo não existe mais no CDN).
 *
 * Estratégia:
 *  1. Tenta importar novamente uma vez (rede instável).
 *  2. Se falhar de novo e parecer erro de chunk, força reload da página
 *     usando uma flag em sessionStorage pra evitar loop infinito.
 */
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err: any) {
      const msg = String(err?.message || err);
      const isChunkError =
        /Failed to fetch dynamically imported module/i.test(msg) ||
        /Importing a module script failed/i.test(msg) ||
        /ChunkLoadError/i.test(msg);

      if (isChunkError) {
        const key = "lovable:chunk-reload";
        const already = sessionStorage.getItem(key);
        if (!already) {
          sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
          // Devolve um componente vazio até o reload acontecer
          return { default: (() => null) as unknown as T };
        }
        sessionStorage.removeItem(key);
      }
      throw err;
    }
  });
}
