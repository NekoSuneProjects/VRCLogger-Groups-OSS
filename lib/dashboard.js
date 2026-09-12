const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const express = require("express");
const fs = require("fs-extra");
const { Op, Sequelize } = require("sequelize");
const { getGroup } = require("./vrcGroup");

// This build serves exactly one Discord server tracking exactly one VRChat group.
// These keep the call sites below reading naturally without reintroducing lists.
function listProfiles(loaded) {
  return loaded?.profile ? [loaded.profile] : [];
}

function listGroups(config) {
  const group = getGroup(config);
  return group ? [group] : [];
}
const { initGlobalAnalytics } = require("./globalAnalytics");
const {
  SAFETY_LISTS,
  allowedSafetyListKey,
  loadSafetyRegistry,
  saveSafetyRegistry,
  publicSafetyPayload,
  avatarBlacklistForProxy,
  publicGroupBlacklistForProxy,
  safetyCountsForProxy,
  findSafetyItem,
  normalizeSafetyEntry,
  normalizeSafetyList
} = require("./safetyRegistry");
const { createVrchatApi } = require("../utils/vrchat");
const {
  createDashboardCache,
  resolveDashboardCacheConfig
} = require("./dashboardCache");

const DISCORD_API = "https://discord.com/api/v10";
const ADMINISTRATOR_PERMISSION = 0x8n;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const BOT_GROUP_VISIBILITY = "hidden";
const CLIENT_API_HEADER = "vrclogger-api-key";
const CLIENT_API_KEY_PREFIX = "vrcdash";
const API_ADMIN_ROLES = new Set(["owner", "co-owner", "admin", "discord-owner", "discord-admin"]);
const STAFF_DASHBOARD_ROLES = new Set(["owner", "co-owner", "admin", "mod", "trainee", "it-tech"]);
const STAFF_SETUP_ROLES = new Set(["owner", "co-owner"]);
const BLACKLIST_ADMIN_ROLES = new Set(["owner", "co-owner", "admin", "discord-owner", "discord-admin"]);
const BLACKLIST_SELF_USER_ROLES = new Set(["mod", "trainee", "it-tech"]);

let dashboardServer = null;

const LOGGER_CHANNEL_KEYS = [
  "ANNOUNCEMENT",
  "BANMEMBER",
  "UNBANMEMBER",
  "KICKMEMBER",
  "REMOVEMEMBER",
  "WARNMEMBER",
  "JOINMEMBER",
  "LEAVEMEMBER",
  "WORLDCREATEMEMBER",
  "WORLDCLOSEMEMBER",
  "GENERAL",
  "VOICE"
];

const DEFAULT_ACCESS = {
  ban: ["owner", "co-owner", "admin"],
  unban: ["owner", "co-owner"],
  blacklister: ["owner", "co-owner", "admin"],
  reacted: ["owner", "co-owner"],
  requester: ["owner", "co-owner"],
  tags: ["owner", "co-owner", "admin", "mod", "trainee", "it-tech"],
  userlookup: ["owner", "co-owner", "admin", "it-tech"]
};

const VRC_ROLE_PERMISSIONS = [
  ["Manage Group Member Data", "Allows role to view, filter by role, sort all members, and edit data about them."],
  ["Manage Group Data", "Allows role to edit group details such as name, description, and join state."],
  ["View Audit log", "Allows role to view the full group audit log."],
  ["Manage Group Roles", "Allows role to create, modify, and delete roles."],
  ["Manage Group Default Role", "Allows role to manage the default Everyone role. Requires Manage Group Roles."],
  ["Assign Group Roles", "Allows role to assign and unassign roles to users. Requires Manage Group Member Data."],
  ["Manage Group Bans", "Allows role to ban or unban users and view all banned users. Requires Manage Group Member Data."],
  ["Remove Group Members", "Allows role to remove someone from the group. Requires Manage Group Member Data."],
  ["View All Members", "Allows role to view all members in a group, not just friends."],
  ["Manage Group Announcement", "Allows role to set or clear group announcements and send them as notifications."],
  ["Manage Group Galleries", "Allows role to create, reorder, edit, delete, submit to, and approve group galleries."],
  ["Manage Group Invites", "Allows role to create or cancel invites and accept, decline, or block join requests."],
  ["Moderate Group Instances", "Allows role to moderate within a group instance."],
  ["Manage Group Instances", "Allows role to rename or close a group instance."],
  ["Group Instance Queue Priority", "Gives role priority for group instance queues."],
  ["Create Group Public Instances", "Allows role to create public group instances. Private groups cannot create public instances."],
  ["Create Group+ Instances", "Allows role to create Group+ instances."],
  ["Create Members-Only Group Instances", "Allows role to create members-only instances."],
  ["Role-Restrict Members-Only Instances", "Allows role restrictions on members-only instances. Requires Create Members-Only Group Instances."],
  ["Portal to Group+ Instances", "Allows role to open locked portals to Group+ instances."],
  ["Unlocked Portal to Group+ Instances", "Allows role to open unlocked portals to Group+ instances. Requires Portal to Group+ Instances."],
  ["Join Group Instances", "Allows role to join group instances."]
].map(([name, description]) => ({ name, description }));

const SETUP_BACKEND_ENDPOINTS = [
  "POST /v1/vrchat/groups/messages",
  "POST /v1/vrchat/groups/moderation",
  "POST /v1/vrchat/groups/invite",
  "POST /v1/vrchat/groups/role",
  "POST /v1/vrchat/groups/search",
  "POST /v1/vrchat/groups/getgroup",
  "POST /v1/vrchat/groups/membership/join",
  "POST /v1/vrchat/groups/membership/visibility",
  "POST /v1/vrchat/groups/join",
  "GET /v1/vrchat/groups/invites/pending",
  "POST /v1/vrchat/groups/invites/accept",
  "POST /v1/vrchat/groups/invites/decline",
  "POST /v1/vrchat/groups/invites/ignore",
  "POST /v1/vrchat/groups/moderation/getmemberrequests",
  "POST /v1/vrchat/groups/moderation/postmemberrequests",
  "POST /v1/vrchat/groups/posts/get"
];

function normalizeBool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const parseBoolean = normalizeBool;

function normalizePort(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function safeReturnTo(value) {
  const raw = String(value || "/dashboard").trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

function resolveDashboardConfig(loaded, options = {}) {
  const primary = loaded?.config || {};
  const raw = primary.DASHBOARD || primary.dashboard || {};
  const defaultPort = normalizePort(options.defaultPort, 3434);
  const port = normalizePort(process.env.DASHBOARD_PORT || raw.port, defaultPort);
  const host = String(process.env.DASHBOARD_HOST || raw.host || "0.0.0.0").trim();
  const baseUrl = cleanBaseUrl(
    process.env.DASHBOARD_BASE_URL || raw.baseUrl || `http://127.0.0.1:${port}`
  );
  const clientId = String(
    process.env.DASHBOARD_DISCORD_CLIENT_ID ||
      process.env.DISCORD_CLIENT_ID ||
      raw.discordClientId ||
      primary.clientid ||
      ""
  ).trim();
  const clientSecret = String(
    process.env.DASHBOARD_DISCORD_CLIENT_SECRET ||
      process.env.DISCORD_CLIENT_SECRET ||
      raw.discordClientSecret ||
      ""
  ).trim();
  const sessionSecret = String(
    process.env.DASHBOARD_SESSION_SECRET ||
      raw.sessionSecret ||
      crypto.randomBytes(32).toString("hex")
  );
  const redirectUri = String(
    process.env.DASHBOARD_DISCORD_REDIRECT_URI ||
      raw.redirectUri ||
      `${baseUrl}/auth/discord/callback`
  ).trim();
  const cookieName = String(raw.cookieName || "vrc_dashboard_session").trim();

  const missing = [];
  if (!clientId) missing.push("Discord client id");
  if (!clientSecret) missing.push("Discord client secret");
  if (!baseUrl) missing.push("Dashboard base URL");

  return {
    enabled: normalizeBool(process.env.DASHBOARD_ENABLED || raw.enabled, true),
    host,
    port,
    baseUrl,
    clientId,
    clientSecret,
    redirectUri,
    sessionSecret,
    cookieName,
    configured: missing.length === 0,
    missing,
    secureCookie: baseUrl.startsWith("https://")
  };
}

function parseCookies(header = "") {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function createSigner(secret) {
  return {
    sign(value) {
      const signature = crypto
        .createHmac("sha256", secret)
        .update(value)
        .digest("base64url");
      return `${value}.${signature}`;
    },
    unsign(signedValue) {
      const raw = String(signedValue || "");
      const index = raw.lastIndexOf(".");
      if (index <= 0) return null;
      const value = raw.slice(0, index);
      const expected = this.sign(value);
      const a = Buffer.from(raw);
      const b = Buffer.from(expected);
      if (a.length !== b.length) return null;
      return crypto.timingSafeEqual(a, b) ? value : null;
    }
  };
}

function setSessionCookie(res, config, value) {
  const parts = [
    `${config.cookieName}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (config.secureCookie) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res, config) {
  const parts = [
    `${config.cookieName}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0"
  ];
  if (config.secureCookie) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function cleanupExpiringMaps(sessions, oauthStates) {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (!session || session.expiresAt <= now) sessions.delete(id);
  }
  for (const [state, payload] of oauthStates) {
    if (!payload || payload.createdAt + STATE_TTL_MS <= now) oauthStates.delete(state);
  }
}

function hasAdministratorPermission(permissions) {
  try {
    return (BigInt(String(permissions || "0")) & ADMINISTRATOR_PERMISSION) === ADMINISTRATOR_PERMISSION;
  } catch {
    return false;
  }
}

function avatarUrl(user) {
  if (!user?.id) return "";
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  }
  const fallback = Number.parseInt(user.discriminator || "0", 10) % 5;
  return `https://cdn.discordapp.com/embed/avatars/${Number.isFinite(fallback) ? fallback : 0}.png`;
}

function getSessionGuild(session, guildId) {
  return (session?.guilds || []).find(guild => String(guild.id) === String(guildId)) || null;
}

function canManageProfile(session, profile) {
  const sessionGuild = getSessionGuild(session, profile?.guildId);
  if (!sessionGuild) return false;
  return Boolean(sessionGuild.owner || hasAdministratorPermission(sessionGuild.permissions));
}

async function getStaffAccess(profile, userId) {
  const id = String(userId || "").trim();
  if (!id || !profile?.db?.VRCStaffList) return null;

  const staff = await profile.db.VRCStaffList.findOne({
    where: { userId: id, active: true },
    attributes: ["userId", "displayName", "role", "active"]
  }).catch(() => null);
  const role = String(staff?.role || "").trim().toLowerCase();
  if (!role || !STAFF_DASHBOARD_ROLES.has(role)) return null;

  return {
    userId: id,
    displayName: staff.displayName || "",
    role,
    source: "staff",
    canManage: STAFF_SETUP_ROLES.has(role),
    canManageSetup: STAFF_SETUP_ROLES.has(role),
    blacklistAccess: BLACKLIST_ADMIN_ROLES.has(role)
      ? "admin"
      : BLACKLIST_SELF_USER_ROLES.has(role)
        ? "own-users"
        : "read"
  };
}

async function getProfileAccess(session, profile) {
  const sessionGuild = getSessionGuild(session, profile?.guildId);
  if (!sessionGuild) {
    return {
      canAccess: false,
      canManage: false,
      canManageSetup: false,
      canManageBlacklists: false,
      canManageAllBlacklists: false,
      canManageOwnUserBlacklists: false,
      blacklistAccess: "none",
      role: "",
      source: ""
    };
  }

  if (canManageProfile(session, profile)) {
    return {
      canAccess: true,
      canManage: true,
      canManageSetup: true,
      canManageBlacklists: true,
      canManageAllBlacklists: true,
      canManageOwnUserBlacklists: true,
      blacklistAccess: "admin",
      role: sessionGuild.owner ? "discord-owner" : "discord-admin",
      source: sessionGuild.owner ? "discord-owner" : "discord-admin"
    };
  }

  const staff = await getStaffAccess(profile, session?.user?.id);
  if (staff) {
    const canManageAllBlacklists = staff.blacklistAccess === "admin";
    const canManageOwnUserBlacklists = canManageAllBlacklists || staff.blacklistAccess === "own-users";
    return {
      canAccess: true,
      canManage: Boolean(staff.canManageSetup),
      canManageSetup: Boolean(staff.canManageSetup),
      canManageBlacklists: canManageAllBlacklists || staff.blacklistAccess === "own-users",
      canManageAllBlacklists,
      canManageOwnUserBlacklists,
      blacklistAccess: staff.blacklistAccess,
      role: staff.role,
      source: staff.source
    };
  }

  return {
    canAccess: false,
    canManage: false,
    canManageSetup: false,
    canManageBlacklists: false,
    canManageAllBlacklists: false,
    canManageOwnUserBlacklists: false,
    blacklistAccess: "none",
    role: "",
    source: ""
  };
}

function uniqueIds(values = []) {
  return [
    ...new Set(
      values
        .flatMap(value => Array.isArray(value) ? value : [value])
        .map(value => String(value || "").trim())
        .filter(Boolean)
    )
  ];
}

function getDashboardAdminIds(loaded) {
  const configs = [
    loaded?.config,
    ...listProfiles(loaded).map(profile => profile?.config)
  ].filter(Boolean);

  const ids = [];
  for (const config of configs) {
    ids.push(config?.developerID);
    ids.push(config?.DASHBOARD?.adminDiscordIds);
    ids.push(config?.dashboard?.adminDiscordIds);
  }

  return uniqueIds(ids);
}

function isDashboardAdmin(session, loaded) {
  const userId = String(session?.user?.id || "").trim();
  if (!userId) return false;
  return getDashboardAdminIds(loaded).includes(userId);
}

async function getAccessibleProfiles(session, loaded) {
  const rows = [];
  for (const profile of listProfiles(loaded)) {
    const access = await getProfileAccess(session, profile);
    if (access.canAccess) rows.push({ profile, access });
  }
  return rows;
}

async function findBotGuild(clients, guildId) {
  for (const client of clients || []) {
    const cached = client?.guilds?.cache?.get(String(guildId));
    if (cached) return cached;
  }

  for (const client of clients || []) {
    try {
      const guild = await client?.guilds?.fetch?.(String(guildId)).catch(() => null);
      if (guild) return guild;
    } catch {}
  }

  return null;
}

function serializeGroup(group) {
  return {
    id: group.groupid,
    name: group.groupName || group.groupid,
    autoShare: Boolean(group.globalAnalytics?.autoShare),
    loggerCategoryId: group.LoggerCategoryId || "",
    requestNotifications: Boolean(group.reqnotify?.enable)
  };
}

async function serializeGuild(profile, session, clients, access = null) {
  const sessionGuild = getSessionGuild(session, profile.guildId);
  const botGuild = await findBotGuild(clients, profile.guildId);
  const groups = listGroups(profile.config).map(serializeGroup);
  const icon = botGuild?.iconURL?.({ size: 128 }) || null;
  const resolvedAccess = access || await getProfileAccess(session, profile);

  return {
    id: profile.guildId,
    name: botGuild?.name || sessionGuild?.name || profile.guildId,
    icon,
    memberCount: botGuild?.memberCount || null,
    isOwner: Boolean(sessionGuild?.owner),
    isAdministrator: hasAdministratorPermission(sessionGuild?.permissions),
    canManage: Boolean(resolvedAccess.canManage),
    canManageSetup: Boolean(resolvedAccess.canManageSetup || resolvedAccess.canManage),
    canManageBlacklists: Boolean(resolvedAccess.canManageBlacklists),
    canManageAllBlacklists: Boolean(resolvedAccess.canManageAllBlacklists),
    canManageOwnUserBlacklists: Boolean(resolvedAccess.canManageOwnUserBlacklists),
    blacklistAccess: resolvedAccess.blacklistAccess || "read",
    accessRole: resolvedAccess.role || "",
    accessSource: resolvedAccess.source || "",
    groups
  };
}

// There is only one group, so a groupId in the request is accepted only when it
// matches it. Anything else resolves to null and the caller answers 404.
function resolveGroup(profile, requestedGroupId) {
  const group = getGroup(profile.config);
  const groups = group ? [group] : [];
  const requested = String(requestedGroupId || "").trim();

  if (!group) return { groups, group: null };
  if (requested && requested !== group.groupid) return { groups, group: null };

  return { groups, group };
}

function normalizeGroupId(value) {
  return String(value || "").trim();
}

function normalizeGroupNameFromInfo(info, fallback = "") {
  return (
    info?.data?.name ||
    info?.data?.group?.name ||
    info?.data?.data?.name ||
    info?.name ||
    fallback ||
    ""
  );
}

function emptyLoggerTextChannel(base = {}) {
  const out = {};
  for (const key of LOGGER_CHANNEL_KEYS) out[key] = String(base?.[key] || "");
  return out;
}

function clonePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};
}

