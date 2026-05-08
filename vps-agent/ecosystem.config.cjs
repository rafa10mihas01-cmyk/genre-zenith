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
      env: {
        NODE_ENV: "production",
      },
      time: true,
      out_file: "./logs/agent.out.log",
      error_file: "./logs/agent.err.log",
      merge_logs: true,
    },
  ],
};
