const crypto = require("crypto");
const net = require("net");
const tls = require("tls");

function normalizeBool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePort(value, fallback = 6379) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRedisUrl(rawUrl = "") {
  const value = String(rawUrl || "").trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      host: url.hostname,
      port: parsePort(url.port, url.protocol === "rediss:" ? 6380 : 6379),
      username: decodeURIComponent(url.username || ""),
      password: decodeURIComponent(url.password || ""),
      db: url.pathname && url.pathname !== "/" ? Number.parseInt(url.pathname.slice(1), 10) : undefined,
      tls: url.protocol === "rediss:"
    };
  } catch {
    return {};
  }
}

function stableJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function hashKey(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function encodeCommand(args = []) {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) {
    const value = Buffer.from(String(arg ?? ""));
    parts.push(`$${value.length}\r\n`);
    parts.push(value);
    parts.push("\r\n");
  }
  return Buffer.concat(parts.map(part => Buffer.isBuffer(part) ? part : Buffer.from(part)));
}

function findLineEnd(buffer, offset) {
  for (let index = offset; index < buffer.length - 1; index += 1) {
    if (buffer[index] === 13 && buffer[index + 1] === 10) return index;
  }
  return -1;
}

function parseResp(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const type = String.fromCharCode(buffer[offset]);
  const lineEnd = findLineEnd(buffer, offset + 1);
  if (lineEnd === -1) return null;
  const line = buffer.slice(offset + 1, lineEnd).toString();
  const bodyOffset = lineEnd + 2;

  if (type === "+") return { value: line, offset: bodyOffset };
  if (type === "-") {
    const err = new Error(line);
    err.redis = true;
    return { error: err, offset: bodyOffset };
  }
  if (type === ":") return { value: Number.parseInt(line, 10), offset: bodyOffset };
  if (type === "$") {
    const length = Number.parseInt(line, 10);
    if (length === -1) return { value: null, offset: bodyOffset };
    const end = bodyOffset + length;
    if (buffer.length < end + 2) return null;
    return {
      value: buffer.slice(bodyOffset, end).toString(),
      offset: end + 2
    };
  }
  if (type === "*") {
    const count = Number.parseInt(line, 10);
    if (count === -1) return { value: null, offset: bodyOffset };
    const items = [];
    let currentOffset = bodyOffset;
    for (let index = 0; index < count; index += 1) {
      const parsed = parseResp(buffer, currentOffset);
      if (!parsed) return null;
      if (parsed.error) return parsed;
      items.push(parsed.value);
      currentOffset = parsed.offset;
    }
    return { value: items, offset: currentOffset };
  }

  const err = new Error(`Unsupported Redis response type: ${type}`);
  err.redis = true;
  return { error: err, offset: buffer.length };
}

class SimpleRedisClient {
  constructor(options = {}) {
    this.options = options;
    this.socket = null;
    this.connected = false;
    this.connecting = null;
    this.queue = [];
    this.buffer = Buffer.alloc(0);
    this.lastErrorLog = 0;
  }