function buildGroupForSetup(rawConfig, profile, input, groupInfo = null) {
  const vrc = rawConfig.VRCAPI || {};
  const runtimeVrc = profile.config?.VRCAPI || {};
  const baseGroup = getGroup(rawConfig) || getGroup(profile.config) || {};

  const groupName = String(
    input.groupName ||
      normalizeGroupNameFromInfo(groupInfo) ||
      baseGroup.groupName ||
      input.groupid
  ).trim();

  return {
    groupid: input.groupid,
    groupName,
    ownerDiscordIds: uniqueIds([
      input.ownerDiscordIds,
      baseGroup.ownerDiscordIds,
      input.ownerDiscordId
    ]),
    SQL: clonePlainObject(baseGroup.SQL || vrc.SQL || rawConfig.SQL || runtimeVrc.SQL),
    VRCProxyNode: String(baseGroup.VRCProxyNode || vrc.VRCProxyNode || runtimeVrc.VRCProxyNode || ""),
    globalAnalytics: {
      autoShare: Boolean(input.autoShare ?? baseGroup.globalAnalytics?.autoShare)
    },
    ACCESS: clonePlainObject(baseGroup.ACCESS || vrc.ACCESS || runtimeVrc.ACCESS || DEFAULT_ACCESS),
    LoggerCategoryId: String(baseGroup.LoggerCategoryId || ""),
    reqnotify: {
      enable: Boolean(input.requestNotifications ?? baseGroup.reqnotify?.enable),
      REQCHANNEL: String(baseGroup.reqnotify?.REQCHANNEL || "")
    },
    LoggerTextChannel: emptyLoggerTextChannel(baseGroup.LoggerTextChannel)
  };
}

async function readProfileConfigFile(profile) {
  const filePath = profile?.config?.__filePath;
  if (!filePath) throw new Error("Profile config file path is missing.");
  const raw = await fs.readJson(filePath);
  return { filePath, raw };
}

// The one group is written straight onto VRCAPI - replacing whatever was there.
function writeGroupIntoConfig(target, groupConfig) {
  target.VRCAPI = { ...(target.VRCAPI || {}), ...groupConfig };
  delete target.VRCAPI.groups;
  delete target.VRCAPI.defaultGroupId;
  return target.VRCAPI;
}

async function saveSetupGroup(profile, payload, groupInfo = null) {
  const groupid = normalizeGroupId(payload.groupid);
  if (!groupid) throw new Error("VRChat group id is required.");
  if (!payload.confirmPermissions) {
    throw new Error("Confirm the VRChat bot role permission checklist before saving this group.");
  }

  const { filePath, raw } = await readProfileConfigFile(profile);
  const groupConfig = buildGroupForSetup(raw, profile, {
    ...payload,
    groupid
  }, groupInfo);

  writeGroupIntoConfig(raw, groupConfig);
  await fs.writeJson(filePath, raw, { spaces: 2 });
  writeGroupIntoConfig(profile.config, groupConfig);
  return groupConfig;
}

function setupPayload(profile) {
  return {
    backendUrl: profile.config?.VRCAPI?.VRCBackEndURL || "",
    groups: listGroups(profile.config).map(serializeGroup),
    botMembershipVisibility: BOT_GROUP_VISIBILITY,
    rolePermissions: VRC_ROLE_PERMISSIONS,
    backendEndpoints: SETUP_BACKEND_ENDPOINTS,
    discordCommands: [
      {
        command: "/setup",
        description: "Creates or reuses Discord logger channels for this VRChat group and saves channel IDs."
      },
      {
        command: "/vrcaddadmin and /vrcaddstaff",
        description: "Adds Discord users to the bot staff table so buttons and moderation commands can be used."
      },
      {
        command: "/globalautoshare state:<on|off>",
        description: "Toggles shared global analytics for this VRChat group."
      },
      {
        command: "/removelogger",
        description: "Removes logger channels and clears saved mappings for this group."
      }
    ]
  };
}

function createSetupApi(profile) {
  try {
    return createVrchatApi(profile.config);
  } catch (err) {
    const error = new Error(`VRChat backend is not configured: ${err.message}`);
    error.statusCode = 400;
    throw error;
  }
}

async function ensureHiddenGroupMembership(api, groupid) {
  if (typeof api.EnsureGroupMembershipHidden === "function") {
    return api.EnsureGroupMembershipHidden(groupid);
  }
  return api.SetGroupMembershipVisibility(groupid, BOT_GROUP_VISIBILITY);
}

async function syncProfileGroupMembershipVisibility(profile) {
  const api = createSetupApi(profile);
  const groups = listGroups(profile.config);
  const rows = [];

  for (const group of groups) {
    const groupid = normalizeGroupId(group.groupid);
    if (!groupid) continue;
    const result = await ensureHiddenGroupMembership(api, groupid).catch(err => ({
      status: 500,
      message: err?.message || "Failed to set hidden visibility."
    }));
    rows.push({
      groupid,
      groupName: group.groupName || groupid,
      visibility: BOT_GROUP_VISIBILITY,
      status: result.status,
      message: result.message
    });
  }

  return {
    status: rows.every(row => Number(row.status || 0) >= 200 && Number(row.status || 0) < 300) ? 200 : 207,
    message: rows.length
      ? "Checked bot group membership visibility."
      : "No VRChat groups are configured.",
    visibility: BOT_GROUP_VISIBILITY,
    data: rows
  };
}

async function syncAllGroupMembershipVisibility(loaded) {
  const profiles = listProfiles(loaded);
  for (const profile of profiles) {
    if (!listGroups(profile.config).length) continue;
    await syncProfileGroupMembershipVisibility(profile).catch(err => {
      console.warn(
        `[DASHBOARD] Failed to sync hidden VRChat membership visibility for guild ${profile.guildId}: ${err.message}`
      );
    });
  }
}

function apiKeyIsAdminRole(role) {
  return API_ADMIN_ROLES.has(String(role || "").trim().toLowerCase());
}

function clientPermissionsForAccess(group, access) {
  const role = String(access?.role || "").trim().toLowerCase();
  const permissions = [
    "dashboard:read",
    "overview:read",
    "events:read",
    "users:read",
    "blacklists:read",
    "staff:read",
    "global-history:read"
  ];

  if (access?.canManageBlacklists || access?.canManageAllBlacklists) {
    permissions.push("blacklists:write");
  }
  if (access?.canManageAllBlacklists || BLACKLIST_ADMIN_ROLES.has(role)) {
    permissions.push("blacklists:write:all");
  } else if (access?.canManageOwnUserBlacklists || BLACKLIST_SELF_USER_ROLES.has(role)) {
    permissions.push("blacklists:users:create", "blacklists:users:delete-own");
  }

  if (access?.canManageSetup || access?.canManage) {
    permissions.push("setup:read");
  }

  if (access?.canManage || apiKeyIsAdminRole(role)) {
    permissions.push(
      "moderation:ban",
      "moderation:unban",
      "moderation:kick",
      "moderation:requests"
    );
  }

  const accessMap = group?.ACCESS || DEFAULT_ACCESS;
  for (const [action, roles] of Object.entries(accessMap || {})) {
    if (!Array.isArray(roles)) continue;
    if (roles.map(item => String(item).toLowerCase()).includes(role)) {
      permissions.push(`action:${action}`);
    }
  }

  return uniqueIds(permissions);
}

function normalizePermissionList(value) {
  if (Array.isArray(value)) return uniqueIds(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return uniqueIds(parsed);
    } catch {}
    return uniqueIds(trimmed.split(",").map(item => item.trim()).filter(Boolean));
  }
  return [];
}

function generateClientApiKey() {
  return `${CLIENT_API_KEY_PREFIX}_${crypto.randomBytes(32).toString("base64url")}`;
}

async function ensureClientApiKeyForUser(profile, group, session, access, options = {}) {
  const model = profile?.db?.ApiKey;
  if (!model) throw new Error("API key model is not available for this server.");

  const user = session?.user || {};
  const userId = String(user.id || "").trim();
  const groupId = normalizeGroupId(group?.groupid);
  if (!userId || !groupId) throw new Error("Missing user or group for API key generation.");

  const role = String(access?.role || "staff").trim().toLowerCase();
  const isAdmin = Boolean(access?.canManage || access?.canManageAllBlacklists || apiKeyIsAdminRole(role));
  const permissions = clientPermissionsForAccess(group, access);
  const displayName = user.global_name || user.globalName || user.username || userId;

  let row = await model.findOne({ where: { userId, groupId } }).catch(() => null);
  const shouldRegenerate = Boolean(options.regenerate || !row?.key);
  const key = shouldRegenerate ? generateClientApiKey() : row.key;

  const values = {
    guildId: String(profile.guildId || ""),
    groupId,
    userId,
    displayName,
    key,
    role,
    permissions,
    active: true,
    isAdmin,
    usageLimit: isAdmin ? 9999999 : 10000
  };

  if (row) {
    await row.update(values);
  } else {
    row = await model.create(values);
  }

  return row;
}

function buildClientAccessPayload({ config, profile, group, access, keyRow }) {
  const guildId = String(profile.guildId || "");
  const groupId = normalizeGroupId(group?.groupid);
  const dashboardBase = cleanBaseUrl(config.baseUrl);
  const clientApiBase = `${dashboardBase}/api/client`;
  const permissions = normalizePermissionList(
    keyRow?.permissions || clientPermissionsForAccess(group, access)
  );

  return {
    guildId,
    groupId,
    groupName: group?.groupName || groupId,
    authorizedGroups: listGroups(profile.config).map(serializeGroup),
    role: keyRow?.role || access?.role || "",
    isAdmin: Boolean(keyRow?.isAdmin || access?.canManage || access?.canManageAllBlacklists),
    permissions,
    headerName: CLIENT_API_HEADER,
    apiKey: keyRow?.key || "",
    dashboardEndpointUrl: dashboardBase,
    clientApiBase,
    clientScopePath: `${guildId}/${groupId}`,
      endpoints: {
        bootstrap: `${clientApiBase}/bootstrap`,
        overview: `${clientApiBase}/overview`,
        events: `${clientApiBase}/events`,
        users: `${clientApiBase}/users`,
        userProfile: `${clientApiBase}/users/:userId/profile`,
        blacklists: `${clientApiBase}/blacklists`,
        check: `${clientApiBase}/check/:userId`,
        automodCheck: `${clientApiBase}/automod/check/:userId`,
        avatarProfile: `${clientApiBase}/avatars/:avatarId/profile`,
        avatarAnalysis: `${clientApiBase}/avatar-analysis`,
        staff: `${clientApiBase}/staff`,
        globalHistory: `${clientApiBase}/global-history`,
        world: `${clientApiBase}/world`
    }
  };
}

function normalizeSafetyItems(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  const raw = value.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function normalizeSafetyItem(value, key = "") {
  let parsed = null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { parsed = JSON.parse(trimmed); } catch {}
    } else {
      parsed = trimmed;
    }
  } else if (value && typeof value === "object") {
    parsed = value;
  }
  if (parsed == null) return null;
  return normalizeSafetyEntry(key, parsed);
}

async function updateSafetyList(key, updater) {
  const listKey = allowedSafetyListKey(key);
  if (!listKey) return null;
  const registry = await loadSafetyRegistry();
  const current = Array.isArray(registry.lists[listKey]) ? registry.lists[listKey] : [];
  registry.lists[listKey] = normalizeSafetyList(listKey, updater(current));
  return saveSafetyRegistry(registry);
}

async function archiveSafetyItem(key, index, actor = {}) {
  const listKey = allowedSafetyListKey(key);
  if (!listKey) return null;

  const registry = await loadSafetyRegistry();
  const current = Array.isArray(registry.lists[listKey]) ? registry.lists[listKey] : [];
  if (!Number.isInteger(index) || index < 0 || index >= current.length) return null;

  const [item] = current.splice(index, 1);
  registry.lists[listKey] = current;
  registry.archive = registry.archive || {};
  registry.archive[listKey] = Array.isArray(registry.archive[listKey]) ? registry.archive[listKey] : [];
  registry.archive[listKey].push({
    item,
    archivedAt: new Date().toISOString(),
    archivedBy: actor.userId || "",
    archivedByName: actor.displayName || "",
    reason: "deleted-from-active-list"
  });

  return saveSafetyRegistry(registry);
}

function safetyListResponse(registry) {
  return {
    updatedAt: registry.updatedAt,
    lists: registry.lists,
    archiveCounts: Object.fromEntries(
      Object.keys(SAFETY_LISTS).map(key => [key, (registry.archive?.[key] || []).length])
    ),
    definitions: SAFETY_LISTS,
    endpoints: {
      safetyJson: "/safetyjson.json",
      domains: "/domains.json",
      all: "/api/safety",
      publicGroups: "/api/public/groups",
      avatarBlacklist: "/v5/games/api/vrchat/yoinker/avatarblacklist",
      blacklistUsers: "/v5/games/api/vrchat/yoinker/list",
      blacklistGroups: "/v5/games/api/vrchat/yoinker/groupslist",
      userCheck: "/v5/games/api/vrchat/yoinker/check/:userId",
      groupCheck: "/v5/games/api/vrchat/yoinker/groups/check/:groupId",
      userGroupCheck: "/v5/games/api/vrchat/yoinker/groups/check-user/:userId",
      counts: "/v5/games/api/vrchat/yoinker/count",
      getPrints: "/v5/games/api/vrchat/yoinker/getPrints/:printId",
      getSticker: "/v5/games/api/vrchat/yoinker/getSticker/:fileId",
      getInventorySticker: "/v5/games/api/vrchat/yoinker/getSticker/:userId/:inventoryItemId",
      printCheck: "/api/safety/prints/:printId",
      stickerCheck: "/api/safety/stickers/:fileId"
    }
  };
}

