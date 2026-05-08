import si from "systeminformation";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { config } from "./config.js";
import { makeLogger } from "./logger.js";

const log = makeLogger("metrics");
const pexec = promisify(execFile);

async function pm2List() {
  try {
    const { stdout } = await pexec("pm2", ["jlist"], { timeout: 8000, maxBuffer: 4 * 1024 * 1024 });
    const arr = JSON.parse(stdout || "[]");
    return arr.map((p) => ({
      name: p.name,
      pm_id: p.pm_id,
      status: p?.pm2_env?.status ?? "unknown",
      cpu: p?.monit?.cpu ?? 0,
      memory: p?.monit?.memory ?? 0,
      restarts: p?.pm2_env?.restart_time ?? 0,
      uptime_ms: p?.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0,
      pid: p.pid ?? null,
    }));
  } catch (e) {
    log.debug("pm2 jlist falhou", { error: String(e?.message || e) });
    return [];
  }
}

async function dockerPs() {
  if (!config.DOCKER_ENABLED) return [];
  try {
    const { stdout } = await pexec(
      "docker",
      ["ps", "--format", "{{json .}}"],
      { timeout: 8000, maxBuffer: 2 * 1024 * 1024 }
    );
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean)
      .map((c) => ({
        id: c.ID, name: c.Names, image: c.Image, status: c.Status, state: c.State, ports: c.Ports,
      }));
  } catch (e) {
    log.debug("docker ps falhou", { error: String(e?.message || e) });
    return [];
  }
}

async function chromeCount() {
  try {
    const { stdout } = await pexec("pgrep", ["-c", "-f", "chrome|chromium"], { timeout: 3000 });
    return Number(String(stdout).trim()) || 0;
  } catch { return 0; }
}

export async function collectMetrics() {
  const [cpu, mem, disk, load, pm2, docker, chrome] = await Promise.all([
    si.currentLoad().catch(() => ({ currentLoad: 0 })),
    si.mem().catch(() => null),
    si.fsSize().catch(() => []),
    Promise.resolve(os.loadavg()),
    pm2List(),
    dockerPs(),
    chromeCount(),
  ]);

  const rootDisk = (disk || []).find((d) => d.mount === "/") || (disk || [])[0] || null;
  const memTotalMb = mem ? Math.round(mem.total / 1024 / 1024) : null;
  const memUsedMb = mem ? Math.round((mem.total - mem.available) / 1024 / 1024) : null;
  const memPct = mem && mem.total ? +(((mem.total - mem.available) / mem.total) * 100).toFixed(1) : null;
  const swapPct = mem && mem.swaptotal ? +((mem.swapused / mem.swaptotal) * 100).toFixed(1) : 0;

  return {
    cpu_percent: +Number(cpu.currentLoad ?? 0).toFixed(1),
    mem_percent: memPct,
    mem_used_mb: memUsedMb,
    mem_total_mb: memTotalMb,
    swap_percent: swapPct,
    disk_percent: rootDisk ? +Number(rootDisk.use ?? 0).toFixed(1) : null,
    disk_used_gb: rootDisk ? +(rootDisk.used / 1024 / 1024 / 1024).toFixed(1) : null,
    disk_total_gb: rootDisk ? +(rootDisk.size / 1024 / 1024 / 1024).toFixed(1) : null,
    uptime_seconds: Math.round(os.uptime()),
    load_avg: load,
    pm2_processes: pm2,
    docker_containers: docker,
    chrome_instances: chrome,
    hostname: os.hostname(),
  };
}

export { pm2List, dockerPs };
