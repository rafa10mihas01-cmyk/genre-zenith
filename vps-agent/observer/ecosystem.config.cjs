// PM2 ecosystem for Observer (Phase 17-E).
// Caps RSS at 600MB as a safety net; LRU cache should keep steady-state at 250-500MB.
module.exports = {
  apps: [
    {
      name: 'observer',
      script: 'server.js',
      cwd: '/root/genre-zenith/vps-agent/observer',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '600M',
      kill_timeout: 5000,
      node_args: '--max-old-space-size=512',
      env: {
        NODE_ENV: 'production',
        PORT: '3100',
        HOST: '0.0.0.0',
        OBSERVER_CACHE_MAX: '200',
        OBSERVER_CACHE_SWEEP_MS: '300000',
        OBSERVER_CACHE_SWEEP_TTL_MS: '1800000',
      },
      out_file: '/root/.pm2/logs/observer-out.log',
      error_file: '/root/.pm2/logs/observer-err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
