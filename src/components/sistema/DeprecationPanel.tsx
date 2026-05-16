// DeprecationPanel — painel de observabilidade da Fase 1.
// Lê deprecation_hits + deprecation_blocked_jobs (admin-only via RLS).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type HitRow = { function_name: string; source: string; n: number; last: string };
type BlockedRow = { job_type: string; n: number; last: string };

export function DeprecationPanel() {
  const [loading, setLoading] = useState(true);
  const [hits24h, setHits24h] = useState<HitRow[]>([]);
  const [hits7d, setHits7d] = useState<HitRow[]>([]);
  const [blocked, setBlocked] = useState<BlockedRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

      const [h24, h7, bl] = await Promise.all([
        supabase
          .from("deprecation_hits")
          .select("function_name, source, called_at")
          .gte("called_at", since24)
          .order("called_at", { ascending: false })
          .limit(2000),
        supabase
          .from("deprecation_hits")
          .select("function_name, source, called_at")
          .gte("called_at", since7d)
          .order("called_at", { ascending: false })
          .limit(5000),
        supabase
          .from("deprecation_blocked_jobs")
          .select("job_type, blocked_at")
          .order("blocked_at", { ascending: false })
          .limit(1000),
      ]);
      if (cancelled) return;

      const agg = (rows: { function_name: string; source: string; called_at: string }[] | null) => {
        const map = new Map<string, HitRow>();
        for (const r of rows ?? []) {
          const k = `${r.function_name}|${r.source}`;
          const cur = map.get(k);
          if (cur) {
            cur.n += 1;
            if (r.called_at > cur.last) cur.last = r.called_at;
          } else {
            map.set(k, { function_name: r.function_name, source: r.source, n: 1, last: r.called_at });
          }
        }
        return Array.from(map.values()).sort((a, b) => b.n - a.n);
      };
      setHits24h(agg(h24.data));
      setHits7d(agg(h7.data));

      const bm = new Map<string, BlockedRow>();
      for (const r of bl.data ?? []) {
        const cur = bm.get(r.job_type);
        if (cur) {
          cur.n += 1;
          if (r.blocked_at > cur.last) cur.last = r.blocked_at;
        } else {
          bm.set(r.job_type, { job_type: r.job_type, n: 1, last: r.blocked_at });
        }
      }
      setBlocked(Array.from(bm.values()).sort((a, b) => b.n - a.n));
      setLoading(false);
    };
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando telemetria…
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-4">
      <Card title="Resumo (24h)" rows={hits24h} emptyText="Nenhuma chamada residual nas últimas 24h." />
      <Card title="Resumo (7d)" rows={hits7d} emptyText="Nenhuma chamada residual nos últimos 7 dias." />

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="text-sm font-medium text-foreground mb-3">Jobs bloqueados na fila</div>
        {blocked.length === 0 ? (
          <div className="text-xs text-muted-foreground">Nenhum job bloqueado registrado.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr><th className="text-left py-1">Tipo</th><th className="text-right py-1">N</th><th className="text-right py-1">Último</th></tr>
            </thead>
            <tbody>
              {blocked.map((r) => (
                <tr key={r.job_type} className="border-t border-border">
                  <td className="py-1.5 font-mono">{r.job_type}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.n}</td>
                  <td className="py-1.5 text-right text-muted-foreground">{new Date(r.last).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Card({ title, rows, emptyText }: { title: string; rows: HitRow[]; emptyText: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="text-sm font-medium text-foreground mb-3">{title}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">{emptyText}</div>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left py-1">Função</th>
              <th className="text-left py-1">Origem</th>
              <th className="text-right py-1">N</th>
              <th className="text-right py-1">Último</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="py-1.5 font-mono">{r.function_name}</td>
                <td className={cn(
                  "py-1.5",
                  r.source === "cron" && "text-destructive",
                  r.source === "internal" && "text-yellow-500",
                  r.source === "ui" && "text-muted-foreground",
                )}>{r.source}</td>
                <td className="py-1.5 text-right tabular-nums">{r.n}</td>
                <td className="py-1.5 text-right text-muted-foreground">{new Date(r.last).toLocaleString("pt-BR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
