import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Settings as SettingsIcon, KeyRound, CheckCircle2, XCircle, Loader2, Zap, RefreshCw, LogOut, Database, CalendarClock, Play, Music2, UserCheck, Star, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";

const STORAGE_KEY = "nx-collect-settings";

interface NxSettings {
  delay_ms: number;
  max_results: number;
}

// Apify cobra por chamada (não por item) → maximizar maxResults é grátis.
// Mínimo recomendado: 50. Padrão: 100.
const DEFAULTS: NxSettings = { delay_ms: 2000, max_results: 100 };

function loadSettings(): NxSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULTS;
}

export default function Settings() {
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

  async function testSpotify() {
    setSpotifyTesting(true); setSpotifyResult(null);
    const { data, error } = await supabase.functions.invoke("spotify-auth");
    setSpotifyTesting(false);
    if (error) { setSpotifyResult({ ok: false, msg: error.message }); return; }
    if (data?.ok) setSpotifyResult({ ok: true, msg: data.message ?? "Conectado", meta: { token: data.token_prefix } });
    else setSpotifyResult({ ok: false, msg: data?.error ?? "Falha desconhecida" });
  }

  useEffect(() => { void loadStats(); void loadSpotifyAccounts(); }, []);

  // Trata retorno do OAuth do Spotify
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("spotify_callback") === "1") {
      const code = params.get("code");
      const state = params.get("state");
      const error = params.get("error");
      const redirect = `${window.location.origin}/settings?spotify_callback=1`;
      if (error) {
        toast.error("Conexão Spotify cancelada", { description: error });
      } else if (code) {
        (async () => {
          const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spotify-auth?mode=callback&code=${encodeURIComponent(code)}&redirect=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state ?? "")}`;
          const resp = await fetch(url, {
            headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
          });
          const json = await resp.json();
          if (json?.ok) {
            toast.success("Conta Spotify conectada", { description: json.display_name ?? json.spotify_user_id });
            await loadSpotifyAccounts();
          } else {
            toast.error("Falha ao conectar Spotify", { description: json?.error ?? "" });
          }
          window.history.replaceState({}, "", "/settings");
        })();
      }
    }
  }, []);

  async function loadSpotifyAccounts() {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spotify-auth?mode=accounts`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
    });
    const j = await resp.json();
    if (j?.ok) setSpotifyAccounts(j.accounts ?? []);
  }

  async function connectSpotify() {
    setConnectingSpotify(true);
    try {
      const redirect = `${window.location.origin}/settings?spotify_callback=1`;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spotify-auth?mode=login&redirect=${encodeURIComponent(redirect)}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
      });
      const j = await resp.json();
      if (!j?.ok) throw new Error(j?.error ?? "Falha");
      window.location.href = j.url;
    } catch (e: any) {
      toast.error("Erro ao iniciar conexão", { description: e?.message });
      setConnectingSpotify(false);
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

  return (
    <div className="max-w-[900px] mx-auto space-y-6">
      <PageHeader
        kicker="Sistema"
        icon={SettingsIcon}
        title="Configurações"
        subtitle="Gerenciar conexões com Apify e Spotify, parâmetros de coleta e dados da conta."
      />

      {/* Apify */}
      <section className="nx-card p-5 mt-6">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-accent" />
          <h2 className="font-semibold">Apify</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Sua APIFY_API_KEY está armazenada no backend (Lovable Cloud) — nunca no navegador.
        </p>

        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-success/15 text-success border border-success/30 text-xs">
            <KeyRound className="h-3.5 w-3.5" /> APIFY_API_KEY configurada
          </div>
          <Button size="sm" variant="outline" onClick={testConnection} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Testar conexão
          </Button>
        </div>

        {testResult && (
          <div className={`mt-3 p-3 rounded-lg border text-sm ${
            testResult.ok
              ? "bg-success/10 border-success/30 text-success-foreground"
              : "bg-destructive/10 border-destructive/30 text-destructive"
          }`}>
            <div className="flex items-center gap-2 font-medium">
              {testResult.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
              {testResult.msg}
            </div>
            {testResult.meta && (
              <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                {testResult.meta.username && <div>Usuário: <span className="font-mono text-foreground">{testResult.meta.username}</span></div>}
                {testResult.meta.email && <div>Email: <span className="font-mono text-foreground">{testResult.meta.email}</span></div>}
                {testResult.meta.plan && <div>Plano: <span className="font-mono text-foreground">{testResult.meta.plan}</span></div>}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Spotify Web API */}
      <section className="nx-card p-5 mt-4">
        <div className="flex items-center gap-2">
          <Music2 className="h-5 w-5 text-accent" />
          <h2 className="font-semibold">Spotify Web API</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Usado para buscar contagem real de seguidores das playlists. Crie um app gratuito em{" "}
          <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer"
             className="text-accent underline-offset-2 hover:underline">
            developer.spotify.com → Dashboard → Create app
          </a>
          . Copie o Client ID e Client Secret e configure como secrets do projeto.
        </p>
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-success/15 text-success border border-success/30 text-xs">
            <KeyRound className="h-3.5 w-3.5" /> SPOTIFY_CLIENT_ID + SECRET configurados
          </div>
          <Button size="sm" variant="outline" onClick={testSpotify} disabled={spotifyTesting}>
            {spotifyTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Testar conexão
          </Button>
        </div>
        {spotifyResult && (
          <div className={`mt-3 p-3 rounded-lg border text-sm ${
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

        {/* Contas conectadas (OAuth) */}
        <div className="mt-5 pt-5 border-t border-border">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <UserCheck className="h-4 w-4 text-primary" /> Contas Spotify conectadas
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Necessário para criar playlists no Spotify a partir de templates aprovados.
                Adicione <span className="font-mono text-foreground">{`${window.location.origin}/settings?spotify_callback=1`}</span> como Redirect URI no app do Spotify.
              </p>
            </div>
            <Button size="sm" onClick={connectSpotify} disabled={connectingSpotify}>
              {connectingSpotify ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music2 className="h-4 w-4" />}
              Conectar conta
            </Button>
          </div>

          {spotifyAccounts.length === 0 ? (
            <p className="text-xs text-muted-foreground mt-3 italic">Nenhuma conta conectada ainda.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {spotifyAccounts.map((acc) => (
                <div key={acc.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-border bg-muted/20">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{acc.display_name ?? acc.spotify_user_id}</span>
                      {acc.is_default && (
                        <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                          <Star className="h-2.5 w-2.5" /> padrão
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{acc.email ?? acc.spotify_user_id}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {!acc.is_default && (
                      <Button size="sm" variant="ghost" onClick={() => setDefaultAccount(acc.id)} className="h-7 px-2 text-xs">
                        <Star className="h-3 w-3" /> Padrão
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => removeAccount(acc.id)} className="h-7 w-7 p-0 text-destructive hover:text-destructive">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Parâmetros */}
      <section className="nx-card p-5 mt-4">
        <h2 className="font-semibold">Parâmetros de coleta</h2>
        <p className="text-sm text-muted-foreground mt-1">Salvo localmente. Aplicado automaticamente pelo motor.</p>

        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          <div>
            <Label htmlFor="delay">Delay entre termos (ms)</Label>
            <Input
              id="delay" type="number" min={500} max={10000} step={250}
              value={settings.delay_ms}
              onChange={e => setSettings(s => ({ ...s, delay_ms: Number(e.target.value) || 0 }))}
              className="mt-1.5"
            />
            <p className="text-xs text-muted-foreground mt-1">Recomendado: 2000ms para evitar rate limit.</p>
          </div>
          <div>
            <Label htmlFor="max">Resultados por termo</Label>
            <Input
              id="max" type="number" min={50} max={200} step={10}
              value={settings.max_results}
              onChange={e => setSettings(s => ({ ...s, max_results: Number(e.target.value) || 0 }))}
              className="mt-1.5"
            />
            <p className="text-xs text-muted-foreground mt-1">Máximo de playlists por busca (5-100).</p>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={saveSettings}>Salvar</Button>
        </div>
      </section>

      {/* Coleta automática */}
      <section className="nx-card p-5 mt-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-accent" />
          <h2 className="font-semibold">Coleta automática</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Cron diário às <span className="font-mono text-foreground">03:00 UTC</span> percorre todos os gêneros ativos,
          executa termos pendentes (até 3/gênero) e re-analisa os modelos.
        </p>
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-success/15 text-success border border-success/30 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5" /> Agendado
          </div>
          <Button size="sm" variant="outline" onClick={runCronNow} disabled={runningCron}>
            {runningCron ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Executar agora
          </Button>
        </div>
      </section>

      {/* Banco */}
      <section className="nx-card p-5 mt-4">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-accent" />
          <h2 className="font-semibold">Estado do banco</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <DbStat label="Gêneros" value={stats?.genres} />
          <DbStat label="Termos" value={stats?.terms} />
          <DbStat label="Playlists" value={stats?.results} />
          <DbStat label="Músicas" value={stats?.tracks} />
        </div>
      </section>

      {/* Conta */}
      <section className="nx-card p-5 mt-4">
        <h2 className="font-semibold">Conta</h2>
        <div className="flex items-center justify-between mt-3 flex-wrap gap-3">
          <div className="text-sm">
            <div className="text-muted-foreground text-xs">Logado como</div>
            <div className="font-mono">{user?.email ?? "—"}</div>
          </div>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sair
          </Button>
        </div>
      </section>
    </div>
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
