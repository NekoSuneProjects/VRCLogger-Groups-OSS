const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");
const { normalizeVrcUserInput } = require("../utils/vrcUserId");

const GLOBAL_DIR = path.join(process.cwd(), "config", "global");
const DB_PATH = path.join(GLOBAL_DIR, "community_analytics.sqlite");

let cache = null;
let initPromise = null;

function mapActionToMetric(action) {
  switch (String(action || "").toLowerCase()) {
    case "ban":
    case "group.user.ban":
      return "bans";
    case "unban":
    case "group.user.unban":
      return "unbans";
    case "kick":
    case "group.instance.kick":
      return "kicks";
    case "warn":
    case "group.instance.warn":
      return "warns";
    case "join":
    case "group.member.join":
      return "joins";
    case "leave":
    case "group.member.leave":
      return "leaves";
    default:
      return null;
  }
}

function normalizeVrcUserId(input) {
  return normalizeVrcUserInput(input) || "";
}

async function initGlobalAnalytics() {
  if (cache) return cache;
  if (initPromise) return initPromise;

  initPromise = (async () => {
  if (!fs.existsSync(GLOBAL_DIR)) fs.mkdirSync(GLOBAL_DIR, { recursive: true });

  const sequelize = new Sequelize({
    dialect: "sqlite",
    storage: DB_PATH,
    logging: false
  });

  const CommunityUserStats = sequelize.define(
    "CommunityUserStats",
    {
      vrcUserId: { type: DataTypes.STRING, primaryKey: true },
      bans: { type: DataTypes.INTEGER, defaultValue: 0 },
      unbans: { type: DataTypes.INTEGER, defaultValue: 0 },
      kicks: { type: DataTypes.INTEGER, defaultValue: 0 },
      warns: { type: DataTypes.INTEGER, defaultValue: 0 },
      joins: { type: DataTypes.INTEGER, defaultValue: 0 },
      leaves: { type: DataTypes.INTEGER, defaultValue: 0 },
      shares: { type: DataTypes.INTEGER, defaultValue: 0 }
    },
    { tableName: "community_user_stats" }
  );

  const CommunityUserHistory = sequelize.define(
    "CommunityUserHistory",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      vrcUserId: { type: DataTypes.STRING, allowNull: false },
      action: { type: DataTypes.STRING, allowNull: false },
      guildId: { type: DataTypes.STRING, allowNull: false },
      guildName: { type: DataTypes.STRING, allowNull: false },
      groupId: { type: DataTypes.STRING, allowNull: false },
      groupName: { type: DataTypes.STRING, allowNull: false },
      sharedByDiscordId: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "system"
      },
      sharedByDiscordTag: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "system"
      },
      mode: { type: DataTypes.STRING, allowNull: false, defaultValue: "button" }
    },
    { tableName: "community_user_history" }
  );

  async function ensureTableAndColumns(model, tableName, columns) {
    const qi = sequelize.getQueryInterface();
    let desc = null;
    try {
      desc = await qi.describeTable(tableName);
    } catch (err) {
      const msg = String(err?.message || "").toLowerCase();
      if (
        msg.includes("no description found") ||
        msg.includes("does not exist") ||
        msg.includes("no such table")
      ) {
        await model.sync();
      } else {
        throw err;
      }
    }

    if (!desc || !Object.keys(desc).length) {
      try {
        desc = await qi.describeTable(tableName);
      } catch {
        desc = {};
      }
    }

    for (const [name, definition] of Object.entries(columns)) {
      if (desc && Object.prototype.hasOwnProperty.call(desc, name)) continue;
      try {
        await qi.addColumn(tableName, name, definition);
      } catch (err) {
        const msg = String(err?.message || "").toLowerCase();
        if (
          msg.includes("duplicate column") ||
          msg.includes("already exists")
        ) {
          continue;
        }
        // SQLite can fail with "*_backup" during concurrent schema changes.
        // Re-check schema and continue if column now exists.
        if (msg.includes("_backup")) {
          try {
            const refreshed = await qi.describeTable(tableName);
            if (Object.prototype.hasOwnProperty.call(refreshed || {}, name)) {
              continue;
            }
          } catch {}
        }
        throw err;
      }
    }
  }

  await ensureTableAndColumns(CommunityUserStats, "community_user_stats", {
    vrcUserId: { type: DataTypes.STRING, primaryKey: true },
    bans: { type: DataTypes.INTEGER, defaultValue: 0 },
    unbans: { type: DataTypes.INTEGER, defaultValue: 0 },
    kicks: { type: DataTypes.INTEGER, defaultValue: 0 },
    warns: { type: DataTypes.INTEGER, defaultValue: 0 },
    joins: { type: DataTypes.INTEGER, defaultValue: 0 },
    leaves: { type: DataTypes.INTEGER, defaultValue: 0 },
    shares: { type: DataTypes.INTEGER, defaultValue: 0 },
    createdAt: { type: DataTypes.DATE },
    updatedAt: { type: DataTypes.DATE }
  });

  await ensureTableAndColumns(CommunityUserHistory, "community_user_history", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    vrcUserId: { type: DataTypes.STRING, allowNull: false },
    action: { type: DataTypes.STRING, allowNull: false },
    guildId: { type: DataTypes.STRING, allowNull: false },
    guildName: { type: DataTypes.STRING, allowNull: false },
    groupId: { type: DataTypes.STRING, allowNull: false },
    groupName: { type: DataTypes.STRING, allowNull: false },
    sharedByDiscordId: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "system"
    },
    sharedByDiscordTag: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "system"
    },
    mode: { type: DataTypes.STRING, allowNull: false, defaultValue: "button" },
    createdAt: { type: DataTypes.DATE },
    updatedAt: { type: DataTypes.DATE }
  });

  cache = {
    sequelize,
    CommunityUserStats,
    CommunityUserHistory,
    normalizeVrcUserId,
    mapActionToMetric,
    async track(payload = {}) {
      const vrcUserId = normalizeVrcUserId(payload.vrcUserId);
      const action = String(payload.action || "").toLowerCase();
      if (!vrcUserId || !action) return null;

      const [row] = await CommunityUserStats.findOrCreate({
        where: { vrcUserId },
        defaults: { vrcUserId }
      });

      const metric = mapActionToMetric(action);
      if (metric) await row.increment(metric);
      await row.increment("shares");
      await row.reload();

      await CommunityUserHistory.create({
        vrcUserId,
        action,
        guildId: String(payload.guildId || "unknown"),
        guildName: String(payload.guildName || "Unknown Guild"),
        groupId: String(payload.groupId || "unknown"),
        groupName: String(payload.groupName || "Unknown Group"),
        sharedByDiscordId: String(payload.sharedByDiscordId || "system"),
        sharedByDiscordTag: String(payload.sharedByDiscordTag || "system"),
        mode: String(payload.mode || "button")
      });

      return row;
    },
    async getUser(vrcUserId) {
      const normalized = normalizeVrcUserId(vrcUserId);
      if (!normalized) return null;
      let stats = await CommunityUserStats.findOne({
        where: { vrcUserId: normalized }
      });
      // Backward compatibility for old records that were forced to usr_*
      if (!stats && !normalized.startsWith("usr_")) {
        stats = await CommunityUserStats.findOne({
          where: { vrcUserId: `usr_${normalized}` }
        });
      }
      if (!stats) return null;
      const key = stats.vrcUserId;
      const history = await CommunityUserHistory.findAll({
        where: { vrcUserId: key },
        order: [["createdAt", "DESC"]],
        limit: 20
      });
      return { stats, history };
    }
  };

  return cache;
  })();

  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

module.exports = { initGlobalAnalytics, normalizeVrcUserId, mapActionToMetric };
