// Helper client-side para iniciar o OAuth público do Spotify a partir da landing.
// Chama a edge function `spotify-public-auth` (que mantém o CLIENT_SECRET
// no servidor) para obter a URL de autorização e redirecionar.


const STATE_KEY = "nx:spotify_oauth_state";

export function getSpotifyRedirectUri(slug?: string | null): string {
  // O redirect_uri precisa ser EXATAMENTE igual ao cadastrado no painel
  // de desenvolvedor do Spotify. Cada app tem seu próprio path /spotify/callback/<slug>.
  // Sem slug = fluxo público/legado em /spotify/callback.
  const base = `${window.location.origin}/spotify/callback`;
  return slug ? `${base}/${slug}` : base;
}

/**
 * Inicia o fluxo OAuth do Spotify diretamente.
 * O usuário sai da landing e vai para accounts.spotify.com/authorize.
 */
export async function handleSpotifyLogin(): Promise<void> {
  const redirect = getSpotifyRedirectUri();
  const isEmbedded = window.self !== window.top;
  // Em mobile/preview, o Spotify precisa abrir em uma aba criada pelo clique do usuário.
  // Não use `noopener/noreferrer` aqui: isso quebra a referência do popup e deixa a aba presa em about:blank.
  const popup = isEmbedded ? window.open("", "_blank") : null;

  if (isEmbedded && !popup) {
    throw new Error("O navegador bloqueou a nova aba. Permita pop-ups para abrir o login do Spotify.");
  }

  if (popup) {
    popup.document.write(
      "<html><head><title>Abrindo Spotify…</title></head><body style='font-family:system-ui,sans-serif;padding:32px;text-align:center'><p>Abrindo Spotify…</p></body></html>",
    );
  }

  // supabase-js v2 não passa query params em GET via invoke,
  // então usamos fetch direto para esse caso simples.
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spotify-public-auth?mode=login&redirect=${encodeURIComponent(redirect)}`;
  const resp = await fetch(url, {
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
  });
  const json = await resp.json();
  if (!json.ok || !json.url) {
    popup?.close();
    throw new Error(json.error || "Falha ao iniciar OAuth do Spotify");
  }

  // Guarda o state para validar no callback (proteção CSRF leve).
  // Usa localStorage porque o popup aberto na sequência tem sessionStorage isolado.
  localStorage.setItem(STATE_KEY, json.state);

  if (popup) {
    popup.location.replace(json.url);
    return;
  }

  window.location.href = json.url;
}

export function consumeStoredState(): string | null {
  // Lê de localStorage (compartilhado entre janelas/abas da mesma origem).
  // Fallback para sessionStorage para compatibilidade com sessões em andamento.
  const v = localStorage.getItem(STATE_KEY) ?? sessionStorage.getItem(STATE_KEY);
  localStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  return v;
}
