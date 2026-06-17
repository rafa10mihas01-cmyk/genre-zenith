// FASE 4.C.2 — Centro de Operações (NOC).
// Aba única no /sistema com sub-painéis: Correlation · Alertas · Health ·
// Performance · Segurança · RUM · Busca Global.
//
// Tudo somente leitura (admin). Realtime em system_alerts + health_probes.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import {
  Activity, Bell, HeartPulse, Gauge, ShieldAlert, Bug, Search, AlertTriangle, CheckCircle2, XCircle, Clock,
} from "lucide-react";

type Sub = "correlation" | "alertas" | "health" | "performance" | "seguranca" | "rum" | "busca";

const SUBS: { id: Sub; label: string; icon: typeof Activity }[] = [
  { id: "correlation", label: "Correlation", icon: Activity },
  { id: "alertas",     label: "Alertas",     icon: Bell },
  { id: "health",      label: "Health",      icon: HeartPulse },
  { id: "performance", label: "Performance", icon: Gauge },
  { id: "seguranca",   label: "Segurança",   icon: ShieldAlert },
  { id: "rum",         label: "Frontend",    icon: Bug },
  { id: "busca",       label: "Busca",       icon: Search },
];

export function NocPanel() {
  const [sub, setSub] = useState<Sub>("alertas");
  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-muted/30 border border-border">
        {SUBS.map((o) => {
          const Icon = o.icon;
          const active = sub === o.id;
          return (
            <button
              key={o.id}
              onClick={() => setSub(o.id)}
              className={cn(
                "px-3 h-8 inline-flex items-center gap-2 text-[13px] font-medium rounded-md transition-colors",
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {o.label}
            </button>
          );
        })}
      </div>
      {sub === "correlation" && <CorrelationPanel />}
      {sub === "alertas"     && <AlertsPanel />}
      {sub === "health"      && <HealthPanel />}
      {sub === "performance" && <PerformancePanel />}
      {sub === "seguranca"   && <SecurityPanel />}
      {sub === "rum"         && <RumPanel />}
      {sub === "busca"       && <SearchPanel />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Correlation: timeline ponta-a-ponta por correlation_id
// ──────────────────────────────────────────────────────────────────────────
function CorrelationPanel() {
  const [id, setId] = useState("");
  const [rows, setRows] = useState<Array<{ source: string; ts: string; step?: string; status?: string; meta?: any }>>([]);
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!id) return;
    setLoading(true);
    const [be, br, cl, cdl, dp, cps, pol, sa, ce] = await Promise.all([
      supabase.from("bot_events").select("created_at,step,status,metadata").eq("correlation_id", id).order("created_at"),
      supabase.from("bot_ingest_raw").select("created_at,source,endpoint").eq("correlation_id", id).order("created_at"),
      supabase.from("collection_logs").select("created_at,acao,status,mensagem").eq("correlation_id", id as any).order("created_at"),
      supabase.from("curator_deal_logs").select("created_at,note,total_plays").eq("correlation_id", id as any).order("created_at"),
      supabase.from("delivery_proofs").select("created_at,source,playlist_name,plays_total").eq("correlation_id", id).order("created_at"),
      supabase.from("campaign_playlist_collections").select("created_at,source,playlist_name_at_capture").eq("correlation_id", id as any).order("created_at"),
      supabase.from("playlist_operation_log").select("created_at,operation,status").eq("correlation_id", id as any).order("created_at"),
      supabase.from("system_alerts").select("created_at,severity,subsystem,title").eq("correlation_id", id).order("created_at"),
      supabase.from("client_error_log").select("created_at,message,url").eq("correlation_id", id).order("created_at"),
    ]);
    const merged: any[] = [];
    (be.data ?? []).forEach((r: any) => merged.push({ source: "bot_events", ts: r.created_at, step: r.step, status: r.status, meta: r.metadata }));
    (br.data ?? []).forEach((r: any) => merged.push({ source: "ingest_raw", ts: r.created_at, step: r.source, meta: r.endpoint }));
    (cl.data ?? []).forEach((r: any) => merged.push({ source: "collection_logs", ts: r.created_at, step: r.acao, status: r.status, meta: r.mensagem }));
    (cdl.data ?? []).forEach((r: any) => merged.push({ source: "curator_deal_logs", ts: r.created_at, step: "deal_log", meta: `${r.note ?? ""} (plays=${r.total_plays ?? "—"})` }));
    (dp.data ?? []).forEach((r: any) => merged.push({ source: "delivery_proofs", ts: r.created_at, status: r.source, meta: `${r.playlist_name ?? ""} plays=${r.plays_total ?? "—"}` }));
    (cps.data ?? []).forEach((r: any) => merged.push({ source: "campaign_collections", ts: r.created_at, status: r.source, meta: r.playlist_name_at_capture }));
    (pol.data ?? []).forEach((r: any) => merged.push({ source: "playlist_ops", ts: r.created_at, step: r.operation, status: r.status }));
    (sa.data ?? []).forEach(r => merged.push({ source: "system_alerts", ts: r.created_at, step: r.subsystem, status: r.severity, meta: r.title }));
    (ce.data ?? []).forEach(r => merged.push({ source: "frontend", ts: r.created_at, step: "error", meta: r.message }));
    merged.sort((a, b) => a.ts.localeCompare(b.ts));
    setRows(merged);
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          value={id}
          onChange={(e) => setId(e.target.value.trim())}
          placeholder="crrl_xxxxxxxxxxxxxxxx"
          className="flex-1 h-9 px-3 rounded-md bg-card border border-border text-sm font-mono"
        />
        <button onClick={run} className="px-4 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium">
          {loading ? "..." : "Buscar"}
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground p-8 border border-dashed border-border rounded-lg">
          {id ? "Nenhum evento encontrado para este correlation_id." : "Cole um correlation_id e clique em Buscar."}
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr className="text-left">
                <th className="p-2">Quando</th>
                <th className="p-2">Origem</th>
                <th className="p-2">Step</th>
                <th className="p-2">Status</th>
                <th className="p-2">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="p-2 text-muted-foreground whitespace-nowrap">{new Date(r.ts).toLocaleTimeString()}</td>
                  <td className="p-2 font-mono">{r.source}</td>
                  <td className="p-2">{r.step ?? "—"}</td>
                  <td className="p-2"><StatusBadge value={r.status} /></td>
                  <td className="p-2 truncate max-w-[420px]">{typeof r.meta === "string" ? r.meta : r.meta ? JSON.stringify(r.meta).slice(0, 120) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Alertas
// ──────────────────────────────────────────────────────────────────────────
function AlertsPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [sev, setSev] = useState<string>("all");
  const [scope, setScope] = useState<"open" | "all">("open");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let q = supabase.from("system_alerts")
        .select("id,severity,subsystem,title,message,delivered_at,resolved_at,acked_at,correlation_id,created_at,dedupe_key")
        .order("created_at", { ascending: false }).limit(200);
      if (scope === "open") q = q.is("resolved_at", null);
      if (sev !== "all") q = q.eq("severity", sev);
      const { data } = await q;
      if (!cancelled) setRows(data ?? []);
    }
    load();
    const ch = supabase.channel("noc_alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "system_alerts" }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [sev, scope]);

  const stats = useMemo(() => ({
    open: rows.filter(r => !r.resolved_at).length,
    critical: rows.filter(r => r.severity === "critical" && !r.resolved_at).length,
    warning: rows.filter(r => r.severity === "warning" && !r.resolved_at).length,
    delivered: rows.filter(r => r.delivered_at).length,
    acked: rows.filter(r => r.acked_at).length,
  }), [rows]);

  async function ack(id: string) {
    await supabase.from("system_alerts").update({ acked_at: new Date().toISOString() }).eq("id", id);
  }
  async function resolve(id: string) {
    await supabase.from("system_alerts").update({ resolved_at: new Date().toISOString(), resolution: "Manual via NOC" }).eq("id", id);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Kpi label="Abertos"     value={stats.open}     tone="default" />
        <Kpi label="Críticos"    value={stats.critical} tone="critical" />
        <Kpi label="Warnings"    value={stats.warning}  tone="warning" />
        <Kpi label="Entregues"   value={stats.delivered} tone="ok" />
        <Kpi label="Reconhecidos" value={stats.acked}    tone="ok" />
      </div>
      <div className="flex gap-2 flex-wrap">
        <Select value={sev} onChange={setSev} options={[
          { v: "all", l: "Todas severidades" }, { v: "critical", l: "Crítico" }, { v: "warning", l: "Warning" }, { v: "info", l: "Info" },
        ]} />
        <Select value={scope} onChange={(v) => setScope(v as any)} options={[
          { v: "open", l: "Apenas abertos" }, { v: "all", l: "Todos" },
        ]} />
      </div>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/30">
            <tr className="text-left">
              <th className="p-2">Quando</th><th className="p-2">Severidade</th><th className="p-2">Serviço</th>
              <th className="p-2">Título</th><th className="p-2">Status</th><th className="p-2 w-32">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(a => (
              <tr key={a.id} className="border-t border-border/50">
                <td className="p-2 text-muted-foreground whitespace-nowrap">{timeAgo(a.created_at)}</td>
                <td className="p-2"><StatusBadge value={a.severity} /></td>
                <td className="p-2 font-mono text-[11px]">{a.subsystem}</td>
                <td className="p-2"><div className="font-medium">{a.title}</div><div className="text-muted-foreground text-[11px]">{a.message}</div></td>
                <td className="p-2 text-[11px]">
                  {a.resolved_at ? <span className="text-emerald-500">resolvido</span>
                    : a.acked_at ? <span className="text-blue-500">ack</span>
                    : a.delivered_at ? <span className="text-amber-500">entregue</span>
                    : <span className="text-muted-foreground">pendente</span>}
                </td>
                <td className="p-2">
                  {!a.resolved_at && (
                    <div className="flex gap-1">
                      {!a.acked_at && <button onClick={() => ack(a.id)} className="text-[11px] underline">ack</button>}
                      <button onClick={() => resolve(a.id)} className="text-[11px] underline text-emerald-500">resolver</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Nenhum alerta no filtro atual.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Health: último estado de cada subsystem
// ──────────────────────────────────────────────────────────────────────────
function HealthPanel() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("health_probes")
        .select("subsystem,probe_name,status,latency_ms,last_success_at,last_error_at,last_error_msg,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (cancelled) return;
      // dedupe by subsystem keeping latest
      const seen = new Set<string>();
      const latest: any[] = [];
      for (const r of data ?? []) {
        if (!seen.has(r.subsystem)) { seen.add(r.subsystem); latest.push(r); }
      }
      setRows(latest);
    }
    load();
    const ch = supabase.channel("noc_health")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "health_probes" }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, []);

  const KNOWN = ["bot","gateway","parser","match","writer","delivery","ocr","browser","smtp","spotify","db","cron"];
  const byName = new Map(rows.map(r => [r.subsystem, r]));
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {KNOWN.map(name => {
        const r = byName.get(name);
        const status = r?.status ?? "unknown";
        const tone = status === "ok" ? "text-emerald-500" : status === "degraded" ? "text-amber-500" : status === "down" ? "text-red-500" : "text-muted-foreground";
        const Icon = status === "ok" ? CheckCircle2 : status === "unknown" ? Clock : status === "degraded" ? AlertTriangle : XCircle;
        return (
          <div key={name} className="border border-border rounded-lg p-3 bg-card">
            <div className="flex items-center justify-between">
              <div className="font-mono text-sm font-semibold">{name}</div>
              <Icon className={cn("h-4 w-4", tone)} />
            </div>
            <div className="mt-2 text-xs space-y-0.5 text-muted-foreground">
              <div>Status: <span className={tone}>{status}</span></div>
              <div>Latência: {r?.latency_ms != null ? `${r.latency_ms}ms` : "—"}</div>
              <div>Último OK: {r?.last_success_at ? timeAgo(r.last_success_at) : "—"}</div>
              <div>Último erro: {r?.last_error_at ? timeAgo(r.last_error_at) : "—"}</div>
              {r?.last_error_msg && <div className="text-red-400 truncate" title={r.last_error_msg}>{r.last_error_msg}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Performance: agrega bot_events por step (últimas 6h)
// ──────────────────────────────────────────────────────────────────────────
function PercentileRow({ label, vals }: { label: string; vals: number[] }) {
  const stat = useMemo(() => {
    if (vals.length === 0) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const avg = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
    return { p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), avg, n: vals.length };
  }, [vals]);
  if (!stat) return <tr><td className="p-2 font-mono">{label}</td><td colSpan={5} className="p-2 text-muted-foreground">sem dados</td></tr>;
  return (
    <tr className="border-t border-border/50">
      <td className="p-2 font-mono">{label}</td>
      <td className="p-2">{stat.n}</td>
      <td className="p-2">{stat.avg}ms</td>
      <td className="p-2">{stat.p50}ms</td>
      <td className="p-2">{stat.p95}ms</td>
      <td className="p-2">{stat.p99}ms</td>
    </tr>
  );
}

function PerformancePanel() {
  const [data, setData] = useState<Map<string, number[]> | null>(null);
  const [errors, setErrors] = useState<{ step: string; count: number }[]>([]);
  useEffect(() => {
    async function load() {
      const since = new Date(Date.now() - 6 * 3600_000).toISOString();
      const { data: rows } = await supabase
        .from("bot_events").select("step,duration_ms,status")
        .gte("created_at", since).not("duration_ms", "is", null).limit(5000);
      const m = new Map<string, number[]>();
      const eMap = new Map<string, number>();
      for (const r of rows ?? []) {
        if (typeof r.duration_ms === "number") {
          if (!m.has(r.step)) m.set(r.step, []);
          m.get(r.step)!.push(r.duration_ms);
        }
        if (r.status === "error") eMap.set(r.step, (eMap.get(r.step) ?? 0) + 1);
      }
      setData(m);
      setErrors(Array.from(eMap.entries()).map(([step, count]) => ({ step, count })).sort((a, b) => b.count - a.count));
    }
    load();
  }, []);

  if (!data) return <div className="text-sm text-muted-foreground p-4">Carregando…</div>;
  const steps = Array.from(data.keys()).sort();
  return (
    <div className="space-y-4">
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/30">
            <tr className="text-left">
              <th className="p-2">Step</th><th className="p-2">N</th><th className="p-2">Média</th>
              <th className="p-2">p50</th><th className="p-2">p95</th><th className="p-2">p99</th>
            </tr>
          </thead>
          <tbody>
            {steps.map(s => <PercentileRow key={s} label={s} vals={data.get(s) ?? []} />)}
            {steps.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Sem amostras nas últimas 6h.</td></tr>}
          </tbody>
        </table>
      </div>
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">Erros por step (6h)</div>
        <div className="flex flex-wrap gap-2">
          {errors.length === 0 ? <span className="text-xs text-muted-foreground">Nenhum erro registrado.</span>
            : errors.map(e => (
              <span key={e.step} className="text-[11px] px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                {e.step} · {e.count}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Segurança: OTP / tokens / 403
// ──────────────────────────────────────────────────────────────────────────
function SecurityPanel() {
  const [d, setD] = useState<any | null>(null);
  useEffect(() => {
    async function load() {
      const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
      const [otpCamp, otpCur, accCamp, accCur, audit, tokens] = await Promise.all([
        supabase.from("campaign_access_otps").select("id,blocked_at,failed_attempts,used_at,created_at").gte("created_at", since24h),
        supabase.from("curator_access_otps").select("id,blocked_at,failed_attempts,used_at,created_at").gte("created_at", since24h),
        supabase.from("campaign_access_logs").select("id,created_at").gte("created_at", since24h),
        supabase.from("curator_access_logs").select("id,created_at").gte("created_at", since24h),
        supabase.from("public_token_audit").select("action,created_at").gte("created_at", since24h),
        supabase.from("system_alerts").select("id").eq("subsystem", "security").gte("created_at", since24h),
      ]);
      const otpRows = [...(otpCamp.data ?? []), ...(otpCur.data ?? [])];
      const accRows = [...(accCamp.data ?? []), ...(accCur.data ?? [])];
      setD({
        otp_issued: otpRows.length,
        otp_used: otpRows.filter((r: any) => r.used_at).length,
        otp_blocked: otpRows.filter((r: any) => r.blocked_at).length,
        otp_failed_attempts: otpRows.reduce((s: number, r: any) => s + (r.failed_attempts ?? 0), 0),
        access_attempts: accRows.length,
        access_403: otpRows.filter((r: any) => r.blocked_at).length, // proxy: bloqueados = negados
        tokens_rotated: (audit.data ?? []).filter((r: any) => r.action === "rotate").length,
        tokens_revoked: (audit.data ?? []).filter((r: any) => r.action === "revoke").length,
        security_alerts: tokens.data?.length ?? 0,
      });
    }
    load();
  }, []);
  if (!d) return <div className="text-sm text-muted-foreground p-4">Carregando…</div>;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <Kpi label="OTP emitidos (24h)" value={d.otp_issued} tone="default" />
      <Kpi label="OTP usados"          value={d.otp_used}   tone="ok" />
      <Kpi label="OTP bloqueados"      value={d.otp_blocked} tone="critical" />
      <Kpi label="Tentativas inválidas" value={d.otp_failed_attempts} tone="warning" />
      <Kpi label="Acessos ao portal"   value={d.access_attempts} tone="default" />
      <Kpi label="403 / negados"       value={d.access_403} tone="warning" />
      <Kpi label="Tokens rotacionados" value={d.tokens_rotated} tone="default" />
      <Kpi label="Tokens revogados"    value={d.tokens_revoked} tone="critical" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// RUM: client_error_log
// ──────────────────────────────────────────────────────────────────────────
function RumPanel() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    async function load() {
      const { data } = await supabase.from("client_error_log")
        .select("id,message,url,user_agent,correlation_id,created_at,stack")
        .order("created_at", { ascending: false }).limit(100);
      setRows(data ?? []);
    }
    load();
  }, []);
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">Últimos 100 erros do navegador (capturados via window.onerror / unhandledrejection).</div>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/30">
            <tr className="text-left">
              <th className="p-2">Quando</th><th className="p-2">Mensagem</th><th className="p-2">Página</th><th className="p-2">Correlation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-border/50">
                <td className="p-2 text-muted-foreground whitespace-nowrap">{timeAgo(r.created_at)}</td>
                <td className="p-2 max-w-[420px] truncate" title={r.stack ?? r.message}>{r.message}</td>
                <td className="p-2 max-w-[260px] truncate text-muted-foreground">{r.url ?? "—"}</td>
                <td className="p-2 font-mono text-[10px]">{r.correlation_id ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">Sem erros registrados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Busca Global
// ──────────────────────────────────────────────────────────────────────────
function SearchPanel() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!q.trim()) return;
    setBusy(true);
    const term = q.trim();
    const out: any[] = [];
    const push = (kind: string, route: string | null, label: string, sub?: string) => out.push({ kind, route, label, sub });

    // correlation_id
    if (term.startsWith("crrl_")) push("correlation_id", null, term, "Abra na aba Correlation");

    const [camps, deals, curs, workers, tokens, players] = await Promise.all([
      supabase.from("campaigns").select("id,nome,cliente_id").or(`id.eq.${safeUuid(term)},nome.ilike.%${term}%`).limit(5),
      supabase.from("curator_deals").select("id,curator_id").eq("id", safeUuid(term)).limit(5),
      supabase.from("curators").select("id,nome").or(`id.eq.${safeUuid(term)},nome.ilike.%${term}%`).limit(5),
      supabase.from("bot_heartbeats").select("worker_id,bot_name,hostname").or(`worker_id.eq.${term},bot_name.ilike.%${term}%`).limit(5),
      supabase.from("public_token_audit").select("id,action,created_at,token_hash").ilike("token_hash", `%${term}%`).limit(5),
      supabase.from("managed_playlists").select("id,nome").or(`id.eq.${safeUuid(term)},nome.ilike.%${term}%`).limit(5),
    ]);
    (camps.data ?? []).forEach(c => push("campaign", `/campanhas/${c.id}`, c.nome ?? c.id, c.id));
    (deals.data ?? []).forEach(d => push("deal", `/deals/${d.id}`, d.id, "curator_deal"));
    (curs.data ?? []).forEach(c => push("curator", `/curadores/${c.id}`, c.nome ?? c.id, c.id));
    (workers.data ?? []).forEach(w => push("worker", null, `${w.bot_name} @ ${w.hostname}`, w.worker_id));
    (tokens.data ?? []).forEach(t => push("token_audit", null, `${t.action} · ${t.token_hash.slice(0, 12)}…`, t.created_at));
    (players.data ?? []).forEach(p => push("playlist", `/playlist/${p.id}`, p.nome ?? p.id, p.id));
    setRes(out);
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && run()}
          placeholder="UUID, correlation_id, worker_id, nome de campanha/curador/playlist…"
          className="flex-1 h-9 px-3 rounded-md bg-card border border-border text-sm" />
        <button onClick={run} className="px-4 h-9 rounded-md bg-primary text-primary-foreground text-sm">{busy ? "..." : "Buscar"}</button>
      </div>
      <div className="space-y-1">
        {res.map((r, i) => (
          <div key={i} className="flex items-center justify-between p-2 border border-border rounded-md bg-card text-sm">
            <div><span className="text-[10px] uppercase font-bold text-muted-foreground mr-2">{r.kind}</span>{r.label} <span className="text-muted-foreground text-xs">{r.sub ?? ""}</span></div>
            {r.route && <a href={r.route} className="text-xs underline">abrir</a>}
          </div>
        ))}
        {res.length === 0 && q && !busy && <div className="text-xs text-muted-foreground text-center p-4">Nenhum resultado.</div>}
      </div>
    </div>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function safeUuid(v: string) { return UUID_RE.test(v) ? v : "00000000-0000-0000-0000-000000000000"; }

// ──────────────────────────────────────────────────────────────────────────
// Utilitários
// ──────────────────────────────────────────────────────────────────────────
function Kpi({ label, value, tone }: { label: string; value: number; tone: "default" | "ok" | "warning" | "critical" }) {
  const c = tone === "critical" ? "text-red-500" : tone === "warning" ? "text-amber-500" : tone === "ok" ? "text-emerald-500" : "text-foreground";
  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-bold mt-1", c)}>{value}</div>
    </div>
  );
}
function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="h-8 px-2 rounded-md bg-card border border-border text-xs">
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}
function StatusBadge({ value }: { value?: string }) {
  if (!value) return <span className="text-muted-foreground text-[11px]">—</span>;
  const tone = value === "critical" || value === "error" || value === "down" ? "bg-red-500/10 text-red-400 border-red-500/20"
    : value === "warning" || value === "degraded" ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
    : value === "ok" || value === "success" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
    : "bg-muted/30 text-muted-foreground border-border";
  return <span className={cn("text-[10px] px-2 py-0.5 rounded border", tone)}>{value}</span>;
}
