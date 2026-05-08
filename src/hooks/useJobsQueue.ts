// useJobsQueue — fila de jobs em tempo real + estatísticas.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type JobStatus = "pending" | "processing" | "completed" | "failed" | "cancelled" | "retry";

export type Job = {
  id: string;
  job_type: string;
  status: JobStatus;
  priority: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  scheduled_for: string;
  reserved_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  worker_id: string | null;
  correlation_id: string | null;
  dedupe_key: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
};

export type Worker = {
  id: string;
  worker_id: string;
  worker_kind: string;
  hostname: string | null;
  pid: string | null;
  status: "idle" | "busy" | "draining" | "offline" | "error";
  current_job_id: string | null;
  current_job_type: string | null;
  jobs_completed: number;
  jobs_failed: number;
  cpu_percent: number | null;
  mem_percent: number | null;
  uptime_seconds: number | null;
  agent_version: string | null;
  last_seen_at: string;
  updated_at: string;
};

export function useJobsQueue(opts: { limit?: number } = {}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const limit = opts.limit ?? 200;

  const reload = async () => {
    const [{ data: j }, { data: w }] = await Promise.all([
      supabase
        .from("jobs_queue")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("worker_heartbeats")
        .select("*")
        .order("last_seen_at", { ascending: false }),
    ]);
    setJobs((j as unknown as Job[]) ?? []);
    setWorkers((w as unknown as Worker[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    const ch = supabase
      .channel("jobs-queue-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs_queue" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_heartbeats" }, () => reload())
      .subscribe();
    const t = window.setInterval(reload, 15000);
    return () => {
      supabase.removeChannel(ch);
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  const stats = useMemo(() => {
    const by: Record<JobStatus, number> = {
      pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0, retry: 0,
    };
    let totalDur = 0, durCount = 0;
    for (const j of jobs) {
      by[j.status] = (by[j.status] ?? 0) + 1;
      if (j.duration_ms) { totalDur += j.duration_ms; durCount++; }
    }
    const avgMs = durCount ? Math.round(totalDur / durCount) : 0;

    const failuresByType = new Map<string, number>();
    for (const j of jobs) {
      if (j.status === "failed") failuresByType.set(j.job_type, (failuresByType.get(j.job_type) ?? 0) + 1);
    }

    return { by, avgMs, totalJobs: jobs.length, failuresByType };
  }, [jobs]);

  return { jobs, workers, loading, reload, stats };
}
