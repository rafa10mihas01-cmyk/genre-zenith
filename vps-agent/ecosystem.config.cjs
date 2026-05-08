const path = require("path");

const WORKER_COUNT = Number(process.env.WORKER_COUNT || 2);
const workers = Array.from({ length: WORKER_COUNT }, (_, i) => ({
  name: `nexengine-worker-${i}`,
  script: "src/worker.js",
  cwd: __dirname,
  instances: 1,
  exec_mode: "fork",
  max_memory_restart: "500M",
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
  out_file: `./logs/worker-${i}.out.log`,
  error_file: `./logs/worker-${i}.err.log`,
  merge_logs: true,
}));

module.exports = {
  apps: [
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
      out_file: "./logs/agent.out.log",
      error_file: "./logs/agent.err.log",
      merge_logs: true,
    },
    ...workers,
  ],
};
