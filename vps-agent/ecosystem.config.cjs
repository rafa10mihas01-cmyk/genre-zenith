// ecosystem PM2 — runtime operacional REAL (agent + N workers + scheduler + healthcheck)
//
// Uso:
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup
//
// Nota: package.json é "type":"module", PM2 exige config CJS,
// por isso a extensão .cjs (PM2 aceita normalmente esse nome).

const path = require("path");

const WORKER_COUNT = Number(process.env.WORKER_COUNT || 2);
const ENABLE_SCHEDULER   = String(process.env.ENABLE_SCHEDULER   ?? "true").toLowerCase() !== "false";
const ENABLE_HEALTHCHECK = String(process.env.ENABLE_HEALTHCHECK ?? "true").toLowerCase() !== "false";

const workers = Array.from({ length: WORKER_COUNT }, (_, i) => ({
  name: `nexengine-worker-${i}`,
  script: "src/worker.js",
  cwd: __dirname,
  instances: 1,
  exec_mode: "fork",
  max_memory_restart: "900M",
  autorestart: true,
  watch: false,
  restart_delay: 4000,
  max_restarts: 50,
  min_uptime: "30s",
  kill_timeout: 10000,
  env: {
    NODE_ENV: "production",
    WORKER_INDEX: String(i),
    WORKER_KIND: process.env.WORKER_KIND || "spotify-artists-worker",
  },
  time: true,
  out_file:   `./logs/worker-${i}.out.log`,
  error_file: `./logs/worker-${i}.err.log`,
  merge_logs: true,
}));

const apps = [
  {
    name: "nexengine-ops-agent",
    script: "src/index.js",
    cwd: __dirname,
    instances: 1,
    exec_mode: "fork",
    max_memory_restart: "350M",
    autorestart: true,
    watch: false,
    restart_delay: 4000,
    max_restarts: 50,
    min_uptime: "30s",
    kill_timeout: 8000,
    env: { NODE_ENV: "production" },
    time: true,
    out_file:   "./logs/agent.out.log",
    error_file: "./logs/agent.err.log",
    merge_logs: true,
  },
  ...workers,
];

if (ENABLE_SCHEDULER) {
  apps.push({
    name: "nexengine-scheduler",
    script: "src/scheduler.js",
    cwd: __dirname,
    instances: 1,
    exec_mode: "fork",
    max_memory_restart: "200M",
    autorestart: true,
    watch: false,
    restart_delay: 5000,
    max_restarts: 30,
    min_uptime: "30s",
    env: { NODE_ENV: "production" },
    time: true,
    out_file:   "./logs/scheduler.out.log",
    error_file: "./logs/scheduler.err.log",
    merge_logs: true,
  });
}

if (ENABLE_HEALTHCHECK) {
  apps.push({
    name: "nexengine-healthcheck",
    script: "src/healthcheck.js",
    cwd: __dirname,
    instances: 1,
    exec_mode: "fork",
    max_memory_restart: "150M",
    autorestart: true,
    watch: false,
    restart_delay: 3000,
    max_restarts: 30,
    min_uptime: "30s",
    env: { NODE_ENV: "production", HEALTHCHECK_PORT: process.env.HEALTHCHECK_PORT || "8787" },
    time: true,
    out_file:   "./logs/healthcheck.out.log",
    error_file: "./logs/healthcheck.err.log",
    merge_logs: true,
  });
}

module.exports = { apps };