  async ensureConnected() {
    if (this.connected && this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;

    this.connecting = new Promise((resolve, reject) => {
      const socketOptions = {
        host: this.options.host || "127.0.0.1",
        port: parsePort(this.options.port, this.options.tls ? 6380 : 6379),
        timeout: parsePort(this.options.timeoutMs, 2000)
      };
      const socket = this.options.tls ? tls.connect(socketOptions) : net.createConnection(socketOptions);
      let settled = false;

      const fail = error => {
        if (settled) return;
        settled = true;
        this.rejectAll(error);
        this.connected = false;
        this.socket = null;
        socket.destroy();
        reject(error);
      };

      socket.setNoDelay(true);
      socket.once("error", fail);
      socket.once("timeout", () => fail(new Error("Redis connection timed out.")));
      socket.on("data", chunk => this.onData(chunk));
      socket.on("close", () => {
        this.connected = false;
        this.socket = null;
        this.rejectAll(new Error("Redis connection closed."));
      });
      socket.once(this.options.tls ? "secureConnect" : "connect", async () => {
        if (settled) return;
        socket.removeListener("error", fail);
        socket.setTimeout(0);
        socket.on("error", error => {
          this.connected = false;
          this.rejectAll(error);
        });
        this.socket = socket;
        this.connected = true;
        this.buffer = Buffer.alloc(0);

        try {
          if (this.options.password) {
            if (this.options.username) {
              await this.command("AUTH", this.options.username, this.options.password);
            } else {
              await this.command("AUTH", this.options.password);
            }
          }
          if (Number.isInteger(this.options.db) && this.options.db >= 0) {
            await this.command("SELECT", this.options.db);
          }
          settled = true;
          resolve();
        } catch (err) {
          fail(err);
        }
      });
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.queue.length) {
      const parsed = parseResp(this.buffer);
      if (!parsed) break;
      this.buffer = this.buffer.slice(parsed.offset);
      const request = this.queue.shift();
      if (parsed.error) request.reject(parsed.error);
      else request.resolve(parsed.value);
    }
  }

  rejectAll(error) {
    while (this.queue.length) {
      const request = this.queue.shift();
      request.reject(error);
    }
  }

  async command(...args) {
    await this.ensureConnected();
    return new Promise((resolve, reject) => {
      const request = { resolve, reject };
      this.queue.push(request);
      this.socket.write(encodeCommand(args), error => {
        if (!error) return;
        const index = this.queue.indexOf(request);
        if (index !== -1) this.queue.splice(index, 1);
        request.reject(error);
      });
    });
  }

  logError(logger, message) {
    const now = Date.now();
    if (now - this.lastErrorLog < 60000) return;
    this.lastErrorLog = now;
    logger?.warn?.(`[DASHBOARD CACHE] ${message}`);
  }

  async get(key, logger) {
    try {
      return await this.command("GET", key);
    } catch (err) {
      this.logError(logger, `Redis get failed: ${err.message}`);
      return null;
    }
  }

  async set(key, value, ttlSeconds, logger) {
    try {
      await this.command("SET", key, value, "EX", Math.max(1, Number.parseInt(ttlSeconds, 10) || 300));
      return true;
    } catch (err) {
      this.logError(logger, `Redis set failed: ${err.message}`);
      return false;
    }
  }
}

function resolveDashboardCacheConfig(loaded) {
  const primary = loaded?.config || {};
  const dashboard = primary.DASHBOARD || primary.dashboard || {};
  const cache = dashboard.cache || dashboard.CACHE || {};
  const redisRaw = cache.redis || dashboard.redis || primary.REDIS || primary.redis || {};
  const hasRedisEnv = [
    "REDIS_URL",
    "REDIS_HOST",
    "REDIS_PORT",
    "REDIS_USERNAME",
    "REDIS_PASSWORD",
    "REDIS_DB",
    "REDIS_TLS",
    "REDIS_ENABLED"
  ].some(name => process.env[name] != null && process.env[name] !== "");
  const urlConfig = parseRedisUrl(process.env.REDIS_URL || redisRaw.url || "");
  const redis = {
    ...urlConfig,
    host: process.env.REDIS_HOST || redisRaw.host || urlConfig.host || (hasRedisEnv ? "127.0.0.1" : ""),
    port: parsePort(process.env.REDIS_PORT || redisRaw.port || urlConfig.port, 6379),
    username: process.env.REDIS_USERNAME || redisRaw.username || urlConfig.username || "",
    password: process.env.REDIS_PASSWORD || redisRaw.password || urlConfig.password || "",
    db: Number.parseInt(process.env.REDIS_DB || redisRaw.db || urlConfig.db || "0", 10),
    tls: normalizeBool(process.env.REDIS_TLS || redisRaw.tls, Boolean(urlConfig.tls)),
    timeoutMs: parsePort(process.env.REDIS_TIMEOUT_MS || redisRaw.timeoutMs, 2000)
  };
  const redisConfigured = Boolean(process.env.REDIS_URL || hasRedisEnv || redisRaw.url || redis.host);

  return {
    enabled: normalizeBool(process.env.DASHBOARD_CACHE_ENABLED || cache.enabled, true),
    ttlSeconds: parsePort(process.env.DASHBOARD_CACHE_TTL_SECONDS || cache.ttlSeconds || cache.ttl || 300, 300),
    namespace: String(process.env.DASHBOARD_CACHE_NAMESPACE || cache.namespace || "banlogger:dashboard").trim(),
    redis: {
      ...redis,
      enabled: normalizeBool(process.env.REDIS_ENABLED || redisRaw.enabled, redisConfigured)
    }
  };
}

function createDashboardCache(config = {}, logger = console) {
  const memory = new Map();
  const pending = new Map();
  const namespace = String(config.namespace || "banlogger:dashboard").replace(/:+$/g, "");
  const ttlSeconds = Number.parseInt(config.ttlSeconds, 10) || 300;
  const redis = config.enabled && config.redis?.enabled
    ? new SimpleRedisClient(config.redis)
    : null;

  function makeKey(parts) {
    return `${namespace}:${hashKey(stableJson(parts))}`;
  }

  function getMemory(key) {
    const row = memory.get(key);
    if (!row) return null;
    if (row.expiresAt <= Date.now()) {
      memory.delete(key);
      return null;
    }
    return row.value;
  }

  function setMemory(key, value, ttl = ttlSeconds) {
    memory.set(key, {
      value,
      expiresAt: Date.now() + Math.max(1, ttl) * 1000
    });
  }

  async function getJson(key) {
    const memoryHit = getMemory(key);
    if (memoryHit != null) return memoryHit;

    if (!redis) return null;
    const raw = await redis.get(key, logger);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      setMemory(key, parsed, Math.min(ttlSeconds, 30));
      return parsed;
    } catch {
      return null;
    }
  }

  async function setJson(key, value, ttl = ttlSeconds) {
    setMemory(key, value, ttl);
    if (redis) await redis.set(key, JSON.stringify(value), ttl, logger);
  }

  async function wrap(parts, loader, options = {}) {
    if (!config.enabled || options.skipCache) return loader();
    const key = makeKey(parts);
    const cached = await getJson(key);
    if (cached != null) return { ...cached, cache: { hit: true, key } };
    if (pending.has(key)) return pending.get(key);

    const loading = Promise.resolve()
      .then(loader)
      .then(async value => {
        const cacheable = options.cacheable ? options.cacheable(value) : true;
        if (cacheable) await setJson(key, value, options.ttlSeconds || ttlSeconds);
        return { ...value, cache: { hit: false, key } };
      })
      .finally(() => pending.delete(key));

    pending.set(key, loading);
    return loading;
  }

  return {
    enabled: Boolean(config.enabled),
    ttlSeconds,
    redisEnabled: Boolean(redis),
    makeKey,
    getJson,
    setJson,
    wrap
  };
}

module.exports = {
  createDashboardCache,
  resolveDashboardCacheConfig
};
