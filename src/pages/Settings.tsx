import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Settings as SettingsIcon, KeyRound, CheckCircle2, XCircle, Loader2, Zap, RefreshCw, LogOut, Database, CalendarClock, Play,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

const STORAGE_KEY = "nx-collect-settings";

interface NxSettings {
  delay_ms: number;
  max_results: number;
}

const DEFAULTS: NxSettings = { delay_ms: 2000, max_results: 20 };

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

  useEffect(() => { void loadStats(); }, []);

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
    <div className="max-w-[900px] mx-auto">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center">
          <SettingsIcon className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Conexão Apify, parâmetros de coleta e conta</p>
        </div>
      </div>

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
              id="max" type="number" min={5} max={100} step={5}
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