function configuredVrchatBackendUrls(loaded) {
  return uniqueIds(
    listProfiles(loaded)
      .map(profile => cleanBaseUrl(profile?.config?.VRCAPI?.VRCBackEndURL))
      .filter(Boolean)
  );
}

async function requestVrchatBackendJson(loaded, method, route, payload = null, options = {}) {
  const backendUrls = configuredVrchatBackendUrls(loaded);
  const normalizedMethod = String(method || "POST").toUpperCase();
  const loader = async () => {
    let lastError = "";
    for (const baseUrl of backendUrls) {
      try {
        const response = await axios({
          method: normalizedMethod,
          url: `${baseUrl}${route}`,
          data: normalizedMethod === "GET" ? undefined : payload || {},
          timeout: 15000,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
          }
        });
        return { ok: true, status: response.status || 200, data: response.data };
      } catch (err) {
        lastError = err.response?.data?.message || err.response?.statusText || err.message;
        if (err.response?.status && err.response.status < 500) {
          return {
            ok: false,
            status: err.response.status,
            data: err.response.data || { message: lastError }
          };
        }
      }
    }

    return {
      ok: false,
      status: backendUrls.length ? 502 : 503,
      data: {
        status: backendUrls.length ? 502 : 503,
        message: lastError || "No VRChat backend URL is configured."
      }
    };
  };

  if (!options.cache) return loader();
  return options.cache.wrap(
    ["vrchat-backend", normalizedMethod, backendUrls, route, payload || {}],
    loader,
    {
      ttlSeconds: options.ttlSeconds,
      skipCache: options.skipCache,
      cacheable: value => Number(value?.status || 0) > 0 && Number(value.status) < 500
    }
  );
}

async function postVrchatBackendJson(loaded, route, payload, options = {}) {
  return requestVrchatBackendJson(loaded, "POST", route, payload, options);
}

async function getVrchatBackendJson(loaded, route, options = {}) {
  return requestVrchatBackendJson(loaded, "GET", route, null, options);
}

function normalizeForwardedBackendResult(forwarded, fallbackMessage = "VRChat backend request complete.") {
  const raw = forwarded?.data && typeof forwarded.data === "object"
    ? forwarded.data
    : {};
  const status = Number(raw.status || forwarded?.status || 0) || (forwarded?.ok ? 200 : 502);
  return {
    status,
    message: raw.message || fallbackMessage,
    data: raw.data !== undefined ? raw.data : raw,
    raw,
    cache: forwarded?.cache || null
  };
}

function shouldBypassDashboardCache(query = {}) {
  return parseBoolean(query.bypassCache, false) || parseBoolean(query.noCache, false);
}

function clientMediaPayload(id, item, mediaKind) {
  if (!item) return null;
  if (item.data?.files?.image || item.data?.files?.file) return item;

  const image = item.files?.image || item.image || item.imageUrl || item.url || item.fileUrl || "";
  const file = item.files?.file || item.file || item.fileUrl || image || "";
  return {
    status: 200,
    message: `${mediaKind} found in safety registry.`,
    data: {
      id,
      ...((item && typeof item === "object") ? item : {}),
      files: {
        ...((item && typeof item === "object" && item.files) ? item.files : {}),
        image,
        file
      }
    }
  };
}

const STICKER_SAFETY_KEYS = [
  "fileId",
  "fileid",
  "stickerId",
  "stickerID",
  "inventoryItemId",
  "inventoryId",
  "id",
  "sticker.id",
  "inventory.id"
];

function stickerFileUrl(fileId) {
  const id = String(fileId || "").trim();
  return /^file_[A-Za-z0-9-]+$/.test(id)
    ? `https://api.vrchat.cloud/api/1/file/${encodeURIComponent(id)}/1/file`
    : "";
}

async function loadStickerPayload({ loaded, dashboardCache, registry, id, userId = "" }) {
  const stickerId = String(id || "").trim();
  const blocked = findSafetyItem(registry.lists.blocked_stickers, stickerId, STICKER_SAFETY_KEYS);
  const registryPayload = clientMediaPayload(stickerId, blocked, "Sticker");
  if (registryPayload?.data?.files?.image || registryPayload?.data?.files?.file) {
    return registryPayload;
  }

  const fileUrl = stickerFileUrl(stickerId);
  if (fileUrl) {
    return {
      status: 200,
      found: Boolean(blocked),
      fileId: stickerId,
      blocked: blocked || null,
      data: {
        id: stickerId,
        files: {
          image: fileUrl,
          file: fileUrl
        }
      },
      message: "Sticker file URL generated."
    };
  }

  const inventoryItemId = normalizeVrcInventoryItemId(stickerId);
  const normalizedUserId = normalizeVrcUserId(userId);
  if (!inventoryItemId || !normalizedUserId) {
    return {
      status: 400,
      found: Boolean(blocked),
      blocked: blocked || null,
      userId: normalizedUserId || String(userId || "").trim(),
      inventoryItemId: inventoryItemId || stickerId,
      message: "New sticker inventory lookups require usr_ userId and inv_ inventoryItemId."
    };
  }

  const forwarded = await getVrchatBackendJson(
    loaded,
    `/v1/vrchat/inventory/user/${encodeURIComponent(normalizedUserId)}/${encodeURIComponent(inventoryItemId)}`,
    { cache: dashboardCache }
  );
  if (forwarded.ok) {
    const backend = normalizeForwardedBackendResult(forwarded, "Sticker inventory item fetched.");
    return {
      status: backend.status,
      found: Boolean(blocked),
      userId: normalizedUserId,
      inventoryItemId,
      blocked: blocked || null,
      data: backend.data,
      cache: backend.cache,
      message: backend.message
    };
  }

  return {
    status: blocked ? 200 : forwarded.status,
    found: Boolean(blocked),
    userId: normalizedUserId,
    inventoryItemId,
    blocked: blocked || null,
    data: null,
    cache: forwarded.cache || null,
    message: blocked
      ? "Sticker is listed in the safety registry."
      : forwarded.data?.message || "Sticker inventory item could not be fetched."
  };
}

function userGroupRowsFromPayload(payload) {
  const raw = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];
  return raw.filter(item => item && typeof item === "object");
}

function idFromGroupRow(row) {
  return String(row?.groupId || row?.groupid || row?.id || row?.group?.id || "").trim();
}

function plain(row) {
  if (!row) return null;
  if (typeof row.get === "function") return row.get({ plain: true });
  return row;
}

function plainRows(rows) {
  return (rows || []).map(plain);
}

function parseLimit(value, fallback = 50, max = 200) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseOffset(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function safeCount(model, options = {}) {
  if (!model) return 0;
  try {
    return await model.count(options);
  } catch {
    try {
      return await model.count();
    } catch {
      return 0;
    }
  }
}

async function safeFindAll(model, options = {}) {
  if (!model) return [];
  try {
    return await model.findAll(options);
  } catch {
    return [];
  }
}

function modelSearchWhere(fields, query) {
  const q = String(query || "").trim();
  if (!q) return {};
  return {
    [Op.or]: fields.map(field => ({
      [field]: {
        [Op.like]: `%${q}%`
      }
    }))
  };
}

function hasModelField(model, field) {
  return Boolean(model?.rawAttributes?.[field]);
}

function groupScopedWhere(model, group, preferredField = "groupId") {
  const groupId = normalizeGroupId(group?.groupid);
  if (!model || !groupId) return {};
  if (hasModelField(model, preferredField)) return { [preferredField]: groupId };
  if (preferredField !== "groupId" && hasModelField(model, "groupId")) return { groupId };
  return {};
}

function buildEventWhere(query = {}) {
  const where = {};
  const eventType = String(query.type || "").trim();
  const q = String(query.q || "").trim();
  if (eventType) where.eventType = eventType;
  if (q) {
    where[Op.or] = [
      { eventId: { [Op.like]: `%${q}%` } },
      { eventType: { [Op.like]: `%${q}%` } },
      { description: { [Op.like]: `%${q}%` } },
      { targetId: { [Op.like]: `%${q}%` } }
    ];
  }
  return where;
}

async function getLocalModelsForGroup(profile, group) {
  if (!group?.groupid) throw new Error("No VRChat group configured for this Discord guild.");
  if (profile.db?.getLocalModels) return await profile.db.getLocalModels(group.groupid);
  return {
    GroupEvents: profile.db?.GroupEvents,
    GroupUserEvent: profile.db?.GroupUserEvent
  };
}

function sumUserEventColumnsLiteral() {
  return Sequelize.literal(
    "(bans + unbans + kicks + warnings + joins + leaves + remove + requestsend + requestreject)"
  );
}

async function loadOverview(profile, group) {
  const local = await getLocalModelsForGroup(profile, group);
  const globalStorePromise = initGlobalAnalytics().catch(() => null);
  const userBlacklistWhere = { blacklisted: true, ...groupScopedWhere(profile.db?.VRCBlacklist, group, "groupId") };
  const avatarBlacklistWhere = { blacklisted: true, ...groupScopedWhere(profile.db?.VRCAVIBlacklist, group, "groupId") };
  const groupBlacklistWhere = { blacklisted: true, ...groupScopedWhere(profile.db?.VRCBlacklistGroups, group, "sourceGroupId") };

  const [
    eventCount,
    userEventCount,
    activeUserBlacklists,
    activeAvatarBlacklists,
    activeGroupBlacklists,
    activeStaff,
    queueCount,
    recentEvents,
    topUsers,
    eventTypes,
    globalStore
  ] = await Promise.all([
    safeCount(local.GroupEvents),
    safeCount(local.GroupUserEvent),
    safeCount(profile.db?.VRCBlacklist, { where: userBlacklistWhere }),
    safeCount(profile.db?.VRCAVIBlacklist, { where: avatarBlacklistWhere }),
    safeCount(profile.db?.VRCBlacklistGroups, { where: groupBlacklistWhere }),
    safeCount(profile.db?.VRCStaffList, { where: { active: true } }),
    safeCount(profile.db?.VRCBLQueue, { where: { groupId: group.groupid } }),
    safeFindAll(local.GroupEvents, {
      order: [["createdAt", "DESC"]],
      limit: 10
    }),
    safeFindAll(local.GroupUserEvent, {
      order: [[sumUserEventColumnsLiteral(), "DESC"]],
      limit: 8
    }),
    safeFindAll(local.GroupEvents, {
      attributes: [
        "eventType",
        [Sequelize.fn("COUNT", Sequelize.col("eventType")), "count"]
      ],
      group: ["eventType"],
      order: [[Sequelize.literal("count"), "DESC"]],
      limit: 10,
      raw: true
    }),
    globalStorePromise
  ]);

  let globalHistory = [];
  let globalHistoryCount = 0;
  if (globalStore?.CommunityUserHistory) {
    const where = { guildId: String(profile.guildId), groupId: String(group.groupid) };
    [globalHistory, globalHistoryCount] = await Promise.all([
      safeFindAll(globalStore.CommunityUserHistory, {
        where,
        order: [["createdAt", "DESC"]],
        limit: 8
      }),
      safeCount(globalStore.CommunityUserHistory, { where })
    ]);
  }

  return {
    group: serializeGroup(group),
    counts: {
      events: eventCount,
      trackedUsers: userEventCount,
      userBlacklists: activeUserBlacklists,
      avatarBlacklists: activeAvatarBlacklists,
      groupBlacklists: activeGroupBlacklists,
      activeStaff,
      queue: queueCount,
      globalShares: globalHistoryCount
    },
    eventTypes: eventTypes.map(row => ({
      eventType: row.eventType,
      count: Number(row.count || 0)
    })),
    recentEvents: plainRows(recentEvents),
    topUsers: plainRows(topUsers),
    globalHistory: plainRows(globalHistory)
  };
}

async function loadEvents(profile, group, query) {
  const local = await getLocalModelsForGroup(profile, group);
  const limit = parseLimit(query.limit, 50, 200);
  const offset = parseOffset(query.offset);
  const where = buildEventWhere(query);
  const [rows, count, types] = await Promise.all([
    safeFindAll(local.GroupEvents, {
      where,
      order: [["createdAt", "DESC"]],
      limit,
      offset
    }),
    safeCount(local.GroupEvents, { where }),
    safeFindAll(local.GroupEvents, {
      attributes: [
        "eventType",
        [Sequelize.fn("COUNT", Sequelize.col("eventType")), "count"]
      ],
      group: ["eventType"],
      order: [["eventType", "ASC"]],
      raw: true
    })
  ]);

  return {
    rows: plainRows(rows),
    count,
    limit,
    offset,
    types: types.map(row => ({
      eventType: row.eventType,
      count: Number(row.count || 0)
    }))
  };
}

async function loadUsers(profile, group, query) {
  const local = await getLocalModelsForGroup(profile, group);
  const limit = parseLimit(query.limit, 50, 200);
  const offset = parseOffset(query.offset);
  const q = String(query.q || "").trim();
  const where = q ? { userId: { [Op.like]: `%${q}%` } } : {};
  const [rows, count] = await Promise.all([
    safeFindAll(local.GroupUserEvent, {
      where,
      order: [[sumUserEventColumnsLiteral(), "DESC"]],
      limit,
      offset
    }),
    safeCount(local.GroupUserEvent, { where })
  ]);

  return {
    rows: plainRows(rows),
    count,
    limit,
    offset
  };
}

function blacklistModelForKind(profile, kind) {
  switch (String(kind || "users").toLowerCase()) {
    case "avatars":
      return {
        label: "avatars",
        model: profile.db?.VRCAVIBlacklist,
        fields: ["displayName", "userId", "avatarId", "reason", "type", "moderator"],
        scopeField: "groupId",
        order: [["date", "DESC"]]
      };
    case "groups":
      return {
        label: "groups",
        model: profile.db?.VRCBlacklistGroups,
        fields: ["name", "groupID", "reason", "type", "moderator"],
        scopeField: "sourceGroupId",
        order: [["date", "DESC"]]
      };
    case "staff":
      return {
        label: "staff",
        model: profile.db?.VRCStaffList,
        fields: ["userId", "displayName", "role"],
        order: [["dateadded", "DESC"]]
      };
    case "queue":
      return {
        label: "queue",
        model: profile.db?.VRCBLQueue,
        fields: ["userId", "actions", "groupName", "groupId"],
        order: [["createdAt", "DESC"]]
      };
    default:
      return {
        label: "users",
        model: profile.db?.VRCBlacklist,
        fields: ["displayName", "userID", "reason", "type", "moderator"],
        scopeField: "groupId",
        order: [["date", "DESC"]]
      };
  }
}

async function loadBlacklists(profile, group, query) {
  const selected = blacklistModelForKind(profile, query.kind);
  const limit = parseLimit(query.limit, 50, 200);
  const offset = parseOffset(query.offset);
  const where = {
    ...groupScopedWhere(selected.model, group, selected.scopeField),
    ...modelSearchWhere(selected.fields, query.q)
  };
  if (hasModelField(selected.model, "archived")) {
    where.archived = parseBoolean(query.archived, false);
  }

  if (selected.label === "queue") {
    where.groupId = group.groupid;
  }

  const [rows, count] = await Promise.all([
    safeFindAll(selected.model, {
      where,
      order: selected.order,
      limit,
      offset
    }),
    safeCount(selected.model, { where })
  ]);

  return {
    kind: selected.label,
    rows: plainRows(rows),
    count,
    limit,
    offset
  };
}

function parseTags(value) {
  if (Array.isArray(value)) return value.map(item => String(item).toLowerCase());
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(item => String(item).toLowerCase());
    } catch {}
    return value.split(/[,\s]+/).map(item => item.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

function hasSafetySignal(row, names = []) {
  const type = String(row?.type || "").toLowerCase();
  const reason = String(row?.reason || "").toLowerCase();
  const tags = parseTags(row?.tags);
  return names.some(name => {
    const needle = String(name).toLowerCase();
    return type.includes(needle) || reason.includes(needle) || tags.includes(needle);
  });
}

function userCheckPayloadFromRow(row, userId, group, extra = {}) {
  const plainRow = plain(row) || {};
  const blacklisted = Boolean(plainRow.blacklisted);
  const payload = {
    status: blacklisted || extra.groups?.length ? 200 : 404,
    blacklisted: Boolean(blacklisted || extra.groups?.length),
    userId,
    displayName: plainRow.displayName || extra.displayName || "",
    reason: plainRow.reason || "",
    type: plainRow.type || "",
    date: plainRow.date || null,
    moderator: plainRow.moderator || "",
    source: {
      groupId: group?.groupid || "",
      groupName: group?.groupName || group?.groupid || ""
    },
    cyberbully: hasSafetySignal(plainRow, ["cyberbully", "cyber bully"]),
    crasher: hasSafetySignal(plainRow, ["crasher"]),
    ripper: hasSafetySignal(plainRow, ["ripper"]),
    troll: hasSafetySignal(plainRow, ["troll"]),
    clients: hasSafetySignal(plainRow, ["clients", "client"]),
    banned: hasSafetySignal(plainRow, ["banned", "ban"]),
    racism: hasSafetySignal(plainRow, ["racism", "racist"]),
    underaged: hasSafetySignal(plainRow, ["underaged", "underage"]),
    groups: extra.groups || []
  };

  if (!payload.blacklisted) {
    payload.message = "User not found in this group's blacklist.";
  }

  return payload;
}

async function loadClientUserCheck(profile, group, userId, options = {}) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return { status: 400, message: "VRChat user id is required." };

  const userWhere = {
    userID: normalizedUserId,
    blacklisted: true,
    ...groupScopedWhere(profile.db?.VRCBlacklist, group, "groupId")
  };
  const userRow = await profile.db?.VRCBlacklist?.findOne({ where: userWhere }).catch(() => null);

  let groupMatches = [];
  if (options.automod) {
    const scopedGroupRows = plainRows(await safeFindAll(profile.db?.VRCBlacklistGroups, {
      where: {
        blacklisted: true,
        ...groupScopedWhere(profile.db?.VRCBlacklistGroups, group, "sourceGroupId")
      },
      order: [["date", "DESC"]],
      limit: 500
    }));
    const blockedGroupMap = new Map(
      scopedGroupRows
        .map(row => [String(row.groupID || row.groupId || row.id || "").toLowerCase(), row])
        .filter(([id]) => id)
    );
    const forwarded = await postVrchatBackendJson(
      { profiles: [profile] },
      "/v1/vrchat/users/search/usergroups",
      { userid: normalizedUserId },
      { cache: options.cache }
    );
    const userGroups = forwarded.ok ? userGroupRowsFromPayload(forwarded.data) : [];
    groupMatches = userGroups
      .map(row => ({
        groupId: idFromGroupRow(row),
        name: row.name || row.groupName || idFromGroupRow(row),
        reason: blockedGroupMap.get(idFromGroupRow(row).toLowerCase())?.reason || "",
        type: blockedGroupMap.get(idFromGroupRow(row).toLowerCase())?.type || "",
        source: blockedGroupMap.get(idFromGroupRow(row).toLowerCase()) || null
      }))
      .filter(row => row.source);
  }

  return userCheckPayloadFromRow(userRow, normalizedUserId, group, { groups: groupMatches });
}

function parseWorldLookupQuery(query = {}) {
  const rawLocation = String(query.location || query.instance || query.worldLocation || "").trim();
  let worldId = String(query.worldId || query.worldid || "").trim();
  let instanceId = String(query.instanceId || query.instanceid || "").trim();

  if (!worldId && rawLocation) {
    const [locationWorldId, ...instanceParts] = rawLocation.split(":");
    worldId = String(locationWorldId || "").trim();
    instanceId = String(instanceParts.join(":") || instanceId).trim();
  }

  return {
    worldId,
    instanceId,
    location: rawLocation || (worldId ? `${worldId}${instanceId ? `:${instanceId}` : ""}` : "")
  };
}

function worldNameFromBackendPayload(result) {
  const data = result?.data || result || {};
  return (
    data.name ||
    data.worldName ||
    data.world?.name ||
    data.data?.name ||
    data.data?.world?.name ||
    ""
  );
}

async function loadClientWorldInfo(profile, query = {}, options = {}) {
  const lookup = parseWorldLookupQuery(query);
  if (!lookup.worldId) {
    return {
      status: 400,
      message: "worldId or location is required.",
      worldId: "",
      instanceId: "",
      location: ""
    };
  }

  const forwarded = await postVrchatBackendJson(
    { profiles: [profile] },
    "/v1/vrchat/world/worldInstance",
    { worldId: lookup.worldId, instanceId: lookup.instanceId },
    { cache: options.cache, skipCache: shouldBypassDashboardCache(query) }
  );
  const backend = normalizeForwardedBackendResult(forwarded, "World lookup complete.");
  return {
    status: backend.status || 200,
    message: backend.message || "World lookup complete.",
    worldId: lookup.worldId,
    instanceId: lookup.instanceId,
    location: lookup.location,
    name: worldNameFromBackendPayload(backend.raw || backend.data),
    data: backend.data || null,
    cache: backend.cache
  };
}

function normalizeVrcUserId(value) {
  const id = String(value || "").trim();
  return /^usr_[A-Za-z0-9_-]+$/.test(id) ? id : "";
}

function normalizeVrcAvatarId(value) {
  const id = String(value || "").trim();
  return /^avtr_[A-Za-z0-9_-]+$/.test(id) ? id : "";
}

function normalizeVrcInventoryItemId(value) {
  const id = String(value || "").trim();
  return /^inv_[A-Za-z0-9_-]+$/.test(id) ? id : "";
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return value;
  }
  return "";
}

function normalizeArrayValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return trimmed.split(/[,\n]/).map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeVrchatUserProfile(data, fallbackUserId = "") {
  const raw = data?.data && typeof data.data === "object" ? data.data : data || {};
  const userId = normalizeVrcUserId(raw.id || raw.userId || raw.userid || fallbackUserId);
  return {
    userId,
    displayName: String(raw.displayName || raw.username || raw.name || "").trim(),
    bio: raw.bio == null ? "" : String(raw.bio),
    bioLinks: normalizeArrayValue(raw.bioLinks),
    dateJoined: firstNonEmpty(raw.date_joined, raw.dateJoined, raw.joinedAt),
    lastPlatform: firstNonEmpty(raw.last_platform, raw.lastPlatform),
    currentAvatarId: firstNonEmpty(raw.currentAvatar, raw.currentAvatarId, raw.avatarId),
    currentAvatarImageUrl: firstNonEmpty(raw.currentAvatarImageUrl, raw.avatarImageUrl, raw.profilePicOverride),
    currentAvatarThumbnailImageUrl: firstNonEmpty(raw.currentAvatarThumbnailImageUrl, raw.currentAvatarThumbnail, raw.userIcon),
    raw
  };
}

function normalizeVrchatAvatarProfile(data, fallbackAvatarId = "") {
  const raw = data?.data && typeof data.data === "object" ? data.data : data || {};
  const avatarId = normalizeVrcAvatarId(raw.id || raw.avatarId || raw.avatarID || fallbackAvatarId);
  return {
    avatarId,
    name: String(raw.name || raw.avatarName || raw.displayName || "").trim(),
    authorId: String(raw.authorId || raw.ownerId || raw.userId || "").trim(),
    authorName: String(raw.authorName || raw.ownerName || raw.displayNameOwner || "").trim(),
    description: raw.description == null ? "" : String(raw.description),
    imageUrl: firstNonEmpty(raw.imageUrl, raw.thumbnailImageUrl, raw.image, raw.url),
    thumbnailImageUrl: firstNonEmpty(raw.thumbnailImageUrl, raw.imageUrl, raw.thumbnailUrl),
    releaseStatus: String(raw.releaseStatus || raw.release_status || "").trim(),
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : null,
    tags: normalizeArrayValue(raw.tags),
    raw
  };
}

async function upsertUserProfileCache(profile, userProfile, source = "dashboard-profile-fetch") {
  const model = profile.db?.VRCUserProfileCache;
  if (!model || !userProfile?.userId) return userProfile;

  const existing = await model.findOne({ where: { userId: userProfile.userId } }).catch(() => null);
  const existingPlain = plain(existing) || {};
  const oldName = String(existingPlain.displayName || "").trim();
  const newName = String(userProfile.displayName || oldName || "").trim();

  if (oldName && newName && oldName !== newName && profile.db?.VRCUserNameHistory) {
    const duplicate = await profile.db.VRCUserNameHistory.findOne({
      where: {
        userId: userProfile.userId,
        oldDisplayName: oldName,
        newDisplayName: newName
      }
    }).catch(() => null);
    if (!duplicate) {
      await profile.db.VRCUserNameHistory.create({
        userId: userProfile.userId,
        oldDisplayName: oldName,
        newDisplayName: newName,
        source
      }).catch(() => {});
    }
  }

  const values = {
    userId: userProfile.userId,
    displayName: newName,
    bio: userProfile.bio != null ? userProfile.bio : existingPlain.bio || "",
    bioLinks: userProfile.bioLinks != null ? userProfile.bioLinks : normalizeArrayValue(existingPlain.bioLinks),
    dateJoined: userProfile.dateJoined != null ? userProfile.dateJoined : existingPlain.dateJoined || "",
    lastPlatform: userProfile.lastPlatform != null ? userProfile.lastPlatform : existingPlain.lastPlatform || "",
    currentAvatarId: userProfile.currentAvatarId != null ? userProfile.currentAvatarId : existingPlain.currentAvatarId || "",
    currentAvatarImageUrl: userProfile.currentAvatarImageUrl != null ? userProfile.currentAvatarImageUrl : existingPlain.currentAvatarImageUrl || "",
    currentAvatarThumbnailImageUrl: userProfile.currentAvatarThumbnailImageUrl != null ? userProfile.currentAvatarThumbnailImageUrl : existingPlain.currentAvatarThumbnailImageUrl || "",
    raw: userProfile.raw || existingPlain.raw || null,
    lastFetchedAt: new Date()
  };

  if (existing) {
    await existing.update(values);
    return plain(existing);
  }
  const created = await model.create(values);
  return plain(created);
}

async function userNameHistoryRows(profile, userId) {
  return plainRows(await safeFindAll(profile.db?.VRCUserNameHistory, {
    where: { userId },
    order: [["observedAt", "DESC"]],
    limit: 100
  }));
}

function userProfileResponseFromCache(row, history = [], status = 200, message = "User profile fetched.") {
  const profile = plain(row) || {};
  return {
    status,
    message,
    user: {
      userId: profile.userId || "",
      displayName: profile.displayName || "",
      bio: profile.bio || "",
      bioLinks: normalizeArrayValue(profile.bioLinks),
      dateJoined: profile.dateJoined || "",
      lastPlatform: profile.lastPlatform || "",
      currentAvatarId: profile.currentAvatarId || "",
      currentAvatarImageUrl: profile.currentAvatarImageUrl || "",
      currentAvatarThumbnailImageUrl: profile.currentAvatarThumbnailImageUrl || "",
      lastFetchedAt: profile.lastFetchedAt || null
    },
    nameHistory: history,
    oldNames: uniqueIds(history.map(row => row.oldDisplayName).filter(Boolean)),
    data: profile.raw || null
  };
}

async function loadClientUserProfile(profile, userId, query = {}, options = {}) {
  const normalizedUserId = normalizeVrcUserId(userId);
  if (!normalizedUserId) return { status: 400, message: "Valid usr_ VRChat user id is required." };

  const shouldFetch = query.refresh == null
    ? !parseBoolean(query.cacheOnly, false)
    : parseBoolean(query.refresh, false);
  const cached = await profile.db?.VRCUserProfileCache?.findOne({ where: { userId: normalizedUserId } }).catch(() => null);
  let row = cached ? plain(cached) : null;
  let backendResult = null;

  if (shouldFetch || !row) {
    const forwarded = await postVrchatBackendJson(
      { profiles: [profile] },
      "/v1/vrchat/users/search/userid",
      { userid: normalizedUserId },
      { cache: options.cache, skipCache: shouldBypassDashboardCache(query) }
    ).catch(err => ({
      ok: false,
      status: 500,
      data: { status: 500, message: err?.message || "Failed to fetch user profile." }
    }));
    backendResult = normalizeForwardedBackendResult(forwarded, "User profile fetched.");
    const ok = Number(backendResult?.status || 0) >= 200 && Number(backendResult?.status || 0) < 300 && backendResult?.data;
    if (ok) {
      row = await upsertUserProfileCache(profile, normalizeVrchatUserProfile(backendResult.data, normalizedUserId));
    }
  }

  const history = await userNameHistoryRows(profile, normalizedUserId);
  if (row) {
    return userProfileResponseFromCache(row, history, 200, backendResult?.message || "User profile fetched.");
  }

  return {
    status: backendResult?.status || 404,
    message: backendResult?.message || "User profile was not found.",
    user: { userId: normalizedUserId },
    nameHistory: history,
    oldNames: []
  };
}

async function upsertAvatarProfileCache(profile, avatarProfile) {
  const model = profile.db?.VRCAvatarProfileCache;
  if (!model || !avatarProfile?.avatarId) return avatarProfile;
  const existing = await model.findOne({ where: { avatarId: avatarProfile.avatarId } }).catch(() => null);
  const existingPlain = plain(existing) || {};
  const values = {
    avatarId: avatarProfile.avatarId,
    name: avatarProfile.name || existingPlain.name || "",
    authorId: avatarProfile.authorId || existingPlain.authorId || "",
    authorName: avatarProfile.authorName || existingPlain.authorName || "",
    description: avatarProfile.description || existingPlain.description || "",
    imageUrl: avatarProfile.imageUrl || existingPlain.imageUrl || "",
    thumbnailImageUrl: avatarProfile.thumbnailImageUrl || existingPlain.thumbnailImageUrl || "",
    releaseStatus: avatarProfile.releaseStatus || existingPlain.releaseStatus || "",
    version: avatarProfile.version ?? existingPlain.version ?? null,
    tags: avatarProfile.tags?.length ? avatarProfile.tags : normalizeArrayValue(existingPlain.tags),
    raw: avatarProfile.raw || existingPlain.raw || null,
    lastFetchedAt: new Date()
  };
  if (existing) {
    await existing.update(values);
    return plain(existing);
  }
  const created = await model.create(values);
  return plain(created);
}

