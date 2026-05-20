import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Settings as SettingsIcon, KeyRound, CheckCircle2, XCircle, Loader2, Zap, RefreshCw, LogOut, Database, CalendarClock, Play, Music2, UserCheck, Star, Trash2, AlertTriangle, ExternalLink, Plug, Users,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { EquipeTab } from "@/components/settings/EquipeTab";
import { AccountsManager } from "@/components/operacao/AccountsManager";
import { AppConnectionCard } from "@/components/settings/AppConnectionCard";
import { SpotifyAppsManager, type SpotifyApp } from "@/components/settings/SpotifyAppsManager";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

const STORAGE_KEY = "nx-collect-settings";
const SETTINGS_ROUTE = "/configuracoes";
const SPOTIFY_SETTINGS_RETURN_KEY = "nx:spotify_settings_return";

function getSpotifyRedirectUri(slug?: string | null) {
  const base = `${window.location.origin}/spotify/callback`;
  return slug ? `${base}/${slug}` : base;
}

function getLegacySpotifySettingsRedirectUri() {
  return `${window.location.origin}${SETTINGS_ROUTE}?spotify_callback=1`;
}

/** Chama spotify-auth com o JWT do usuário logado (necessário após hardening). */
async function callSpotifyAuth(qs: string): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spotify-auth?${qs}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return resp.json();
}

interface NxSettings {
  delay_ms: number;
  max_results: number;
}

// Apify cobra por chamada (não por item) → maximizar maxResults é grátis.
// Mínimo recomendado: 50. Padrão: 100.
const DEFAULTS: NxSettings = { delay_ms: 2000, max_results: 100 };

/**
 * Tema do popup do Spotify (window.open isolado, sem acesso a CSS vars).
 * Estes valores DEVEM espelhar os tokens HSL definidos em src/index.css:
 *   --background: 0 0% 1.96%   → #050505
 *   --foreground: 0 0% 100%    → #FFFFFF
 *   --primary:    141 76% 48%  → #1DB954 (Spotify green)
 *   --muted-foreground: 218 11% 65% → #9CA3AF
 * Se os tokens mudarem, atualizar aqui também.
 */
const POPUP_THEME = {
  bg: "#050505",
  fg: "#FFFFFF",
  accent: "#1DB954",
  muted: "#9CA3AF",
} as const;

function loadSettings(): NxSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULTS;
}

