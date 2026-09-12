// lib/datastores.js
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");
const { getGroup } = require("./vrcGroup");

async function cleanupSQLiteBackups(sequelize) {
  const [rows] = await sequelize.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB '*_backup';"
  );

  for (const row of rows) {
    if (!row || !row.name) continue;
    const safeName = row.name.replace(/`/g, "``");
    await sequelize.query(`DROP TABLE IF EXISTS \`${safeName}\`;`);
  }
}

async function ensureSQLiteTableAndColumns(sequelize, model, tableName, columns) {
  const qi = sequelize.getQueryInterface();
  let description = null;

  try {
    description = await qi.describeTable(tableName);
  } catch (err) {
    const message = String(err?.message || "").toLowerCase();
    if (
      message.includes("no description found") ||
      message.includes("does not exist") ||
      message.includes("no such table")
    ) {
      await model.sync();
      description = await qi.describeTable(tableName).catch(() => ({}));
    } else {
      throw err;
    }
  }

  if (!description || !Object.keys(description).length) {
    await model.sync();
    description = await qi.describeTable(tableName).catch(() => ({}));
  }

  for (const [name, definition] of Object.entries(columns)) {
    if (Object.prototype.hasOwnProperty.call(description || {}, name)) continue;

    try {
      await qi.addColumn(tableName, name, definition);
    } catch (err) {
      const message = String(err?.message || "").toLowerCase();
      if (message.includes("duplicate column") || message.includes("already exists")) {
        continue;
      }

      const refreshed = await qi.describeTable(tableName).catch(() => ({}));
      if (Object.prototype.hasOwnProperty.call(refreshed || {}, name)) continue;
      throw err;
    }
  }
}

function resolveSqlConfig(config) {
  const fromGroup = getGroup(config)?.SQL;
  const sql = fromGroup && Object.keys(fromGroup).length ? fromGroup : config?.SQL;
  return sql || {};
}

function validateSqlConfig(config) {
  const sql = resolveSqlConfig(config);
  const required = ["HOST", "PORT", "USER", "PASS", "DB"];
  const missing = required.filter(k => sql[k] == null || String(sql[k]).trim() === "");
  if (missing.length) {
    const guildId = config?.TestingServerID || config?.__guildKey || "unknown-guild";
    throw new Error(
      `Missing SQL fields (${missing.join(", ")}) for server ${guildId}. Put SQL in the top-level "SQL" block of config/settings.json.`
    );
  }
  return sql;
}

function sanitizeFilePart(value) {
  return String(value || "default").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function sqlitePathForGroup(baseDir, groupId) {
  return path.join(baseDir, `${sanitizeFilePart(groupId)}_groupscache.sqlite`);
}

async function initLocalModels(sqlitePath) {
  const LocalSequelize = new Sequelize({
    dialect: "sqlite",
    storage: sqlitePath,
    logging: false
  });

  const GroupEvents = LocalSequelize.define("events", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    eventId: { type: DataTypes.STRING, allowNull: false },
    eventType: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.STRING, allowNull: false },
    targetId: { type: DataTypes.STRING, allowNull: false },
    json: { type: DataTypes.JSON, allowNull: false }
  });

  const GroupUserEvent = LocalSequelize.define("user_events", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    userId: { type: DataTypes.STRING, allowNull: false },
    bans: { type: DataTypes.INTEGER, defaultValue: 0 },
    unbans: { type: DataTypes.INTEGER, defaultValue: 0 },
    kicks: { type: DataTypes.INTEGER, defaultValue: 0 },
    warnings: { type: DataTypes.INTEGER, defaultValue: 0 },
    joins: { type: DataTypes.INTEGER, defaultValue: 0 },
    leaves: { type: DataTypes.INTEGER, defaultValue: 0 },
    remove: { type: DataTypes.INTEGER, defaultValue: 0 },
    requestsend: { type: DataTypes.INTEGER, defaultValue: 0 },
    requestreject: { type: DataTypes.INTEGER, defaultValue: 0 }
  });

  await cleanupSQLiteBackups(LocalSequelize);
  await ensureSQLiteTableAndColumns(LocalSequelize, GroupEvents, "events", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    eventId: { type: DataTypes.STRING, allowNull: false },
    eventType: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.STRING, allowNull: false },
    targetId: { type: DataTypes.STRING, allowNull: false },
    json: { type: DataTypes.JSON, allowNull: false },
    createdAt: { type: DataTypes.DATE },
    updatedAt: { type: DataTypes.DATE }
  });
  await ensureSQLiteTableAndColumns(LocalSequelize, GroupUserEvent, "user_events", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    userId: { type: DataTypes.STRING, allowNull: false },
    bans: { type: DataTypes.INTEGER, defaultValue: 0 },
    unbans: { type: DataTypes.INTEGER, defaultValue: 0 },
    kicks: { type: DataTypes.INTEGER, defaultValue: 0 },
    warnings: { type: DataTypes.INTEGER, defaultValue: 0 },
    joins: { type: DataTypes.INTEGER, defaultValue: 0 },
    leaves: { type: DataTypes.INTEGER, defaultValue: 0 },
    remove: { type: DataTypes.INTEGER, defaultValue: 0 },
    requestsend: { type: DataTypes.INTEGER, defaultValue: 0 },
    requestreject: { type: DataTypes.INTEGER, defaultValue: 0 },
    createdAt: { type: DataTypes.DATE },
    updatedAt: { type: DataTypes.DATE }
  });

  return {
    LocalSequelize,
    GroupEvents,
    GroupUserEvent
  };
}