async function findAvatarBlacklistRow(profile, group, avatarId) {
  const where = {
    avatarId,
    ...groupScopedWhere(profile.db?.VRCAVIBlacklist, group, "groupId")
  };
  if (hasModelField(profile.db?.VRCAVIBlacklist, "archived")) where.archived = false;
  return plain(await profile.db?.VRCAVIBlacklist?.findOne({ where }).catch(() => null));
}

function avatarProfileResponse(row, blacklistRow = null, status = 200, message = "Avatar profile fetched.") {
  const avatar = plain(row) || {};
  return {
    status,
    message,
    avatar: {
      avatarId: avatar.avatarId || "",
      name: avatar.name || blacklistRow?.displayName || "",
      authorId: avatar.authorId || blacklistRow?.userId || "",
      authorName: avatar.authorName || "",
      description: avatar.description || "",
      imageUrl: avatar.imageUrl || "",
      thumbnailImageUrl: avatar.thumbnailImageUrl || "",
      releaseStatus: avatar.releaseStatus || "",
      version: avatar.version ?? null,
      tags: normalizeArrayValue(avatar.tags),
      lastFetchedAt: avatar.lastFetchedAt || null
    },
    blacklist: blacklistRow || null,
    data: avatar.raw || null
  };
}

async function loadClientAvatarProfile(profile, group, avatarId, query = {}, options = {}) {
  const normalizedAvatarId = normalizeVrcAvatarId(avatarId);
  if (!normalizedAvatarId) return { status: 400, message: "Valid avtr_ VRChat avatar id is required." };

  const ownerId = normalizeVrcUserId(query.ownerId || query.userId || query.authorId);
  const blacklistRow = await findAvatarBlacklistRow(profile, group, normalizedAvatarId);
  let row = await profile.db?.VRCAvatarProfileCache?.findOne({ where: { avatarId: normalizedAvatarId } }).catch(() => null);
  let backendMessage = "";

  const fetchOwnerId = ownerId || plain(row)?.authorId || blacklistRow?.userId || "";
  if ((parseBoolean(query.refresh, false) || !row) && fetchOwnerId) {
    const forwarded = await getVrchatBackendJson(
      { profiles: [profile] },
      `/v1/vrchat/avatars/useravatars/${encodeURIComponent(fetchOwnerId)}`,
      { cache: options.cache, skipCache: shouldBypassDashboardCache(query) }
    ).catch(err => ({
      ok: false,
      status: 500,
      data: { status: 500, message: err?.message || "Failed to fetch user avatars." }
    }));
    const result = normalizeForwardedBackendResult(forwarded, "User avatars fetched.");
    backendMessage = result?.message || "";
    const avatars = Array.isArray(result?.data)
      ? result.data
      : Array.isArray(result?.data?.avatars)
        ? result.data.avatars
        : [];
    const match = avatars.find(item => normalizeVrcAvatarId(item?.id || item?.avatarId) === normalizedAvatarId);
    if (match) {
      row = await upsertAvatarProfileCache(profile, normalizeVrchatAvatarProfile(match, normalizedAvatarId));
    }
  }

  if (row || blacklistRow) {
    return avatarProfileResponse(row || {
      avatarId: normalizedAvatarId,
      name: blacklistRow?.displayName || "",
      authorId: blacklistRow?.userId || ""
    }, blacklistRow, 200, backendMessage || "Avatar profile fetched.");
  }

  return {
    status: 404,
    message: fetchOwnerId
      ? "Avatar was not found in the owner's avatar list or local cache."
      : "Avatar profile not cached yet. Send ownerId=user usr_... to fetch from backend user avatars.",
    avatar: { avatarId: normalizedAvatarId },
    blacklist: null,
    data: null
  };
}

async function loadClientAvatarAnalysis(profile, body = {}, options = {}) {
  const fileId = String(body.fileId || body.fileid || "").trim();
  const fileVersion = String(body.fileVersion || body.fileversion || body.version || "").trim();
  if (!/^file_[A-Za-z0-9-]+$/.test(fileId)) {
    return { status: 400, message: "Valid file_ avatar asset id is required." };
  }
  const payload = { fileId };
  if (fileVersion) payload.fileVersion = fileVersion;
  const forwarded = await postVrchatBackendJson(
    { profiles: [profile] },
    "/v1/vrchat/avatars/analysis",
    payload,
    { cache: options.cache, skipCache: shouldBypassDashboardCache(body) }
  );
  const backend = normalizeForwardedBackendResult(forwarded, "Avatar analysis fetched.");
  return {
    status: backend.status,
    message: backend.message,
    data: backend.data,
    cache: backend.cache
  };
}

async function loadPublicGroupShares(loaded, registry) {
  const rows = [...publicGroupBlacklistForProxy(registry)];
  for (const profile of listProfiles(loaded)) {
    const model = profile.db?.VRCBlacklistGroups;
    if (!model || !hasModelField(model, "public")) continue;
    const where = { public: true, blacklisted: true };
    if (hasModelField(model, "archived")) where.archived = false;
    const dbRows = plainRows(await safeFindAll(model, {
      where,
      order: [["date", "DESC"]],
      limit: 500
    }));
    for (const row of dbRows) {
      const type = String(row.type || "UNKNOWN").toUpperCase();
      if (publicGroupBlacklistForProxy({ lists: { blacklist_groups: [row] } }).length === 0) continue;
      const sourceGroup = listGroups(profile.config).find(group => group.groupid === row.sourceGroupId);
      rows.push({
        ...row,
        type,
        groupID: row.groupID || row.groupId || row.id || "",
        name: row.name || row.groupName || row.groupID || "",
        sourceGuildId: profile.guildId,
        sourceGroupId: row.sourceGroupId || "",
        sourceGroupName: sourceGroup?.groupName || row.sourceGroupId || ""
      });
    }
  }
  return rows;
}

function blacklistWriteConfig(profile, kind) {
  const selected = blacklistModelForKind(profile, kind);
  if (!["users", "avatars", "groups"].includes(selected.label) || !selected.model) return null;
  return selected;
}

function sessionActorId(session) {
  return String(session?.user?.id || "").trim();
}

function applyBlacklistAuditFields(model, payload, session, mode) {
  const actorId = sessionActorId(session);
  if (!actorId) return payload;
  const next = { ...payload };
  if (mode === "create" && hasModelField(model, "createdBy")) next.createdBy = actorId;
  if (hasModelField(model, "updatedBy")) next.updatedBy = actorId;
  return next;
}

function actorOwnsBlacklistRow(row, session) {
  const actorId = sessionActorId(session);
  if (!actorId) return false;
  const plainRow = plain(row) || {};
  return [
    plainRow.createdBy,
    plainRow.updatedBy,
    plainRow.moderator,
    plainRow.archivedBy
  ].some(value => String(value || "").trim() === actorId);
}

function canMutateBlacklistRow(access, kind, mode, row = null, session = null) {
  if (access?.canManageAllBlacklists) return true;
  const isOwnUserRole = access?.blacklistAccess === "own-users";
  if (!isOwnUserRole || kind !== "users") return false;
  if (mode === "create") return true;
  if (mode === "archive") return actorOwnsBlacklistRow(row, session);
  return false;
}

function cleanBlacklistPayload(kind, body = {}, group = null, session = null) {
  const moderator = body.moderator || session?.user?.global_name || session?.user?.username || session?.user?.id || "";
  const common = {
    reason: String(body.reason || "").trim(),
    type: String(body.type || "UNKNOWN").trim().toUpperCase(),
    tags: Array.isArray(body.tags) ? body.tags : [],
    moderator,
    blacklisted: body.blacklisted == null ? true : parseBoolean(body.blacklisted, true),
    archived: false,
    archivedAt: null,
    archivedBy: null
  };

  if (kind === "avatars") {
    return {
      ...common,
      groupId: normalizeGroupId(group?.groupid),
      displayName: String(body.displayName || body.name || "").trim(),
      userId: String(body.userId || body.userID || "").trim(),
      avatarId: String(body.avatarId || body.avatarID || body.id || "").trim()
    };
  }

  if (kind === "groups") {
    return {
      ...common,
      sourceGroupId: normalizeGroupId(group?.groupid),
      name: String(body.name || body.groupName || body.displayName || "").trim(),
      groupID: normalizeGroupId(body.groupID || body.groupId || body.groupid || body.id),
      public: parseBoolean(body.public, false)
    };
  }

  return {
    ...common,
    groupId: normalizeGroupId(group?.groupid),
    displayName: String(body.displayName || body.name || "").trim(),
    userID: String(body.userID || body.userId || body.id || "").trim(),
    watchlist: parseBoolean(body.watchlist, false)
  };
}

async function mutateBlacklistRow({ profile, group, kind, id, body, session, access, mode }) {
  const selected = blacklistWriteConfig(profile, kind);
  if (!selected) return { status: 404, error: "Blacklist kind must be users, avatars, or groups." };

  if (mode === "create") {
    if (!canMutateBlacklistRow(access, selected.label, mode, null, session)) {
      return { status: 403, error: "This staff role cannot add this blacklist kind." };
    }
    const payload = applyBlacklistAuditFields(
      selected.model,
      cleanBlacklistPayload(selected.label, body, group, session),
      session,
      "create"
    );
    const row = await selected.model.create(payload);
    return { status: 201, row: plain(row) };
  }

  const where = {
    id,
    ...groupScopedWhere(selected.model, group, selected.scopeField)
  };
  const row = await selected.model.findOne({ where }).catch(() => null);
  if (!row) return { status: 404, error: "Blacklist row not found for this group." };
  if (!canMutateBlacklistRow(access, selected.label, mode, row, session)) {
    return { status: 403, error: "This staff role can only delete user blacklist rows they created." };
  }

  if (mode === "archive") {
    if (hasModelField(selected.model, "archived")) {
      await row.update({
        blacklisted: false,
        archived: true,
        archivedAt: new Date(),
        archivedBy: session?.user?.id || ""
      });
    } else {
      await row.destroy();
    }
    return { status: 200, row: plain(row) };
  }

  const payload = applyBlacklistAuditFields(
    selected.model,
    cleanBlacklistPayload(selected.label, { ...plain(row), ...body }, group, session),
    session,
    "update"
  );
  await row.update(payload);
  return { status: 200, row: plain(row) };
}

async function loadGlobalHistory(profile, group, query) {
  const store = await initGlobalAnalytics().catch(() => null);
  if (!store?.CommunityUserHistory) {
    return { rows: [], count: 0, limit: 50, offset: 0 };
  }

  const limit = parseLimit(query.limit, 50, 200);
  const offset = parseOffset(query.offset);
  const q = String(query.q || "").trim();
  const where = {
    guildId: String(profile.guildId),
    groupId: String(group.groupid)
  };
  if (q) {
    where[Op.or] = [
      { vrcUserId: { [Op.like]: `%${q}%` } },
      { action: { [Op.like]: `%${q}%` } },
      { sharedByDiscordTag: { [Op.like]: `%${q}%` } }
    ];
  }

  const [rows, count] = await Promise.all([
    safeFindAll(store.CommunityUserHistory, {
      where,
      order: [["createdAt", "DESC"]],
      limit,
      offset
    }),
    safeCount(store.CommunityUserHistory, { where })
  ]);

  return {
    rows: plainRows(rows),
    count,
    limit,
    offset
  };
}

function toTimeValue(value) {
  if (!value) return "";
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? String(time) : String(value);
}

async function loadLiveSnapshot(profile, group) {
  const local = await getLocalModelsForGroup(profile, group);
  const globalStorePromise = initGlobalAnalytics().catch(() => null);
  const userBlacklistWhere = { blacklisted: true, ...groupScopedWhere(profile.db?.VRCBlacklist, group, "groupId") };
  const avatarBlacklistWhere = { blacklisted: true, ...groupScopedWhere(profile.db?.VRCAVIBlacklist, group, "groupId") };
  const groupBlacklistWhere = { blacklisted: true, ...groupScopedWhere(profile.db?.VRCBlacklistGroups, group, "sourceGroupId") };
  const latestEventPromise = safeFindAll(local.GroupEvents, {
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    limit: 1
  });

  const [
    eventCount,
    userEventCount,
    activeUserBlacklists,
    activeAvatarBlacklists,
    activeGroupBlacklists,
    activeStaff,
    queueCount,
    latestEvents,
    globalStore
  ] = await Promise.all([
    safeCount(local.GroupEvents),
    safeCount(local.GroupUserEvent),
    safeCount(profile.db?.VRCBlacklist, { where: userBlacklistWhere }),
    safeCount(profile.db?.VRCAVIBlacklist, { where: avatarBlacklistWhere }),
    safeCount(profile.db?.VRCBlacklistGroups, { where: groupBlacklistWhere }),
    safeCount(profile.db?.VRCStaffList, { where: { active: true } }),
    safeCount(profile.db?.VRCBLQueue, { where: { groupId: group.groupid } }),
    latestEventPromise,
    globalStorePromise
  ]);

  let globalShares = 0;
  if (globalStore?.CommunityUserHistory) {
    globalShares = await safeCount(globalStore.CommunityUserHistory, {
      where: { guildId: String(profile.guildId), groupId: String(group.groupid) }
    });
  }

  const latestEvent = plain(latestEvents?.[0]);
  const counts = {
    events: eventCount,
    trackedUsers: userEventCount,
    userBlacklists: activeUserBlacklists,
    avatarBlacklists: activeAvatarBlacklists,
    groupBlacklists: activeGroupBlacklists,
    activeStaff,
    queue: queueCount,
    globalShares
  };
  const latestUpdatedAt = toTimeValue(latestEvent?.updatedAt || latestEvent?.createdAt);
  const revision = [
    group.groupid,
    ...Object.values(counts),
    latestEvent?.id || "",
    latestEvent?.eventId || "",
    latestUpdatedAt
  ].join("|");

  return {
    ts: Date.now(),
    revision,
    counts,
    latestEvent: latestEvent
      ? {
          id: latestEvent.id,
          eventId: latestEvent.eventId,
          eventType: latestEvent.eventType,
          targetId: latestEvent.targetId,
          description: latestEvent.description,
          createdAt: latestEvent.createdAt,
          updatedAt: latestEvent.updatedAt
        }
      : null
  };
}