export default function Settings({ embedded = false }: { embedded?: boolean } = {}) {
  const { user, signOut } = useAuth();
  const [settings, setSettings] = useState<NxSettings>(loadSettings);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string; meta?: any } | null>(null);
  const [stats, setStats] = useState<{ genres: number; terms: number; results: number; tracks: number } | null>(null);
  const [runningCron, setRunningCron] = useState(false);
  const [spotifyTesting, setSpotifyTesting] = useState(false);
  const [spotifyResult, setSpotifyResult] = useState<{ ok: boolean; msg: string; meta?: any } | null>(null);
  const [spotifyAccounts, setSpotifyAccounts] = useState<any[]>([]);
  const [connectingSpotify, setConnectingSpotify] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);
  const [spotifyApps, setSpotifyApps] = useState<SpotifyApp[]>([]);
  const [pickerOpen, setPickerOpen] = useState<null | { forceLogin: boolean }>(null);
  const [requiredScopes, setRequiredScopes] = useState<string[]>([]);

  useEffect(() => {
    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      setIsInIframe(true);
    }
  }, []);

  function openSpotifyPopup(authUrl: string, forceLogin = false) {
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      toast.error("Pop-up bloqueado", { description: "Permita pop-ups para este site e tente de novo." });
      return null;
    }

    if (forceLogin) {
      popup.document.write(`
        <html><head><title>Trocando conta no Spotify…</title>
        <style>
          body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;
          background:${POPUP_THEME.bg};color:${POPUP_THEME.fg};font-family:Inter,system-ui,sans-serif;flex-direction:column;gap:16px;}
          .spinner{width:32px;height:32px;border:3px solid ${POPUP_THEME.accent};border-top-color:transparent;
          border-radius:50%;animation:spin .8s linear infinite;}
          .hint{max-width:320px;text-align:center;line-height:1.5;color:${POPUP_THEME.muted};font-size:14px;}
          @keyframes spin{to{transform:rotate(360deg);}}
        </style></head>
        <body>
          <div class="spinner"></div>
          <div>Preparando troca de conta…</div>
          <div class="hint">Estamos encerrando a sessão atual do Spotify e abrindo a autorização da próxima conta.</div>
        </body></html>
      `);
      popup.document.close();

      popup.location.href = "https://accounts.spotify.com/logout";
      window.setTimeout(() => {
        try {
          popup.location.href = authUrl;
        } catch {
          window.open(authUrl, "_blank");
        }
      }, 1400);
    } else {
      popup.location.href = authUrl;
    }

    return popup;
  }

  async function openInNewTab(forceLogin = false, appId?: string) {
    try {
      const redirect = getSpotifyRedirectUri();
      localStorage.setItem(SPOTIFY_SETTINGS_RETURN_KEY, `${window.location.pathname}${window.location.search || ""}`);
      const qs = new URLSearchParams({ mode: "login", redirect });
      if (forceLogin) qs.set("force_login", "1");
      if (appId) qs.set("app_id", appId);
      const j = await callSpotifyAuth(qs.toString());
      if (!j?.ok) throw new Error(j?.error ?? "Falha ao gerar URL do Spotify");

      const opened = openSpotifyPopup(j.url, forceLogin);
      if (!opened) {
        if (window.top) window.top.location.href = j.url;
        else window.location.href = j.url;
      }
      toast.info(forceLogin ? "Trocando conta no Spotify" : `Autorização aberta (app: ${j.app ?? "default"})`, {
        description: forceLogin
          ? "A sessão atual será encerrada e a próxima conta poderá ser autorizada."
          : "Aprove o acesso. Depois volte aqui e atualize que a conta aparece.",
      });
    } catch (e: any) {
      toast.error("Erro ao abrir Spotify", { description: e?.message });
    }
  }

  async function testSpotify() {
    setSpotifyTesting(true); setSpotifyResult(null);
    const { data, error } = await supabase.functions.invoke("spotify-auth");
    setSpotifyTesting(false);
    if (error) { setSpotifyResult({ ok: false, msg: error.message }); return; }
    if (data?.ok) setSpotifyResult({ ok: true, msg: data.message ?? "Conectado", meta: { token: data.token_prefix } });
    else setSpotifyResult({ ok: false, msg: data?.error ?? "Falha desconhecida" });
  }

  useEffect(() => { void loadStats(); void loadSpotifyAccounts(); void loadRequiredScopes(); }, []);

  async function loadRequiredScopes() {
    const j = await callSpotifyAuth("mode=scopes");
    if (j?.ok && Array.isArray(j.scopes)) setRequiredScopes(j.scopes);
  }

  // Trata retorno do OAuth do Spotify (guard contra StrictMode/duplo-disparo)
  const spotifyCallbackHandled = useRef(false);
  useEffect(() => {
    if (spotifyCallbackHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("spotify_callback") !== "1") return;

    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    const redirect = getLegacySpotifySettingsRedirectUri();

    // Marca como tratado E limpa a URL ANTES de qualquer await — impede re-entrada
    spotifyCallbackHandled.current = true;
    window.history.replaceState({}, "", SETTINGS_ROUTE);

    if (error) {
      toast.error("Conexão Spotify cancelada", { description: error });
      return;
    }
    if (!code) return;

    (async () => {
      const qs = `mode=callback&code=${encodeURIComponent(code)}&redirect=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state ?? "")}`;
      const json = await callSpotifyAuth(qs);
      if (json?.ok) {
        toast.success("Conta Spotify conectada", { description: json.display_name ?? json.spotify_user_id });
        await loadSpotifyAccounts();
      } else {
        toast.error("Falha ao conectar Spotify", { description: json?.error ?? "" });
      }
    })();
  }, []);

  async function loadSpotifyAccounts() {
    const j = await callSpotifyAuth("mode=accounts");
    if (j?.ok) setSpotifyAccounts(j.accounts ?? []);
  }

  async function connectSpotify(forceLogin = false, appId?: string) {
    if (isInIframe) {
      await openInNewTab(forceLogin, appId);
      return;
    }
    setConnectingSpotify(true);
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setConnectingSpotify(false);
      toast.error("Pop-up bloqueado", { description: "Permita pop-ups para este site e tente de novo." });
      return;
    }

    try {
      const redirect = getSpotifyRedirectUri();
      localStorage.setItem(SPOTIFY_SETTINGS_RETURN_KEY, `${window.location.pathname}${window.location.search || ""}`);
      const qs = new URLSearchParams({ mode: "login", redirect });
      if (forceLogin) qs.set("force_login", "1");
      if (appId) qs.set("app_id", appId);
      const j = await callSpotifyAuth(qs.toString());
      if (!j?.ok) throw new Error(j?.error ?? "Falha");

      if (forceLogin) {
        popup.close();
        openSpotifyPopup(j.url, true);
        toast.info("Escolha a outra conta", {
          description: `App: ${j.app ?? "default"}. Vamos encerrar a sessão atual e abrir a autorização da próxima conta.`,
        });
      } else {
        popup.location.href = j.url;
        toast.info(`Autorização aberta (app: ${j.app ?? "default"})`, {
          description: "Depois de aprovar no Spotify, volte para esta tela que a conta será registrada automaticamente.",
        });
      }
    } catch (e: any) {
      popup?.close();
      toast.error("Erro ao iniciar conexão", { description: e?.message });
    } finally {
      setConnectingSpotify(false);
    }
  }

  function handleAddAccountClick(forceLogin: boolean) {
    const eligible = spotifyApps.filter((a) => a.status === "active" && a.slots_remaining > 0);
    if (eligible.length <= 1) {
      // 0 (usa fallback) ou 1 (auto) → sem picker
      const appId = eligible[0]?.id;
      void (isInIframe ? openInNewTab(forceLogin, appId) : connectSpotify(forceLogin, appId));
    } else {
      setPickerOpen({ forceLogin });
    }
  }

  async function setDefaultAccount(id: string) {
    await supabase.from("spotify_user_tokens").update({ is_default: false }).neq("id", id);
    await supabase.from("spotify_user_tokens").update({ is_default: true }).eq("id", id);
    toast.success("Conta padrão atualizada");
    await loadSpotifyAccounts();
  }

  async function removeAccount(id: string) {
    await supabase.from("spotify_user_tokens").delete().eq("id", id);
    toast.success("Conta removida");
    await loadSpotifyAccounts();
  }

  async function loadStats() {
    const [g, t, r, tr] = await Promise.all([
      supabase.from("genres").select("*", { count: "exact", head: true }),
      supabase.from("search_terms").select("*", { count: "exact", head: true }),
      supabase.from("search_results").select("*", { count: "exact", head: true }),
      supabase.from("search_tracks").select("*", { count: "exact", head: true }),
    ]);
    setStats({
      genres: g.count ?? 0, terms: t.count ?? 0, results: r.count ?? 0, tracks: tr.count ?? 0,
    });
  }

  async function testConnection() {
    setTesting(true); setTestResult(null);
    const { data, error } = await supabase.functions.invoke("test-apify");
    setTesting(false);
    if (error) {
      setTestResult({ ok: false, msg: error.message });
      return;
    }
    if (data?.ok) {
      setTestResult({ ok: true, msg: `Conectado em ${data.elapsed_ms}ms`, meta: data.user });
    } else {
      setTestResult({ ok: false, msg: data?.error ?? "Falha desconhecida" });
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    toast.success("Configurações salvas", { description: "Aplicadas nas próximas coletas." });
  }

  async function runCronNow() {
    setRunningCron(true);
    const { data, error } = await supabase.functions.invoke("daily-collect");
    setRunningCron(false);
    if (error || !data?.ok) {
      toast.error("Falha ao executar coleta", { description: error?.message ?? data?.error });
      return;
    }
    toast.success("Coleta executada", {
      description: `${data.genres} gêneros, ${data.terms_run} buscas, ${data.models_updated} modelos. ${data.errors} erros.`,
    });
    loadStats();
  }

  const Wrapper: any = embedded ? "div" : PageContainer;
  return (
    <Wrapper>
      {!embedded && (
        <PageHeader
        domain="system"
          title="Configurações"
          subtitle="Preferências"
        />
      )}

      <Tabs defaultValue="conexoes" className={embedded ? "" : "mt-2"}>
        {/* TABS — mesmo padrão visual de Operação / Playlist Deals / Sistema */}
        <div className="sticky top-0 z-30 bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-md border-b border-border -mx-4 md:-mx-6">
        <TabsList className="nx-tab-rail h-auto bg-transparent p-0 rounded-none items-center gap-1 justify-start px-4 md:px-6">
          <TabsTrigger
            value="conexoes"
            className="px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground rounded-none bg-transparent shadow-none -mb-px shrink-0 whitespace-nowrap transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <Plug className="h-3.5 w-3.5" /> Conexões
          </TabsTrigger>
          <TabsTrigger
            value="coleta"
            className="px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground rounded-none bg-transparent shadow-none -mb-px shrink-0 whitespace-nowrap transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <Database className="h-3.5 w-3.5" /> Coleta
          </TabsTrigger>
          <TabsTrigger
            value="contas-spotify"
            className="px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground rounded-none bg-transparent shadow-none -mb-px shrink-0 whitespace-nowrap transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <Music2 className="h-3.5 w-3.5" /> Contas Spotify
          </TabsTrigger>
          <TabsTrigger
            value="equipe"
            className="px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground rounded-none bg-transparent shadow-none -mb-px shrink-0 whitespace-nowrap transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <Users className="h-3.5 w-3.5" /> Equipe
          </TabsTrigger>
          <TabsTrigger
            value="conta"
            className="px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground rounded-none bg-transparent shadow-none -mb-px shrink-0 whitespace-nowrap transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <UserCheck className="h-3.5 w-3.5" /> Conta
          </TabsTrigger>
        </TabsList>
        </div>

        {/* ───────────────────────── CONEXÕES ───────────────────────── */}
        <TabsContent value="conexoes" className="space-y-3 mt-4">

          {/* ============ APP: SPOTIFY ============ */}
          <AppConnectionCard
            icon={Music2}
            name="Spotify"
            description="Busca de seguidores reais e criação de playlists a partir de templates aprovados."
            status="ok"
            statusLabel="API conectada"
            actions={
              <Button
                size="sm"
                variant="outline"
                onClick={testSpotify}
                disabled={spotifyTesting}
                className="h-8 text-xs gap-1.5"
              >
                {spotifyTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Testar conexão
              </Button>
            }
          >
            {/* Resultado de teste (quando aparece) */}
            {spotifyResult && (
              <div className={`mb-4 p-3 rounded-lg border text-sm ${
                spotifyResult.ok
                  ? "bg-success/10 border-success/30 text-success-foreground"
                  : "bg-destructive/10 border-destructive/30 text-destructive"
              }`}>
                <div className="flex items-center gap-2 font-medium">
                  {spotifyResult.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
                  {spotifyResult.msg}
                </div>
                {spotifyResult.meta?.token && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Token: <span className="font-mono text-foreground">{spotifyResult.meta.token}</span>
                  </div>
                )}
              </div>
            )}

            {/* Apps Spotify (guarda-chuva multi-app) */}
            <SpotifyAppsManager
              onChange={setSpotifyApps}
              onConnectAccount={(appId, forceLogin) => {
                void (isInIframe ? openInNewTab(forceLogin, appId) : connectSpotify(forceLogin, appId));
              }}
            />


            {/* Contas conectadas */}
            <div>
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
                    Contas conectadas
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {spotifyAccounts.length === 0
                      ? "Sem contas vinculadas."
                      : `${spotifyAccounts.length} conta${spotifyAccounts.length > 1 ? "s" : ""} ativa${spotifyAccounts.length > 1 ? "s" : ""}.`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleAddAccountClick(false)}
                    disabled={connectingSpotify}
                    className="h-8 text-xs gap-1.5"
                  >
                    {connectingSpotify
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : isInIframe ? <ExternalLink className="h-3.5 w-3.5" /> : <Music2 className="h-3.5 w-3.5" />}
                    {spotifyAccounts.length > 0 ? "Adicionar conta" : "Conectar conta"}
                  </Button>
                  {spotifyAccounts.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAddAccountClick(true)}
                      disabled={connectingSpotify}
                      className="h-8 text-xs gap-1.5"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Trocar conta
                    </Button>
                  )}
                </div>
              </div>

              {isInIframe && (
                <div className="mb-3 p-2.5 rounded-lg border border-warning/30 bg-warning/5 flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    O Spotify bloqueia login dentro do preview. Os botões acima abrem em nova aba.
                  </p>
                </div>
              )}

              {spotifyAccounts.length > 0 && (
                <div className="space-y-1.5">
                  {spotifyAccounts.map((acc) => {
                    const grantedScopes: string[] = (acc.scope ?? "").split(/\s+/).filter(Boolean);
                    const missingScopes = requiredScopes.filter((s) => !grantedScopes.includes(s));
                    const needsReauth = requiredScopes.length > 0 && missingScopes.length > 0;
                    return (
                      <div key={acc.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-border bg-muted/20">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm truncate">{acc.display_name ?? acc.spotify_user_id}</span>
                            {acc.is_default && (
                              <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                                <Star className="h-2.5 w-2.5" /> padrão
                              </span>
                            )}
                            {needsReauth && (
                              <span
                                className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-warning/15 text-warning border border-warning/30"
                                title={`Escopos faltando: ${missingScopes.join(", ")}`}
                              >
                                <AlertTriangle className="h-2.5 w-2.5" /> reautorizar ({missingScopes.length})
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono truncate">{acc.email ?? acc.spotify_user_id}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          {needsReauth && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                void (isInIframe ? openInNewTab(true, acc.app_id ?? undefined) : connectSpotify(true, acc.app_id ?? undefined));
                              }}
                              className="h-8 text-xs gap-1 border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
                              title={`Refazer login pra conceder: ${missingScopes.join(", ")}`}
                            >
                              <RefreshCw className="h-3 w-3" /> Reautorizar
                            </Button>
                          )}
                          {!acc.is_default && (
                            <Button size="sm" variant="ghost" onClick={() => setDefaultAccount(acc.id)} className="h-8 px-2 text-xs gap-1">
                              <Star className="h-3 w-3" /> Padrão
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => removeAccount(acc.id)} className="h-8 w-8 p-0 text-destructive hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </AppConnectionCard>
        </TabsContent>

        {/* Picker: qual app usar pra próxima conta? */}
        <Dialog open={!!pickerOpen} onOpenChange={(o) => !o && setPickerOpen(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Em qual app cadastrar essa conta?</DialogTitle>
              <DialogDescription className="text-xs">
                Cada app Spotify tem limite próprio de contas. Escolha onde tem vaga.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              {spotifyApps.filter((a) => a.status === "active" && a.slots_remaining > 0).map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    const f = pickerOpen?.forceLogin ?? false;
                    setPickerOpen(null);
                    void (isInIframe ? openInNewTab(f, a.id) : connectSpotify(f, a.id));
                  }}
                  className="w-full text-left p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm">{a.name}{a.is_default && <span className="ml-2 text-[10px] text-primary">padrão</span>}</div>
                    <span className="text-[11px] text-success">{a.slots_remaining} vaga{a.slots_remaining > 1 ? "s" : ""}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{a.client_id_preview}</div>
                </button>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(null)}>Cancelar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ───────────────────────── COLETA ───────────────────────── */}
        <TabsContent value="coleta" className="space-y-4 mt-4">

      {/* Parâmetros */}
      <section className="nx-card p-4">
        <div className="flex items-center gap-2">
          <SettingsIcon className="h-4 w-4 text-accent shrink-0" />
          <h2 className="text-sm font-bold">Parâmetros de coleta</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">Salvo localmente. Aplicado automaticamente pelo motor.</p>

        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <div>
            <Label htmlFor="delay" className="text-xs">Delay entre termos (ms)</Label>
            <Input
              id="delay" type="number" min={500} max={10000} step={250}
              value={settings.delay_ms}
              onChange={e => setSettings(s => ({ ...s, delay_ms: Number(e.target.value) || 0 }))}
              className="mt-1.5 h-9 text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1">Recomendado: 2000ms para evitar rate limit.</p>
          </div>
          <div>
            <Label htmlFor="max" className="text-xs">Resultados por termo</Label>
            <Input
              id="max" type="number" min={50} max={200} step={10}
              value={settings.max_results}
              onChange={e => setSettings(s => ({ ...s, max_results: Number(e.target.value) || 0 }))}
              className="mt-1.5 h-9 text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1">Máximo de playlists por busca (5-100).</p>
          </div>
        </div>

        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={saveSettings} className="h-8 text-xs">Salvar</Button>
        </div>
      </section>

      {/* Coleta automática */}
      <section className="nx-card p-4 mt-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-accent shrink-0" />
          <h2 className="text-sm font-bold">Coleta automática</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
          Cron diário às <span className="font-mono text-foreground">03:00 UTC</span> percorre todos os gêneros ativos,
          executa termos pendentes (até 3/gênero) e re-analisa os modelos.
        </p>
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-success/15 text-success border border-success/30 text-[11px] font-medium w-fit">
            <CheckCircle2 className="h-3 w-3" /> Agendado
          </div>
          <Button size="sm" variant="outline" onClick={runCronNow} disabled={runningCron} className="h-8 text-xs w-full sm:w-auto">
            {runningCron ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Executar agora
          </Button>
        </div>
      </section>

      {/* Banco */}
      <section className="nx-card p-4 mt-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-accent shrink-0" />
          <h2 className="text-sm font-bold">Estado do banco</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
          <DbStat label="Gêneros" value={stats?.genres} />
          <DbStat label="Termos" value={stats?.terms} />
          <DbStat label="Playlists" value={stats?.results} />
          <DbStat label="Músicas" value={stats?.tracks} />
        </div>
      </section>
        </TabsContent>

        {/* ───────────────────── CONTAS SPOTIFY ───────────────────── */}
        <TabsContent value="contas-spotify" className="mt-4">
          <AccountsManager />
        </TabsContent>

        {/* ───────────────────────── EQUIPE ───────────────────────── */}
        <TabsContent value="equipe" className="mt-4">
          <EquipeTab />
        </TabsContent>

        {/* ───────────────────────── CONTA ───────────────────────── */}
        <TabsContent value="conta" className="space-y-4 mt-4">
          <section className="nx-card p-4">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-accent shrink-0" />
              <h2 className="text-sm font-bold">Conta</h2>
            </div>
            <div className="flex items-center justify-between mt-3 flex-wrap gap-3">
              <div className="text-sm min-w-0">
                <div className="text-muted-foreground text-[11px]">Logado como</div>
                <div className="font-mono text-xs truncate">{user?.email ?? "—"}</div>
              </div>
              <Button variant="outline" size="sm" onClick={signOut} className="h-8 text-xs">
                <LogOut className="h-3.5 w-3.5" /> Sair
              </Button>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </Wrapper>
  );
}

function DbStat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums mt-1">{value ?? "—"}</div>
    </div>
  );
}

export function getCollectSettings(): NxSettings { return loadSettings(); }