/** Build per-bot DBs and models from the provided config */
async function makeDatastores(config) {
  const sqlConfig = validateSqlConfig(config);
  const guildStorageDir = config.__storageDir || path.join(process.cwd(), "vrcgroup");

  // Ensure sqlite folder per guild
  const dir = guildStorageDir;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const groupId = String(config?.VRCAPI?.groupid || "").trim() || "default";

  const targetSqlitePath = sqlitePathForGroup(dir, groupId);
  const legacyPaths = [
    path.join(process.cwd(), "vrcgroup", `${sanitizeFilePart(groupId)}_groupscache.sqlite`),
    path.join(dir, "groupscache.sqlite")
  ];

  for (const legacyPath of legacyPaths) {
    if (
      legacyPath !== targetSqlitePath &&
      fs.existsSync(legacyPath) &&
      !fs.existsSync(targetSqlitePath)
    ) {
      fs.copyFileSync(legacyPath, targetSqlitePath);
    }
  }

  const local = await initLocalModels(targetSqlitePath);

  // --- Per-bot MySQL (pull from this config) ---
  const GamingClientSequelize = new Sequelize(
    sqlConfig.DB,
    sqlConfig.USER,
    sqlConfig.PASS,
    {
      host: sqlConfig.HOST,
      port: sqlConfig.PORT,
      dialect: "mysql",
      logging: false, // true if you want SQL logs
      pool: { max: 5, min: 0, idle: 10000 }
    }
  );

  const VRCBlacklist = GamingClientSequelize.define("vrc_vrcga_blacklists", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    groupId: { type: DataTypes.STRING(500), allowNull: true },
    displayName: { type: DataTypes.STRING(500) },
    userID: { type: DataTypes.STRING(500) },
    reason: { type: DataTypes.STRING(500) },
    type: {
      type: DataTypes.ENUM(
        "CLIENTS",
        "TROLL",
        "RIPPER",
        "CRASHER",
        "CYBERBULLY",
        "BANNED",
        "TOXIC",
        "UNDERAGE",
        "RACISM",
        "COMMUNITY",
        "AFFILIATED",
        "BOS",
        "NUISANCE",
        "UNKNOWN",
        "WATCHLIST"
      ),
      allowNull: true,
    },
    tags: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    moderator: { type: DataTypes.STRING(500) },
    createdBy: { type: DataTypes.STRING(500), allowNull: true },
    updatedBy: { type: DataTypes.STRING(500), allowNull: true },
    date: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    blacklisted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    archived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    archivedAt: { type: DataTypes.DATE, allowNull: true },
    archivedBy: { type: DataTypes.STRING(500), allowNull: true },
    watchlist: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  });

  const VRCAVIBlacklist = GamingClientSequelize.define("vrc_vrcga_blacklist_avatars", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    groupId: { type: DataTypes.STRING(500), allowNull: true },
    displayName: { type: DataTypes.STRING(500) },
    userId: { type: DataTypes.STRING(500) },
    avatarId: { type: DataTypes.STRING(500) },
    reason: { type: DataTypes.STRING(500) },
    type: {
      type: DataTypes.ENUM(
        "RIPPER",
        "CRASHER",
        "UNDERAGE",
        "RACISM",
        "GANGMONKEY",
        "BOS",
        "TOXIC",
        "NUISANCE",
        "UNKNOWN",
        "WATCHLIST"
      ),
      allowNull: true,
    },
    tags: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    moderator: { type: DataTypes.STRING(500) },
    createdBy: { type: DataTypes.STRING(500), allowNull: true },
    updatedBy: { type: DataTypes.STRING(500), allowNull: true },
    date: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    blacklisted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    archived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    archivedAt: { type: DataTypes.DATE, allowNull: true },
    archivedBy: { type: DataTypes.STRING(500), allowNull: true }
  });

  const ApiKey = GamingClientSequelize.define("ApiKey", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    guildId: { type: DataTypes.STRING },
    groupId: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING, allowNull: false },
    displayName: { type: DataTypes.STRING, allowNull: false },
    key: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: "staff" },
    permissions: { type: DataTypes.JSON, defaultValue: [] },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false },
    usageLimit: { type: DataTypes.INTEGER, defaultValue: 100 },
    lastUsedAt: { type: DataTypes.DATE }
  });

  const VRCBLQueue = GamingClientSequelize.define("VRC_Bot_BanListQueue", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    groupId: { type: DataTypes.STRING, allowNull: false },
    userId: { type: DataTypes.STRING, allowNull: false },
    actions: { type: DataTypes.STRING, allowNull: false },
    groupName: { type: DataTypes.STRING, allowNull: false }
  });

  const VRCStaffList = GamingClientSequelize.define("VRC_Bot_StaffList", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    userId: { type: DataTypes.STRING, allowNull: false },
    displayName: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, allowNull: false },
    dateadded: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
  });

  const VRCBlacklistGroups = GamingClientSequelize.define("vrc_vrcga_blacklist_groups", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    sourceGroupId: { type: DataTypes.STRING(500), allowNull: true },
    name: { type: DataTypes.STRING(500) },
    groupID: { type: DataTypes.STRING(500) },
    reason: { type: DataTypes.STRING(500) },
    type: {
      type: DataTypes.ENUM(
        "MALICIOUS",
        "CRASHER",
        "RIPPER",
        "TOXIC",
        "NUISANCE",
        "UNKNOWN",
        "ALLY",
        "AFFILIATED",
        "COMMUNITY",
        "WATCHLIST"
      ),
      allowNull: true,
    },
    tags: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    moderator: { type: DataTypes.STRING(500) },
    createdBy: { type: DataTypes.STRING(500), allowNull: true },
    updatedBy: { type: DataTypes.STRING(500), allowNull: true },
    date: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    blacklisted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    archived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    archivedAt: { type: DataTypes.DATE, allowNull: true },
    archivedBy: { type: DataTypes.STRING(500), allowNull: true },
    public: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  });

  const VRCUserProfileCache = GamingClientSequelize.define("vrc_user_profile_cache", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    userId: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    displayName: { type: DataTypes.STRING(500), allowNull: true },
    bio: { type: DataTypes.TEXT, allowNull: true },
    bioLinks: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    dateJoined: { type: DataTypes.STRING(128), allowNull: true },
    lastPlatform: { type: DataTypes.STRING(128), allowNull: true },
    currentAvatarId: { type: DataTypes.STRING(128), allowNull: true },
    currentAvatarImageUrl: { type: DataTypes.TEXT, allowNull: true },
    currentAvatarThumbnailImageUrl: { type: DataTypes.TEXT, allowNull: true },
    raw: { type: DataTypes.JSON, allowNull: true },
    lastFetchedAt: { type: DataTypes.DATE, allowNull: true }
  }, { freezeTableName: true });

  const VRCUserNameHistory = GamingClientSequelize.define("vrc_user_name_history", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    userId: { type: DataTypes.STRING(128), allowNull: false },
    oldDisplayName: { type: DataTypes.STRING(500), allowNull: false },
    newDisplayName: { type: DataTypes.STRING(500), allowNull: false },
    observedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    source: { type: DataTypes.STRING(128), allowNull: false, defaultValue: "dashboard-profile-fetch" }
  }, { freezeTableName: true });

  const VRCAvatarProfileCache = GamingClientSequelize.define("vrc_avatar_profile_cache", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    avatarId: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(500), allowNull: true },
    authorId: { type: DataTypes.STRING(128), allowNull: true },
    authorName: { type: DataTypes.STRING(500), allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    imageUrl: { type: DataTypes.TEXT, allowNull: true },
    thumbnailImageUrl: { type: DataTypes.TEXT, allowNull: true },
    releaseStatus: { type: DataTypes.STRING(128), allowNull: true },
    version: { type: DataTypes.INTEGER, allowNull: true },
    tags: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    raw: { type: DataTypes.JSON, allowNull: true },
    lastFetchedAt: { type: DataTypes.DATE, allowNull: true }
  }, { freezeTableName: true });

  await GamingClientSequelize.sync({ alter: true });

  return {
    LocalSequelize: local.LocalSequelize,
    GamingClientSequelize,
    GroupEvents: local.GroupEvents,
    GroupUserEvent: local.GroupUserEvent,
    groupId,
    VRCBlacklist,
    VRCAVIBlacklist,
    ApiKey,
    VRCBLQueue,
    VRCStaffList,
    VRCBlacklistGroups,
    VRCUserProfileCache,
    VRCUserNameHistory,
    VRCAvatarProfileCache
  };
}

module.exports = { makeDatastores };
