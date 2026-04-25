// Helper client-side para iniciar o OAuth público do Spotify a partir da landing.
// Chama a edge function `spotify-public-auth` (que mantém o CLIENT_SECRET
// no servidor) para obter a URL de autorização e redirecionar.


const STATE_KEY = "nx:spotify_oauth_state";

export function getSpotifyRedirectUri(): string {
  // O redirect_uri precisa ser EXATAMENTE igual ao cadastrado no painel
  // de desenvolvedor do Spotify. Usamos a origem atual + /spotify/callback.
  return `${window.location.origin}/spotify/callback`;
}

/**
 * Inicia o fluxo OAuth do Spotify diretamente.
 * O usuário sai da landing e vai para accounts.spotify.com/authorize.
 */
export async function handleSpotifyLogin(): Promise<void> {
  const redirect = getSpotifyRedirectUri();
  const isEmbedded = window.self !== window.top;
  const popup = isEmbedded ? window.open("about:blank", "_blank", "noopener,noreferrer") : null;

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

  // Guarda o state para validar no callback (proteção CSRF leve)
  sessionStorage.setItem(STATE_KEY, json.state);

  if (popup) {
    popup.location.href = json.url;
    return;
  }

  window.location.href = json.url;
}

export function consumeStoredState(): string | null {
  const v = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  return v;
}