function sendSetupResponse(res, config) {
  return res.status(503).json({
    setupRequired: true,
    missing: config.missing,
    message: "Dashboard OAuth is not fully configured.",
    expectedRedirectUri: config.redirectUri
  });
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function startDashboard({ loaded, client, defaultPort } = {}) {
  // One bot client serves the single configured Discord server.
  const clients = client ? [client] : [];
  const config = resolveDashboardConfig(loaded, { defaultPort });
  if (!config.enabled) {
    console.log("[DASHBOARD] Disabled.");
    return null;
  }

  if (dashboardServer) return dashboardServer;

  const dashboardCache = createDashboardCache(resolveDashboardCacheConfig(loaded), console);
  if (dashboardCache.enabled) {
    console.log(`[DASHBOARD CACHE] ${dashboardCache.redisEnabled ? "Redis" : "Memory"} cache enabled for VRChat backend reads (${dashboardCache.ttlSeconds}s TTL).`);
  } else {
    console.log("[DASHBOARD CACHE] Disabled.");
  }

  const app = express();
  const sessions = new Map();
  const oauthStates = new Map();
  const signer = createSigner(config.sessionSecret);
  const homeHtmlPath = path.join(__dirname, "..", "templates", "dashboard", "home.html");
  const dashboardHtmlPath = path.join(__dirname, "..", "templates", "dashboard", "index.html");
  const adminSafetyHtmlPath = path.join(__dirname, "..", "templates", "dashboard", "admin-safety.html");
  const privacyHtmlPath = path.join(__dirname, "..", "templates", "dashboard", "privacy.html");
  const termsHtmlPath = path.join(__dirname, "..", "templates", "dashboard", "terms.html");
  let privacySyncTimer = null;

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  function runPrivacySync() {
    syncAllGroupMembershipVisibility(loaded).catch(err => {
      console.warn(`[DASHBOARD] Hidden VRChat membership visibility sync failed: ${err.message}`);
    });
  }

  async function userCanManageProfileByDiscord(profile, userId) {
    const id = String(userId || "").trim();
    if (!id || !profile?.guildId) return false;
    const guild = await findBotGuild(clients, profile.guildId);
    if (!guild) return false;
    if (String(guild.ownerId || "") === id) return true;
    const member = await guild.members?.fetch?.(id).catch(() => null);
    const bitfield = member?.permissions?.bitfield;
    return typeof bitfield === "bigint"
      ? (bitfield & ADMINISTRATOR_PERMISSION) === ADMINISTRATOR_PERMISSION
      : Boolean(member?.permissions?.has?.("Administrator"));
  }

  app.use((req, res, next) => {
    cleanupExpiringMaps(sessions, oauthStates);
    const cookies = parseCookies(req.headers.cookie || "");
    const unsigned = signer.unsign(cookies[config.cookieName]);
    const session = unsigned ? sessions.get(unsigned) : null;
    if (session && session.expiresAt > Date.now()) {
      req.dashboardSession = session;
    }
    next();
  });

  function requireAuth(req, res, next) {
    if (!config.configured) return sendSetupResponse(res, config);
    if (!req.dashboardSession) {
      return res.status(401).json({
        error: "Not authenticated",
        loginUrl: "/auth/discord"
      });
    }
    return next();
  }

  function requireWebAuth(req, res, next) {
    if (!config.configured) return res.redirect("/dashboard?setup=1");
    if (!req.dashboardSession) {
      return res.redirect(`/auth/discord?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }
    return next();
  }

  function requireAdminApiAuth(req, res, next) {
    if (!config.configured) return sendSetupResponse(res, config);
    if (!req.dashboardSession) {
      return res.status(401).json({
        error: "Not authenticated",
        loginUrl: "/auth/discord"
      });
    }
    if (!isDashboardAdmin(req.dashboardSession, loaded)) {
      return res.status(403).json({ error: "Bot admin access is required." });
    }
    return next();
  }

  function requireAdminWebAuth(req, res, next) {
    if (!config.configured) return res.redirect("/dashboard?setup=1");
    if (!req.dashboardSession) {
      return res.redirect(`/auth/discord?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }
    if (!isDashboardAdmin(req.dashboardSession, loaded)) {
      return res.status(403).send("Bot admin access is required.");
    }
    return next();
  }

  async function resolveAccessibleProfileFromRequest(req, res) {
    const profile = listProfiles(loaded).find(
      item => String(item.guildId) === String(req.params.guildId)
    );
    const access = profile ? await getProfileAccess(req.dashboardSession, profile) : null;
    if (!profile || !access?.canAccess) {
      res.status(403).json({ error: "You do not have dashboard access to this Discord server." });
      return null;
    }
    return { profile, access };
  }

  async function resolveManageableProfileFromRequest(req, res) {
    const resolved = await resolveAccessibleProfileFromRequest(req, res);
    if (!resolved) return null;
    if (!resolved.access.canManageSetup && !resolved.access.canManage) {
      res.status(403).json({ error: "Discord server owner/admin or VRC staff owner/co-owner access is required." });
      return null;
    }
    return resolved;
  }

  async function resolveBlacklistWriteProfileFromRequest(req, res, kind, mode) {
    const resolved = await resolveAccessibleProfileFromRequest(req, res);
    if (!resolved) return null;

    const selectedKind = String(kind || "users").toLowerCase();
    const access = resolved.access || {};
    if (access.canManageAllBlacklists) return resolved;

    const ownUserWrite =
      access.blacklistAccess === "own-users" &&
      selectedKind === "users" &&
      (mode === "create" || mode === "archive");

    if (!ownUserWrite) {
      res.status(403).json({
        error: "This staff role can only add user blacklist rows and delete user blacklist rows they created."
      });
      return null;
    }

    return resolved;
  }

  async function resolveProfileFromRequest(req, res) {
    const resolved = await resolveAccessibleProfileFromRequest(req, res);
    if (!resolved) return null;
    const { profile, access } = resolved;

    const { group } = resolveGroup(profile, req.query.groupId);
    if (!group) {
      res.status(404).json({ error: "No VRChat group is configured for this Discord server." });
      return null;
    }

    return { profile, group, access };
  }

  async function resolveClientApiRequest(req, res) {
    const routeGuildId = String(req.params.guildId || "").trim();
    const requestedGroupId = normalizeGroupId(
      req.params.groupId ||
        req.query.groupId ||
        req.get("x-vrchat-group-id")
    );
    const apiKey = String(req.get(CLIENT_API_HEADER) || req.query.apiKey || "").trim();
    if (!apiKey) {
      res.status(401).json({ status: 401, message: `Missing ${CLIENT_API_HEADER} header.` });
      return null;
    }

    let profile = null;
    let keyRow = null;
    for (const candidate of listProfiles(loaded)) {
      if (routeGuildId && String(candidate.guildId) !== routeGuildId) continue;
      const found = await candidate.db?.ApiKey?.findOne({
        where: {
          key: apiKey,
          active: true
        }
      }).catch(() => null);
      if (found) {
        profile = candidate;
        keyRow = found;
        break;
      }
    }

    if (!profile || !keyRow) {
      res.status(403).json({ status: 403, message: "Invalid API key." });
      return null;
    }

    const discordManager = await userCanManageProfileByDiscord(profile, keyRow.userId);
    const staff = await getStaffAccess(profile, keyRow.userId);
    if (!discordManager && !staff) {
      res.status(403).json({ status: 403, message: "This API key is no longer authorized." });
      return null;
    }

    const trackedGroups = listGroups(profile.config);
    const selectedGroupId = requestedGroupId || normalizeGroupId(keyRow.groupId) || normalizeGroupId(trackedGroups[0]?.groupid);
    const group = trackedGroups.find(item => item.groupid === selectedGroupId);
    if (!group) {
      res.status(404).json({ status: 404, message: "VRChat group is not configured for this API key's Discord server." });
      return null;
    }

    const currentRole = String(keyRow.role || "").trim().toLowerCase();
    const role = discordManager
      ? (currentRole.startsWith("discord-") ? currentRole : "discord-admin")
      : staff.role;
    const canManageSetup = Boolean(discordManager || staff?.canManageSetup);
    const blacklistAccess = discordManager ? "admin" : staff?.blacklistAccess || "read";
    const canManageAllBlacklists = blacklistAccess === "admin";
    const canManageOwnUserBlacklists = canManageAllBlacklists || blacklistAccess === "own-users";
    const access = {
      canAccess: true,
      canManage: canManageSetup,
      canManageSetup,
      canManageBlacklists: canManageAllBlacklists || blacklistAccess === "own-users",
      canManageAllBlacklists,
      canManageOwnUserBlacklists,
      blacklistAccess,
      role,
      source: discordManager ? "discord" : "staff"
    };
    const permissions = clientPermissionsForAccess(group, access);
    const keyIsAdmin = Boolean(access.canManage || access.canManageAllBlacklists || apiKeyIsAdminRole(role));

    if (
      Boolean(keyRow.isAdmin) !== keyIsAdmin ||
      String(keyRow.role || "") !== role ||
      JSON.stringify(normalizePermissionList(keyRow.permissions)) !== JSON.stringify(permissions)
    ) {
      await keyRow.update({
        isAdmin: keyIsAdmin,
        role,
        permissions
      }).catch(() => {});
    }
    await keyRow.update({ lastUsedAt: new Date() }).catch(() => {});
    return { profile, group, keyRow, access };
  }

  async function clientApiBootstrapPayload(resolved) {
    const dashboardBase = cleanBaseUrl(config.baseUrl);
    const clientApiBase = `${dashboardBase}/api/client`;
    const groups = listGroups(resolved.profile.config).map(serializeGroup);
    const permissions = normalizePermissionList(
      resolved.keyRow.permissions || clientPermissionsForAccess(resolved.group, resolved.access)
    );
    return {
      status: 200,
      message: "Client API access accepted.",
      guildId: resolved.profile.guildId,
      group: serializeGroup(resolved.group),
      authorizedGroups: groups,
      dashboardEndpointUrl: dashboardBase,
      clientApiBase,
      clientScopePath: `${resolved.profile.guildId}/${resolved.group.groupid}`,
      profile: {
        discordId: resolved.keyRow.userId,
        displayName: resolved.keyRow.displayName
      },
      key: {
        userId: resolved.keyRow.userId,
        displayName: resolved.keyRow.displayName,
        role: resolved.keyRow.role,
        isAdmin: Boolean(resolved.keyRow.isAdmin),
        permissions
      },
      endpoints: {
        bootstrap: "/api/client/bootstrap",
        overview: "/api/client/overview",
        events: "/api/client/events",
        users: "/api/client/users",
        userProfile: "/api/client/users/:userId/profile",
        blacklists: "/api/client/blacklists",
        check: "/api/client/check/:userId",
        automodCheck: "/api/client/automod/check/:userId",
        avatarProfile: "/api/client/avatars/:avatarId/profile",
        avatarAnalysis: "/api/client/avatar-analysis",
        staff: "/api/client/staff",
        globalHistory: "/api/client/global-history",
        world: "/api/client/world?worldId=:worldId"
      }
    };
  }

  app.get("/", (req, res) => {
    res.sendFile(homeHtmlPath);
  });

  app.get("/dashboard", (req, res) => {
    res.sendFile(dashboardHtmlPath);
  });

  app.get("/privacy", (req, res) => {
    res.sendFile(privacyHtmlPath);
  });

  app.get("/terms", (req, res) => {
    res.sendFile(termsHtmlPath);
  });

  app.get("/admin/safety", requireAdminWebAuth, (req, res) => {
    res.sendFile(adminSafetyHtmlPath);
  });

  app.get("/auth/discord", (req, res) => {
    if (!config.configured) {
      return res.redirect("/dashboard?setup=1");
    }

    const state = crypto.randomBytes(24).toString("hex");
    oauthStates.set(state, {
      createdAt: Date.now(),
      returnTo: safeReturnTo(req.query.returnTo)
    });

    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "identify guilds");
    url.searchParams.set("state", state);
    return res.redirect(url.toString());
  });

  app.get("/auth/discord/callback", asyncRoute(async (req, res) => {
    if (!config.configured) {
      return res.redirect("/dashboard?setup=1");
    }

    const state = String(req.query.state || "");
    const code = String(req.query.code || "");
    const statePayload = oauthStates.get(state);
    oauthStates.delete(state);

    if (!statePayload || !code) {
      return res.status(400).send("Invalid or expired Discord login state.");
    }

    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri
    });

    const tokenResponse = await axios.post(
      `${DISCORD_API}/oauth2/token`,
      body.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15000
      }
    );

    const accessToken = tokenResponse.data?.access_token;
    if (!accessToken) return res.status(401).send("Discord did not return an access token.");

    const headers = { Authorization: `Bearer ${accessToken}` };
    const [userResponse, guildsResponse] = await Promise.all([
      axios.get(`${DISCORD_API}/users/@me`, { headers, timeout: 15000 }),
      axios.get(`${DISCORD_API}/users/@me/guilds`, { headers, timeout: 15000 })
    ]);

    const id = crypto.randomBytes(32).toString("base64url");
    sessions.set(id, {
      id,
      user: userResponse.data,
      guilds: guildsResponse.data || [],
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS
    });

    setSessionCookie(res, config, signer.sign(id));
    return res.redirect(statePayload.returnTo || "/dashboard");
  }));

  app.get("/auth/logout", (req, res) => {
    const cookies = parseCookies(req.headers.cookie || "");
    const unsigned = signer.unsign(cookies[config.cookieName]);
    if (unsigned) sessions.delete(unsigned);
    clearSessionCookie(res, config);
    return res.redirect("/dashboard");
  });

  app.get("/safetyjson.json", asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json({
      updatedAt: registry.updatedAt,
      ipgrabber_domains: registry.lists.ipgrabber_domains || []
    });
  }));

  app.get("/domains.json", asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json({
      updatedAt: registry.updatedAt,
      Internal: (registry.lists.trusted_internal_domains || []).map(item => (
        typeof item === "string" ? { url: item } : item
      ))
    });
  }));

  app.get("/api/safety", asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    const payload = publicSafetyPayload(registry);
    payload.blacklist_groups = await loadPublicGroupShares(loaded, registry);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json(payload);
  }));

  app.get("/api/public/groups", asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    const type = String(req.query.type || "").trim().toUpperCase();
    const q = String(req.query.q || "").trim().toLowerCase();
    let groups = await loadPublicGroupShares(loaded, registry);
    if (type) groups = groups.filter(item => String(item.type || "").toUpperCase() === type);
    if (q) {
      groups = groups.filter(item => [
        item.name,
        item.groupName,
        item.groupID,
        item.groupId,
        item.reason,
        item.type
      ].some(value => String(value || "").toLowerCase().includes(q)));
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json({
      status: 200,
      updatedAt: registry.updatedAt,
      groups
    });
  }));

  app.get("/api/safety/:listKey", asyncRoute(async (req, res) => {
    const listKey = allowedSafetyListKey(req.params.listKey);
    if (!listKey) return res.status(404).json({ error: "Unknown safety list." });
    const registry = await loadSafetyRegistry();
    const items = listKey === "blacklist_groups"
      ? await loadPublicGroupShares(loaded, registry)
      : registry.lists[listKey] || [];
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json({
      updatedAt: registry.updatedAt,
      key: listKey,
      items
    });
  }));

  app.get("/api/safety/prints/:printId", asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    const item = findSafetyItem(registry.lists.blocked_prints, req.params.printId, ["printId", "printid", "id", "print.id"]);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json({
      status: item ? 200 : 404,
      found: Boolean(item),
      printId: req.params.printId,
      data: item || null
    });
  }));

  app.get("/api/safety/groups/:groupId", asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    const item = findSafetyItem(await loadPublicGroupShares(loaded, registry), req.params.groupId, ["groupID", "groupId", "groupid", "id", "group.id"]);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json({
      status: item ? 200 : 404,
      found: Boolean(item),
      groupId: req.params.groupId,
      data: item || null
    });
  }));

  app.get("/api/safety/stickers/:fileId", asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    const item = findSafetyItem(registry.lists.blocked_stickers, req.params.fileId, STICKER_SAFETY_KEYS);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json({
      status: item ? 200 : 404,
      found: Boolean(item),
      fileId: req.params.fileId,
      data: item || null
    });
  }));

  app.get("/v5/games/api/vrchat/yoinker/avatarblacklist", asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json(avatarBlacklistForProxy(registry));
  }));

  app.get("/v5/games/api/vrchat/yoinker/count", asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json(safetyCountsForProxy(registry));
  }));

  app.get("/v5/games/api/vrchat/yoinker/list", asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json(registry.lists.blacklist_users || []);
  }));

  app.get("/v5/games/api/vrchat/yoinker/groupslist", asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json(await loadPublicGroupShares(loaded, registry));
  }));

  app.get("/v5/games/api/vrchat/yoinker/groups/check/:groupId", asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    const item = findSafetyItem(await loadPublicGroupShares(loaded, registry), req.params.groupId, ["groupID", "groupId", "groupid", "id", "group.id"]);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json(item || {
      status: 404,
      found: false,
      message: "Group not found in safety list.",
      groupId: req.params.groupId
    });
  }));

  app.get("/v5/games/api/vrchat/yoinker/groups/check-user/:userId", asyncRoute(async (req, res) => {
    const userId = String(req.params.userId || "").trim();
    const registry = await loadSafetyRegistry();
    const forwarded = await postVrchatBackendJson(
      loaded,
      "/v1/vrchat/users/search/usergroups",
      { userid: userId },
      { cache: dashboardCache }
    );
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (!forwarded.ok) {
      return res.status(forwarded.status).json({
        status: forwarded.status,
        found: false,
        userId,
        matches: [],
        message: forwarded.data?.message || "User groups could not be fetched."
      });
    }

    const groups = userGroupRowsFromPayload(forwarded.data);
    const publicGroups = await loadPublicGroupShares(loaded, registry);
    const matches = groups
      .map(row => ({
        group: row,
        safety: findSafetyItem(publicGroups, idFromGroupRow(row), ["groupID", "groupId", "groupid", "id", "group.id"])
      }))
      .filter(row => row.safety);

    return res.json({
      status: 200,
      found: matches.length > 0,
      userId,
      groups,
      matches
    });
  }));

  app.get("/v5/games/api/vrchat/yoinker/check/:userId", asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    const item = findSafetyItem(registry.lists.blacklist_users, req.params.userId, ["userId", "userID", "id", "user.id"]);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json(item || {
      status: 404,
      found: false,
      message: "User not found in safety list.",
      userId: req.params.userId
    });
  }));

  app.get("/v5/games/api/vrchat/yoinker/getPrints/:printId", asyncRoute(async (req, res) => {
    const printId = String(req.params.printId || "").trim();
    const registry = await loadSafetyRegistry();
    const item = findSafetyItem(registry.lists.blocked_prints, printId, ["printId", "printid", "id", "print.id"]);
    const registryPayload = clientMediaPayload(printId, item, "Print");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (registryPayload?.data?.files?.image || registryPayload?.data?.files?.file) {
      return res.json(registryPayload);
    }

    const forwarded = await postVrchatBackendJson(
      loaded,
      "/v1/vrchat/prints/get",
      { printid: printId },
      { cache: dashboardCache }
    );
    if (forwarded.ok) return res.status(forwarded.status).json(forwarded.data);

    return res.status(item ? 200 : forwarded.status).json({
      status: item ? 200 : forwarded.status,
      found: Boolean(item),
      printId,
      blocked: item || null,
      message: item
        ? "Print is listed in the safety registry."
        : forwarded.data?.message || "Print could not be fetched."
    });
  }));

  app.post("/v5/games/api/vrchat/yoinker/getPrints/:printId", asyncRoute(async (req, res) => {
    const printId = String(req.params.printId || req.body?.printid || req.body?.printId || "").trim();
    const registry = await loadSafetyRegistry();
    const item = findSafetyItem(registry.lists.blocked_prints, printId, ["printId", "printid", "id", "print.id"]);
    const registryPayload = clientMediaPayload(printId, item, "Print");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (registryPayload?.data?.files?.image || registryPayload?.data?.files?.file) {
      return res.json(registryPayload);
    }

    const forwarded = await postVrchatBackendJson(
      loaded,
      "/v1/vrchat/prints/get",
      { printid: printId },
      { cache: dashboardCache }
    );
    if (forwarded.ok) return res.status(forwarded.status).json(forwarded.data);

    return res.status(item ? 200 : forwarded.status).json({
      status: item ? 200 : forwarded.status,
      found: Boolean(item),
      printId,
      blocked: item || null,
      message: item
        ? "Print is listed in the safety registry."
        : forwarded.data?.message || "Print could not be fetched."
    });
  }));

  app.get("/v5/games/api/vrchat/yoinker/getSticker/:userId/:inventoryItemId", asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    const payload = await loadStickerPayload({
      loaded,
      dashboardCache,
      registry,
      id: req.params.inventoryItemId,
      userId: req.params.userId
    });
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(payload.status === 400 || payload.status === 404 ? payload.status : 200).json(payload);
  }));

  app.get("/v5/games/api/vrchat/yoinker/getSticker/:fileId", asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    const payload = await loadStickerPayload({
      loaded,
      dashboardCache,
      registry,
      id: req.params.fileId,
      userId: req.query.userId || req.query.userid || req.query.user
    });
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(payload.status === 400 || payload.status === 404 ? payload.status : 200).json(payload);
  }));

  app.get("/api/bootstrap", asyncRoute(async (req, res) => {
    if (!config.configured) {
      return res.json({
        setupRequired: true,
        missing: config.missing,
        expectedRedirectUri: config.redirectUri
      });
    }

    if (!req.dashboardSession) {
      return res.status(401).json({
        error: "Not authenticated",
        loginUrl: "/auth/discord"
      });
    }

    const accessible = await getAccessibleProfiles(req.dashboardSession, loaded);
    const guilds = await Promise.all(
      accessible.map(({ profile, access }) => serializeGuild(profile, req.dashboardSession, clients, access))
    );

    return res.json({
      user: {
        id: req.dashboardSession.user.id,
        username: req.dashboardSession.user.username,
        globalName: req.dashboardSession.user.global_name || req.dashboardSession.user.username,
        avatar: avatarUrl(req.dashboardSession.user)
      },
      guilds,
      expiresAt: req.dashboardSession.expiresAt
    });
  }));

  app.get("/api/guilds/:guildId/overview", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveProfileFromRequest(req, res);
    if (!resolved) return;
    return res.json(await loadOverview(resolved.profile, resolved.group));
  }));

  app.get("/api/guilds/:guildId/events", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveProfileFromRequest(req, res);
    if (!resolved) return;
    return res.json(await loadEvents(resolved.profile, resolved.group, req.query));
  }));

  app.get("/api/guilds/:guildId/users", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveProfileFromRequest(req, res);
    if (!resolved) return;
    return res.json(await loadUsers(resolved.profile, resolved.group, req.query));
  }));

  app.get("/api/guilds/:guildId/blacklists", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveProfileFromRequest(req, res);
    if (!resolved) return;
    return res.json(await loadBlacklists(resolved.profile, resolved.group, req.query));
  }));

  app.post("/api/guilds/:guildId/blacklists/:kind", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveBlacklistWriteProfileFromRequest(req, res, req.params.kind, "create");
    if (!resolved) return;
    const { group } = resolveGroup(resolved.profile, req.query.groupId);
    if (!group) return res.status(404).json({ error: "No VRChat group is configured for this Discord server." });
    const result = await mutateBlacklistRow({
      profile: resolved.profile,
      group,
      kind: req.params.kind,
      body: req.body || {},
      session: req.dashboardSession,
      access: resolved.access,
      mode: "create"
    });
    return res.status(result.status).json(result.error ? { error: result.error } : result);
  }));

  app.patch("/api/guilds/:guildId/blacklists/:kind/:id", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveBlacklistWriteProfileFromRequest(req, res, req.params.kind, "update");
    if (!resolved) return;
    const { group } = resolveGroup(resolved.profile, req.query.groupId);
    if (!group) return res.status(404).json({ error: "No VRChat group is configured for this Discord server." });
    const result = await mutateBlacklistRow({
      profile: resolved.profile,
      group,
      kind: req.params.kind,
      id: Number.parseInt(req.params.id, 10),
      body: req.body || {},
      session: req.dashboardSession,
      access: resolved.access,
      mode: "update"
    });
    return res.status(result.status).json(result.error ? { error: result.error } : result);
  }));

  app.delete("/api/guilds/:guildId/blacklists/:kind/:id", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveBlacklistWriteProfileFromRequest(req, res, req.params.kind, "archive");
    if (!resolved) return;
    const { group } = resolveGroup(resolved.profile, req.query.groupId);
    if (!group) return res.status(404).json({ error: "No VRChat group is configured for this Discord server." });
    const result = await mutateBlacklistRow({
      profile: resolved.profile,
      group,
      kind: req.params.kind,
      id: Number.parseInt(req.params.id, 10),
      session: req.dashboardSession,
      access: resolved.access,
      mode: "archive"
    });
    return res.status(result.status).json(result.error ? { error: result.error } : result);
  }));

  app.get("/api/guilds/:guildId/global-history", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveProfileFromRequest(req, res);
    if (!resolved) return;
    return res.json(await loadGlobalHistory(resolved.profile, resolved.group, req.query));
  }));

  app.get("/api/guilds/:guildId/setup", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveManageableProfileFromRequest(req, res);
    if (!resolved) return;
    return res.json(setupPayload(resolved.profile));
  }));

  app.post("/api/guilds/:guildId/setup/groups/lookup", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveManageableProfileFromRequest(req, res);
    if (!resolved) return;
    const { profile } = resolved;
    const groupid = normalizeGroupId(req.body?.groupid);
    if (!groupid) return res.status(400).json({ error: "VRChat group id is required." });
    const api = createSetupApi(profile);
    return res.json(await api.GetGroupInfo(groupid));
  }));

  app.post("/api/guilds/:guildId/setup/groups", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveManageableProfileFromRequest(req, res);
    if (!resolved) return;
    const { profile } = resolved;
    const groupid = normalizeGroupId(req.body?.groupid);
    if (!groupid) return res.status(400).json({ error: "VRChat group id is required." });

    const api = createSetupApi(profile);
    const info = await api.GetGroupInfo(groupid).catch(() => null);
    const saved = await saveSetupGroup(profile, {
      groupid,
      groupName: req.body?.groupName,
      autoShare: req.body?.autoShare,
      requestNotifications: req.body?.requestNotifications,
      ownerDiscordId: req.dashboardSession?.user?.id,
      confirmPermissions: Boolean(req.body?.confirmPermissions)
    }, info);

    return res.json({
      saved: serializeGroup(saved),
      lookup: info,
      setup: setupPayload(profile)
    });
  }));

  app.post("/api/guilds/:guildId/setup/groups/join", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveManageableProfileFromRequest(req, res);
    if (!resolved) return;
    const { profile } = resolved;
    const groupid = normalizeGroupId(req.body?.groupid);
    if (!groupid) return res.status(400).json({ error: "VRChat group id is required." });
    const api = createSetupApi(profile);
    return res.json(await api.JoinGroup(groupid, Boolean(req.body?.confirmOverrideBlock)));
  }));

  app.post("/api/guilds/:guildId/setup/groups/membership/join", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveManageableProfileFromRequest(req, res);
    if (!resolved) return;
    const { profile } = resolved;
    const groupid = normalizeGroupId(req.body?.groupid);
    if (!groupid) return res.status(400).json({ error: "VRChat group id is required." });
    const api = createSetupApi(profile);
    return res.json(await api.JoinGroupMembership(groupid, Boolean(req.body?.confirmOverrideBlock)));
  }));

  app.post("/api/guilds/:guildId/setup/groups/visibility", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveManageableProfileFromRequest(req, res);
    if (!resolved) return;
    const { profile } = resolved;
    const groupid = normalizeGroupId(req.body?.groupid);
    if (!groupid) return res.status(400).json({ error: "VRChat group id is required." });
    const api = createSetupApi(profile);
    const result = await ensureHiddenGroupMembership(api, groupid);
    return res.json({
      ...result,
      visibility: BOT_GROUP_VISIBILITY,
      message: result.message || "Bot group membership visibility set to hidden."
    });
  }));

  app.post("/api/guilds/:guildId/setup/groups/privacy/sync", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveManageableProfileFromRequest(req, res);
    if (!resolved) return;
    return res.json(await syncProfileGroupMembershipVisibility(resolved.profile));
  }));

  app.get("/api/guilds/:guildId/setup/invites/pending", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveManageableProfileFromRequest(req, res);
    if (!resolved) return;
    const { profile } = resolved;
    const api = createSetupApi(profile);
    return res.json(await api.GetPendingGroupInvites());
  }));

  app.post("/api/guilds/:guildId/setup/invites/:action", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveManageableProfileFromRequest(req, res);
    if (!resolved) return;
    const { profile } = resolved;
    const groupid = normalizeGroupId(req.body?.groupid);
    if (!groupid) return res.status(400).json({ error: "VRChat group id is required." });
    const action = String(req.params.action || "").toLowerCase();
    const api = createSetupApi(profile);
    if (action === "accept") return res.json(await api.AcceptGroupInvite(groupid));
    if (action === "decline") return res.json(await api.DeclineGroupInvite(groupid));
    if (action === "ignore") return res.json(await api.IgnoreGroupInvite(groupid));
    return res.status(400).json({ error: "Invite action must be accept, decline, or ignore." });
  }));

  app.get("/api/guilds/:guildId/setup/join-requests", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveManageableProfileFromRequest(req, res);
    if (!resolved) return;
    const { group } = resolveGroup(resolved.profile, req.query.groupId);
    if (!group) return res.status(404).json({ error: "No VRChat group is configured for this Discord server." });
    const api = createSetupApi(resolved.profile);
    return res.json(await api.GetGroupJoinRequests(group.groupid, group.groupName || group.groupid));
  }));

  app.post("/api/guilds/:guildId/setup/join-requests/:action", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveManageableProfileFromRequest(req, res);
    if (!resolved) return;
    const { group } = resolveGroup(resolved.profile, req.query.groupId);
    if (!group) return res.status(404).json({ error: "No VRChat group is configured for this Discord server." });
    const userId = String(req.body?.userId || req.body?.userid || "").trim();
    if (!userId) return res.status(400).json({ error: "VRChat user id is required." });
    const action = String(req.params.action || "").toLowerCase();
    const actionValue = action === "accept" ? "accept" : action === "deny" || action === "reject" ? "reject" : "";
    if (!actionValue) return res.status(400).json({ error: "Join request action must be accept or deny." });
    const api = createSetupApi(resolved.profile);
    return res.json(await api.RespondGroupMemberRequest(
      group.groupid,
      userId,
      actionValue,
      Boolean(req.body?.block),
      group.groupName || group.groupid
    ));
  }));

  app.get("/api/guilds/:guildId/client-access", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveProfileFromRequest(req, res);
    if (!resolved) return;
    const keyRow = await ensureClientApiKeyForUser(
      resolved.profile,
      resolved.group,
      req.dashboardSession,
      resolved.access
    );
    return res.json(buildClientAccessPayload({
      config,
      profile: resolved.profile,
      group: resolved.group,
      access: resolved.access,
      keyRow
    }));
  }));

  app.post("/api/guilds/:guildId/client-access/regenerate", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveProfileFromRequest(req, res);
    if (!resolved) return;
    const keyRow = await ensureClientApiKeyForUser(
      resolved.profile,
      resolved.group,
      req.dashboardSession,
      resolved.access,
      { regenerate: true }
    );
    return res.json({
      message: "Client API key regenerated.",
      ...buildClientAccessPayload({
        config,
        profile: resolved.profile,
        group: resolved.group,
        access: resolved.access,
        keyRow
      })
    });
  }));

  app.get("/api/guilds/:guildId/live", requireAuth, asyncRoute(async (req, res) => {
    const resolved = await resolveProfileFromRequest(req, res);
    if (!resolved) return;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    let lastRevision = "";
    let closed = false;

    const writeEvent = (eventName, payload) => {
      if (closed || res.destroyed || res.writableEnded) return;
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const sendSnapshot = async (force = false) => {
      try {
        const snapshot = await loadLiveSnapshot(resolved.profile, resolved.group);
        if (force || snapshot.revision !== lastRevision) {
          lastRevision = snapshot.revision;
          writeEvent("snapshot", snapshot);
          return;
        }
        writeEvent("heartbeat", { ts: Date.now() });
      } catch (err) {
        writeEvent("live-error", {
          ts: Date.now(),
          message: err?.message || "Live update failed"
        });
      }
    };

    await sendSnapshot(true);
    const interval = setInterval(() => {
      sendSnapshot(false).catch(() => {});
    }, 5000);

    req.on("close", () => {
      closed = true;
      clearInterval(interval);
    });
  }));

  app.get("/api/client/bootstrap", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    return res.json(await clientApiBootstrapPayload(resolved));
  }));

  app.get("/api/client/overview", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    return res.json(await loadOverview(resolved.profile, resolved.group));
  }));

  app.get("/api/client/events", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    return res.json(await loadEvents(resolved.profile, resolved.group, req.query));
  }));

  app.get("/api/client/users", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    return res.json(await loadUsers(resolved.profile, resolved.group, req.query));
  }));

  app.get("/api/client/users/:userId/profile", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientUserProfile(resolved.profile, req.params.userId, req.query, { cache: dashboardCache });
    return res.status(payload.status === 400 || payload.status === 404 ? payload.status : 200).json(payload);
  }));

  app.get("/api/client/user/:userId", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientUserProfile(resolved.profile, req.params.userId, req.query, { cache: dashboardCache });
    return res.status(payload.status === 400 || payload.status === 404 ? payload.status : 200).json(payload);
  }));

  app.get("/api/client/profile/:id", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const id = String(req.params.id || "");
    const payload = id.startsWith("avtr_")
      ? await loadClientAvatarProfile(resolved.profile, resolved.group, id, req.query, { cache: dashboardCache })
      : await loadClientUserProfile(resolved.profile, id, req.query, { cache: dashboardCache });
    return res.status(payload.status === 400 || payload.status === 404 ? payload.status : 200).json(payload);
  }));

  app.get("/api/client/blacklists", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    return res.json(await loadBlacklists(resolved.profile, resolved.group, req.query));
  }));

  app.get("/api/client/check/:userId", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientUserCheck(resolved.profile, resolved.group, req.params.userId, { automod: false, cache: dashboardCache });
    return res.status(payload.status === 404 ? 404 : 200).json(payload);
  }));

  app.get("/api/client/automod/check/:userId", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientUserCheck(resolved.profile, resolved.group, req.params.userId, { automod: true, cache: dashboardCache });
    return res.status(payload.status === 404 ? 404 : 200).json(payload);
  }));

  app.get("/api/client/avatars/:avatarId/profile", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientAvatarProfile(resolved.profile, resolved.group, req.params.avatarId, req.query, { cache: dashboardCache });
    return res.status(payload.status === 400 || payload.status === 404 ? payload.status : 200).json(payload);
  }));

  app.get("/api/client/avatar/:avatarId", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientAvatarProfile(resolved.profile, resolved.group, req.params.avatarId, req.query, { cache: dashboardCache });
    return res.status(payload.status === 400 || payload.status === 404 ? payload.status : 200).json(payload);
  }));

  app.get("/api/client/staff", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    return res.json(await loadBlacklists(resolved.profile, resolved.group, {
      ...req.query,
      kind: "staff"
    }));
  }));

  app.get("/api/client/global-history", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    return res.json(await loadGlobalHistory(resolved.profile, resolved.group, req.query));
  }));

  app.get("/api/client/world", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientWorldInfo(resolved.profile, req.query, { cache: dashboardCache });
    return res.status(payload.status === 400 ? 400 : 200).json(payload);
  }));

  app.post("/api/client/avatar-analysis", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientAvatarAnalysis(resolved.profile, req.body || {}, { cache: dashboardCache });
    return res.status(payload.status === 400 ? 400 : 200).json(payload);
  }));

  app.post("/safety/avataranalysis", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientAvatarAnalysis(resolved.profile, req.body || {}, { cache: dashboardCache });
    return res.status(payload.status === 400 ? 400 : 200).json(payload);
  }));

  app.get("/api/client/:guildId/:groupId/bootstrap", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    return res.json(await clientApiBootstrapPayload(resolved));
  }));

  app.get("/api/client/:guildId/:groupId/overview", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    return res.json(await loadOverview(resolved.profile, resolved.group));
  }));

  app.get("/api/client/:guildId/:groupId/events", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    return res.json(await loadEvents(resolved.profile, resolved.group, req.query));
  }));

  app.get("/api/client/:guildId/:groupId/users", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    return res.json(await loadUsers(resolved.profile, resolved.group, req.query));
  }));

  app.get("/api/client/:guildId/:groupId/users/:userId/profile", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientUserProfile(resolved.profile, req.params.userId, req.query, { cache: dashboardCache });
    return res.status(payload.status === 400 || payload.status === 404 ? payload.status : 200).json(payload);
  }));

  app.get("/api/client/:guildId/:groupId/user/:userId", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientUserProfile(resolved.profile, req.params.userId, req.query, { cache: dashboardCache });
    return res.status(payload.status === 400 || payload.status === 404 ? payload.status : 200).json(payload);
  }));

  app.get("/api/client/:guildId/:groupId/profile/:id", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const id = String(req.params.id || "");
    const payload = id.startsWith("avtr_")
      ? await loadClientAvatarProfile(resolved.profile, resolved.group, id, req.query, { cache: dashboardCache })
      : await loadClientUserProfile(resolved.profile, id, req.query, { cache: dashboardCache });
    return res.status(payload.status === 400 || payload.status === 404 ? payload.status : 200).json(payload);
  }));

  app.get("/api/client/:guildId/:groupId/blacklists", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    return res.json(await loadBlacklists(resolved.profile, resolved.group, req.query));
  }));

  app.get("/api/client/:guildId/:groupId/check/:userId", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientUserCheck(resolved.profile, resolved.group, req.params.userId, { automod: false, cache: dashboardCache });
    return res.status(payload.status === 404 ? 404 : 200).json(payload);
  }));

  app.get("/api/client/:guildId/:groupId/automod/check/:userId", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientUserCheck(resolved.profile, resolved.group, req.params.userId, { automod: true, cache: dashboardCache });
    return res.status(payload.status === 404 ? 404 : 200).json(payload);
  }));

  app.get("/api/client/:guildId/:groupId/avatars/:avatarId/profile", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientAvatarProfile(resolved.profile, resolved.group, req.params.avatarId, req.query, { cache: dashboardCache });
    return res.status(payload.status === 400 || payload.status === 404 ? payload.status : 200).json(payload);
  }));

  app.get("/api/client/:guildId/:groupId/avatar/:avatarId", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientAvatarProfile(resolved.profile, resolved.group, req.params.avatarId, req.query, { cache: dashboardCache });
    return res.status(payload.status === 400 || payload.status === 404 ? payload.status : 200).json(payload);
  }));

  app.get("/api/client/:guildId/:groupId/staff", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    return res.json(await loadBlacklists(resolved.profile, resolved.group, {
      ...req.query,
      kind: "staff"
    }));
  }));

  app.get("/api/client/:guildId/:groupId/global-history", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    return res.json(await loadGlobalHistory(resolved.profile, resolved.group, req.query));
  }));

  app.get("/api/client/:guildId/:groupId/world", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientWorldInfo(resolved.profile, req.query, { cache: dashboardCache });
    return res.status(payload.status === 400 ? 400 : 200).json(payload);
  }));

  app.post("/api/client/:guildId/:groupId/avatar-analysis", asyncRoute(async (req, res) => {
    const resolved = await resolveClientApiRequest(req, res);
    if (!resolved) return;
    const payload = await loadClientAvatarAnalysis(resolved.profile, req.body || {}, { cache: dashboardCache });
    return res.status(payload.status === 400 ? 400 : 200).json(payload);
  }));

  app.get("/api/admin/bootstrap", requireAdminApiAuth, asyncRoute(async (req, res) => {
    return res.json({
      user: {
        id: req.dashboardSession.user.id,
        username: req.dashboardSession.user.username,
        globalName: req.dashboardSession.user.global_name || req.dashboardSession.user.username,
        avatar: avatarUrl(req.dashboardSession.user)
      },
      guilds: listProfiles(loaded).map(profile => ({
        guildId: profile.guildId,
        name: profile.config?.VRCAPI?.groupName || profile.guildId
      }))
    });
  }));

  app.get("/api/admin/safety", requireAdminApiAuth, asyncRoute(async (req, res) => {
    return res.json(safetyListResponse(await loadSafetyRegistry()));
  }));

  app.get("/api/admin/safety/archive", requireAdminApiAuth, asyncRoute(async (req, res) => {
    const registry = await loadSafetyRegistry();
    return res.json({
      updatedAt: registry.updatedAt,
      archive: registry.archive || {},
      definitions: SAFETY_LISTS
    });
  }));

  app.get("/api/admin/safety/archive/:listKey", requireAdminApiAuth, asyncRoute(async (req, res) => {
    const listKey = allowedSafetyListKey(req.params.listKey);
    if (!listKey) return res.status(404).json({ error: "Unknown safety list." });
    const registry = await loadSafetyRegistry();
    return res.json({
      updatedAt: registry.updatedAt,
      key: listKey,
      rows: registry.archive?.[listKey] || []
    });
  }));

  app.put("/api/admin/safety/lists/:listKey", requireAdminApiAuth, asyncRoute(async (req, res) => {
    const listKey = allowedSafetyListKey(req.params.listKey);
    if (!listKey) return res.status(404).json({ error: "Unknown safety list." });
    const items = normalizeSafetyList(listKey, normalizeSafetyItems(req.body?.items));
    const registry = await updateSafetyList(listKey, () => items);
    return res.json({
      message: `${SAFETY_LISTS[listKey].label} saved.`,
      ...safetyListResponse(registry)
    });
  }));

  app.post("/api/admin/safety/lists/:listKey/items", requireAdminApiAuth, asyncRoute(async (req, res) => {
    const listKey = allowedSafetyListKey(req.params.listKey);
    if (!listKey) return res.status(404).json({ error: "Unknown safety list." });
    const item = normalizeSafetyItem(req.body?.item, listKey);
    if (item == null) return res.status(400).json({ error: "Safety item is required." });

    const registry = await updateSafetyList(listKey, current => [...current, item]);
    return res.json({
      message: `Added item to ${SAFETY_LISTS[listKey].label}.`,
      ...safetyListResponse(registry)
    });
  }));

  app.patch("/api/admin/safety/lists/:listKey/items/:index", requireAdminApiAuth, asyncRoute(async (req, res) => {
    const listKey = allowedSafetyListKey(req.params.listKey);
    if (!listKey) return res.status(404).json({ error: "Unknown safety list." });
    const index = Number.parseInt(req.params.index, 10);
    if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: "Invalid item index." });
    const replacement = normalizeSafetyItem(req.body?.item, listKey);
    if (replacement == null) return res.status(400).json({ error: "Safety item is required." });
    const before = await loadSafetyRegistry();
    if (index >= (before.lists?.[listKey] || []).length) {
      return res.status(404).json({ error: "Safety item not found." });
    }

    const registry = await updateSafetyList(listKey, current => {
      return current.map((item, itemIndex) => itemIndex === index ? replacement : item);
    });
    return res.json({
      message: `Updated item in ${SAFETY_LISTS[listKey].label}.`,
      ...safetyListResponse(registry)
    });
  }));

  app.delete("/api/admin/safety/lists/:listKey/items/:index", requireAdminApiAuth, asyncRoute(async (req, res) => {
    const listKey = allowedSafetyListKey(req.params.listKey);
    if (!listKey) return res.status(404).json({ error: "Unknown safety list." });
    const index = Number.parseInt(req.params.index, 10);
    if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: "Invalid item index." });

    const registry = await archiveSafetyItem(listKey, index, {
      userId: req.dashboardSession?.user?.id,
      displayName: req.dashboardSession?.user?.global_name || req.dashboardSession?.user?.username
    });
    if (!registry) return res.status(404).json({ error: "Safety item not found." });
    return res.json({
      message: `Archived item from ${SAFETY_LISTS[listKey].label}.`,
      ...safetyListResponse(registry)
    });
  }));

  app.use((err, req, res, next) => {
    console.error("[DASHBOARD]", err);
    if (res.headersSent) return next(err);
    return res.status(500).json({
      error: "Dashboard request failed.",
      detail: err?.message || String(err)
    });
  });

  dashboardServer = app.listen(config.port, config.host, () => {
    console.log(`[DASHBOARD] Listening on ${config.baseUrl}/dashboard`);
    if (!config.configured) {
      console.warn(
        `[DASHBOARD] OAuth setup incomplete: ${config.missing.join(", ")}. Expected redirect URI: ${config.redirectUri}`
      );
    }
  });

  setTimeout(runPrivacySync, 15000);
  privacySyncTimer = setInterval(runPrivacySync, 30 * 60 * 1000);

  dashboardServer.on("close", () => {
    if (privacySyncTimer) clearInterval(privacySyncTimer);
  });

  dashboardServer.on("error", (err) => {
    console.error(`[DASHBOARD] Server error: ${err.message}`);
  });

  return dashboardServer;
}

module.exports = { startDashboard };
