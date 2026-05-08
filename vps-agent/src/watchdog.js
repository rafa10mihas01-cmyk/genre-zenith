import { config } from "./config.js";
import { pm2List } from "./metrics.js";
import { pm2 } from "./executor.js";
import { reportIncident } from "./api.js";
import { makeLogger } from "./logger.js";

const log = makeLogger("watchdog");

class Watchdog {
  constructor() {
    this.restarts = []; // timestamps ms
    this.paused = false;
    this.lastCheckAt = 0;
    this.lastIncidentAt = 0;
  }

  markManualRestart(name) {
    log.info("restart manual registrado", { name });
    this.restarts.push(Date.now());
    this._trim();
  }

  _trim() {
    const cutoff = Date.now() - 60 * 60 * 1000;
    this.restarts = this.restarts.filter((t) => t >= cutoff);
  }

  _restartsLastHour() { this._trim(); return this.restarts.length; }

  async _emitIncident(kind, severity, payload) {
    // anti-flood: 1 incidente do mesmo tipo a cada 5min
    if (Date.now() - this.lastIncidentAt < 5 * 60 * 1000) return;
    this.lastIncidentAt = Date.now();
    try {
      await reportIncident({
        kind, severity,
        agent_id: config.AGENT_ID,
        bot_name: config.BOT_NAME,
        target: config.SPOTIFY_BOT_PM2_NAME,
        at: new Date().toISOString(),
        ...payload,
      });
      log.warn(`incidente reportado: ${kind}`, { severity, ...payload });
    } catch (e) {
      log.error("falha ao reportar incidente", { error: String(e?.message || e) });
    }
  }

  async tick() {
    this.lastCheckAt = Date.now();
    if (this.paused) {
      log.debug("watchdog pausado (limite de restarts atingido)");
      return;
    }
    const procs = await pm2List();
    const target = procs.find((p) => p.name === config.SPOTIFY_BOT_PM2_NAME);

    if (!target) {
      await this._emitIncident("bot_missing", "high", { message: `Processo PM2 ${config.SPOTIFY_BOT_PM2_NAME} não encontrado` });
      return;
    }

    if (target.status !== "online") {
      await this._emitIncident("bot_offline", "high", { status: target.status, restarts: target.restarts });
      await this._tryRestart("status != online");
      return;
    }

    // Stale: uptime longo + sem progresso é difícil aferir aqui sem chamar Cloud,
    // então usamos o sinal de "pm2 marcando excesso de restarts" + memória estourada.
    const memMb = Math.round((target.memory || 0) / 1024 / 1024);
    if (memMb > 1500) {
      await this._emitIncident("bot_memory_high", "medium", { memMb });
      await this._tryRestart(`memória alta (${memMb}MB)`);
      return;
    }

    if ((target.restarts || 0) > 30 && (target.uptime_ms || 0) < 60_000) {
      await this._emitIncident("bot_crashloop", "critical", { restarts: target.restarts, uptime_ms: target.uptime_ms });
      this.paused = true;
      log.error("watchdog pausado: bot em crashloop");
    }
  }

  async _tryRestart(reason) {
    if (this._restartsLastHour() >= config.WATCHDOG_MAX_RESTARTS_PER_HOUR) {
      this.paused = true;
      await this._emitIncident("watchdog_paused", "critical", {
        message: `Limite de ${config.WATCHDOG_MAX_RESTARTS_PER_HOUR} restarts/hora atingido`,
      });
      log.error("watchdog pausado: limite de restarts/hora");
      return;
    }
    log.warn(`auto-restart: ${reason}`);
    this.restarts.push(Date.now());
    this._trim();
    const r = await pm2.restart(config.SPOTIFY_BOT_PM2_NAME);
    if (!r.ok) {
      await this._emitIncident("auto_restart_failed", "high", { reason, stderr: r.stderr?.slice(0, 400) });
    }
  }
}

export const watchdog = new Watchdog();
