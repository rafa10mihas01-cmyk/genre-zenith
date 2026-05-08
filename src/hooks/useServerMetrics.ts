// useServerMetrics — último heartbeat com métricas reais do agente VPS.
// Atualiza a cada 10s via polling + assina realtime se possível.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ServerMetrics = {
  id: string;
  bot_name: string;
  hostname: string | null;
  status: string;
  created_at: string;
  cpu_percent: number | null;
  mem_percent: number | null;
  mem_used_mb: number | null;
  mem_total_mb: number | null;
  swap_percent: number | null;
  disk_percent: number | null;
  disk_used_gb: number | null;
  disk_total_gb: number | null;
  uptime_seconds: number | null;
  load_avg: any;
  pm2_processes: any;
  chrome_instances: number | null;
  agent_version: string | null;
  message: string | null;
};

export function useServerMetrics(intervalMs = 10_000) {
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("bot_heartbeats")
        .select("*")
        .not("cpu_percent", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!mounted) return;
      setMetrics(data as ServerMetrics | null);
      setLoading(false);
      if (data) {
        const ageMs = Date.now() - new Date(data.created_at).getTime();
        setStale(ageMs > 90_000);
      } else {
        setStale(true);
      }
    };
    void load();
    const t = setInterval(load, intervalMs);
    return () => { mounted = false; clearInterval(t); };
  }, [intervalMs]);

  return { metrics, loading, stale };
}
