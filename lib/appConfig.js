// lib/appConfig.js
// Loads the single settings file for this bot: one Discord server, one VRChat group.
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const { makeDatastores } = require("./datastores");
const { getGroup } = require("./vrcGroup");

const SETTINGS_PATH = path.join("config", "settings.json");
const STORAGE_DIR = path.join("config", "data", "sqlite");

// Legacy layouts we migrate from, newest first.
const LEGACY_GUILDS_DIR = path.join("config", "guilds");
const LEGACY_BOT_CONFIG_DIR = "bot_configs";

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isObject(base)) return isObject(override) ? { ...override } : override;
  const out = { ...base };
  if (!isObject(override)) return out;

  for (const [key, value] of Object.entries(override)) {
    if (Array.isArray(value)) out[key] = [...value];
    else if (isObject(value) && isObject(out[key])) out[key] = deepMerge(out[key], value);
    else out[key] = value;
  }
  return out;
}

/**
 * Collapses a legacy guild profile (which may carry VRCAPI.groups[]) into the
 * single-group shape. Only the first group survives - extra groups are dropped.
 */
function flattenLegacyProfile(legacy) {
  const out = deepMerge({}, legacy);
  const vrc = isObject(out.VRCAPI) ? { ...out.VRCAPI } : {};
  const groups = Array.isArray(vrc.groups) ? vrc.groups.filter(g => g?.groupid) : [];

  delete vrc.groups;
  delete vrc.defaultGroupId;

  if (groups.length) {
    const [first, ...dropped] = groups;
    if (dropped.length) {
      console.warn(
        `[config] Legacy profile tracked ${groups.length} VRChat groups. ` +
          `Keeping "${first.groupid}" and dropping: ${dropped.map(g => g.groupid).join(", ")}.`
      );
    }
    Object.assign(vrc, first);
  }

  if (isObject(vrc.SQL) && Object.keys(vrc.SQL).length && !isObject(out.SQL)) {
    out.SQL = { ...vrc.SQL };
  }

  out.VRCAPI = vrc;
  return out;
}

async function findLegacyProfile() {
  // config/guilds/<id>/config.json (or profile.json), then config/guilds/<id>.json
  if (await exists(LEGACY_GUILDS_DIR)) {
    const entries = await fs.readdir(LEGACY_GUILDS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(LEGACY_GUILDS_DIR, entry.name);
      for (const name of ["config.json", "profile.json"]) {
        const candidate = path.join(dir, name);
        if (await exists(candidate)) {
          return { filePath: candidate, sqliteDir: path.join(dir, "sqlite") };
        }
      }
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      return { filePath: path.join(LEGACY_GUILDS_DIR, entry.name), sqliteDir: "" };
    }
  }

  // bot_configs/*.json
  if (await exists(LEGACY_BOT_CONFIG_DIR)) {
    const files = (await fs.readdir(LEGACY_BOT_CONFIG_DIR)).filter(
      f => f.endsWith(".json") && f !== "example.json"
    );
    if (files.length) {
      return { filePath: path.join(LEGACY_BOT_CONFIG_DIR, files[0]), sqliteDir: "" };
    }
  }

  return null;
}

async function copyLegacySqlite(sqliteDir) {
  if (!sqliteDir || !(await exists(sqliteDir))) return;
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  for (const name of await fs.readdir(sqliteDir)) {
    const target = path.join(STORAGE_DIR, name);
    if (await exists(target)) continue;
    await fs.copyFile(path.join(sqliteDir, name), target).catch(() => {});
  }
}

/**
 * If config/settings.json has no server/group block yet, fold in the first
 * legacy guild profile we can find so existing installs keep working.
 */
async function migrateLegacyIfNeeded(settings) {
  if (String(settings?.TestingServerID || "").trim() && settings?.VRCAPI?.groupid) {
    return settings;
  }

  const legacy = await findLegacyProfile();
  if (!legacy) return settings;

  let raw;
  try {
    raw = await readJson(legacy.filePath);
  } catch (err) {
    console.error(`[config] Failed to read legacy profile ${legacy.filePath}: ${err.message}`);
    return settings;
  }

  const merged = deepMerge(settings, flattenLegacyProfile(raw));
  await copyLegacySqlite(legacy.sqliteDir);
  await writeJson(SETTINGS_PATH, merged);

  console.info(
    `[config] Migrated ${legacy.filePath} into ${SETTINGS_PATH} (single server, single group).`
  );
  return merged;
}

async function loadConfig() {
  let settings = {};
  if (await exists(SETTINGS_PATH)) {
    try {
      settings = await readJson(SETTINGS_PATH);
    } catch (err) {
      throw new Error(`Invalid ${SETTINGS_PATH}: ${err.message}`);
    }
  }

  settings = await migrateLegacyIfNeeded(settings);

  if (!settings.token && settings.clienttoken) settings.token = settings.clienttoken;

  const token = String(settings.token || "").trim();
  if (!token) {
    throw new Error(
      `Missing bot token. Set "token" in ${SETTINGS_PATH} (start from config/settings-template.json).`
    );
  }

  const guildId = String(settings.TestingServerID || "").trim();
  if (!guildId) {
    throw new Error(
      `Missing "TestingServerID" in ${SETTINGS_PATH}. This bot serves exactly one Discord server.`
    );
  }

  if (!getGroup(settings)) {
    throw new Error(
      `Missing "VRCAPI.groupid" in ${SETTINGS_PATH}. This bot tracks exactly one VRChat group.`
    );
  }

  const config = {
    ...settings,
    __filePath: SETTINGS_PATH,
    __guildKey: guildId,
    __storageDir: STORAGE_DIR
  };

  if (!fsSync.existsSync(STORAGE_DIR)) fsSync.mkdirSync(STORAGE_DIR, { recursive: true });
  const db = await makeDatastores(config);

  const profile = { guildId, config, db };
  return { settingsPath: SETTINGS_PATH, config, profile, token };
}

function attachConfig(client, loaded) {
  const { profile } = loaded;

  client.config = profile.config;
  client.state = {
    db: profile.db,
    models: profile.db,
    profile,
    fns: {
      hasAccess: async (userId, actionName) => {
        const group = getGroup(profile.config);
        const roles = group?.ACCESS?.[actionName];
        if (!Array.isArray(roles)) return false;

        const user = await profile.db.VRCStaffList.findOne({
          where: { userId, active: true },
          attributes: ["role"]
        });
        const role = String(user?.role || "").toLowerCase();
        if (!role) return false;
        return roles.map(r => String(r).toLowerCase()).includes(role);
      }
    }
  };

  return profile;
}

module.exports = { SETTINGS_PATH, STORAGE_DIR, loadConfig, attachConfig };
