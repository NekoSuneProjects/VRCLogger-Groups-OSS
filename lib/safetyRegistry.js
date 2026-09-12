const path = require("path");
const fs = require("fs-extra");

const SAFETY_REGISTRY_PATH = path.join(process.cwd(), "config", "safety-lists.json");
const PUBLIC_GROUP_TYPES_BLOCKED = new Set(["COMMUNITY", "ALLY", "ALLIED", "AFFILIATED"]);

const DEFAULT_IPGRABBER_DOMAINS = [
  "grabify.link",
  "iplogger.org",
  "2no.co",
  "iplogger.com",
  "yip.su",
  "ipgrabber.ru",
  "ip-tracker.org",
  "blasze.com",
  "linkspy.cc",
  "gyazo.nl",
  "freebooter.pro",
  "bmwforum.co",
  "leancoding.co",
  "spottyfly.com",
  "spicedrp.com",
  "yoütu.be",
  "youtubé.com",
  "webresolver.nl",
  "ipgraber.ru",
  "shorturl.gg",
  "iplogger.co",
  "iplogger.io",
  "iplogger.info"
];

const SAFETY_LISTS = {
  ipgrabber_domains: {
    label: "IP Grabber Domains",
    description: "Domains blocked by client-side privacy protection."
  },
  trusted_internal_domains: {
    label: "Trusted/Internal Domains",
    description: "Domains that the old client treats as internal/safe media sources."
  },
  avatar_blacklist: {
    label: "Crasher/Ripper Avatars",
    description: "Avatar objects served through the ProxyNode-compatible avatarblacklist endpoint."
  },
  blacklist_users: {
    label: "Blacklisted Users",
    description: "User safety entries for local client/user checks."
  },
  blacklist_groups: {
    label: "Blacklisted Groups",
    description: "Group safety entries for user group membership checks. Public sharing is opt-in per entry."
  },
  blocked_prints: {
    label: "Blocked Prints",
    description: "Print IDs or objects to flag when a VRChat print is spawned."
  },
  blocked_stickers: {
    label: "Blocked Stickers",
    description: "Sticker file IDs or objects to flag when a VRChat sticker is spawned."
  }
};

function defaultRegistry() {
  const lists = {};
  const archive = {};
  for (const key of Object.keys(SAFETY_LISTS)) lists[key] = [];
  for (const key of Object.keys(SAFETY_LISTS)) archive[key] = [];
  lists.ipgrabber_domains = [...DEFAULT_IPGRABBER_DOMAINS];
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    lists,
    archive
  };
}

function allowedSafetyListKey(key) {
  const normalized = String(key || "").trim().replace(/-/g, "_");
  return Object.prototype.hasOwnProperty.call(SAFETY_LISTS, normalized)
    ? normalized
    : "";
}

function normalizeRegistry(raw) {
  const base = defaultRegistry();
  const sourceLists = raw?.lists && typeof raw.lists === "object" ? raw.lists : raw || {};
  const sourceArchive = raw?.archive && typeof raw.archive === "object" ? raw.archive : {};
  for (const key of Object.keys(SAFETY_LISTS)) {
    if (Array.isArray(sourceLists[key])) base.lists[key] = normalizeSafetyList(key, sourceLists[key]);
    if (Array.isArray(sourceArchive[key])) base.archive[key] = sourceArchive[key];
  }
  base.version = Number(raw?.version || base.version);
  base.updatedAt = raw?.updatedAt || base.updatedAt;
  return base;
}

async function loadSafetyRegistry() {
  const raw = await fs.readJson(SAFETY_REGISTRY_PATH).catch(() => null);
  const registry = normalizeRegistry(raw);
  if (!raw) await saveSafetyRegistry(registry);
  return registry;
}

async function saveSafetyRegistry(registry) {
  const normalized = normalizeRegistry(registry);
  normalized.updatedAt = new Date().toISOString();
  await fs.ensureDir(path.dirname(SAFETY_REGISTRY_PATH));
  await fs.writeJson(SAFETY_REGISTRY_PATH, normalized, { spaces: 2 });
  return normalized;
}

function normalizeGroupType(value) {
  const type = String(value || "UNKNOWN").trim().toUpperCase();
  return type || "UNKNOWN";
}

function asPublicBoolean(value) {
  return value === true || value === 1 || String(value || "").trim().toLowerCase() === "true";
}

function normalizeSafetyEntry(key, item) {
  if (key !== "blacklist_groups") return item;

  if (typeof item === "string") {
    return {
      groupID: item,
      name: item,
      type: "UNKNOWN",
      reason: "",
      public: false
    };
  }

  if (!item || typeof item !== "object") return item;

  const groupId = item.groupID || item.groupId || item.groupid || item.id || item.group?.id || "";
  const name = item.name || item.groupName || item.displayName || item.group?.name || groupId;
  return {
    ...item,
    groupID: groupId,
    name,
    type: normalizeGroupType(item.type),
    public: asPublicBoolean(item.public || item.publicShare || item.showPublic)
  };
}

function normalizeSafetyList(key, items = []) {
  return (Array.isArray(items) ? items : [])
    .map(item => normalizeSafetyEntry(key, item))
    .filter(item => item != null);
}

function asComparableId(item, fields = []) {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";
  for (const field of fields) {
    const value = String(field).split(".").reduce((current, part) => current?.[part], item);
    if (value) return String(value);
  }
  return "";
}

function findSafetyItem(list, id, fields = []) {
  const target = String(id || "").trim().toLowerCase();
  if (!target) return null;
  return (list || []).find(item => asComparableId(item, fields).toLowerCase() === target) || null;
}

function avatarBlacklistForProxy(registry) {
  return (registry.lists.avatar_blacklist || []).map(item => {
    if (typeof item === "string") {
      return {
        avatarId: item,
        crasher: true,
        ripper: false,
        date: registry.updatedAt
      };
    }
    return item;
  });
}

function publicGroupBlacklistForProxy(registry) {
  return (registry.lists.blacklist_groups || [])
    .map(item => normalizeSafetyEntry("blacklist_groups", item))
    .filter(item => {
      if (!item || typeof item !== "object") return false;
      if (!asPublicBoolean(item.public)) return false;
      return !PUBLIC_GROUP_TYPES_BLOCKED.has(normalizeGroupType(item.type));
    })
    .map(item => ({
      ...item,
      groupID: item.groupID || item.groupId || item.id || "",
      name: item.name || item.groupName || item.groupID || item.groupId || "",
      type: normalizeGroupType(item.type)
    }));
}

function truthyField(item, field) {
  if (!item || typeof item !== "object") return false;
  const value = item[field];
  return value === true || value === 1 || String(value || "").toLowerCase() === "true";
}

function countUserSafetyType(users, field, labels = []) {
  const needles = [field, ...labels].map(item => String(item).toLowerCase());
  return (users || []).filter(item => {
    if (truthyField(item, field)) return true;
    const haystack = [
      item?.type,
      item?.category,
      item?.reason,
      item?.tag
    ].map(value => String(value || "").toLowerCase());
    return needles.some(needle => haystack.some(value => value.includes(needle)));
  }).length;
}

function safetyCountsForProxy(registry) {
  const users = registry.lists.blacklist_users || [];
  const avatars = avatarBlacklistForProxy(registry);

  return [{
    yoinker: {
      ripper: countUserSafetyType(users, "ripper"),
      crasher: countUserSafetyType(users, "crasher"),
      cyberbully: countUserSafetyType(users, "cyberbully", ["cyber bully"]),
      banned: countUserSafetyType(users, "banned", ["ban"]),
      clients: countUserSafetyType(users, "clients", ["client"]),
      troll: countUserSafetyType(users, "troll"),
      racism: countUserSafetyType(users, "racism", ["racist"]),
      underaged: countUserSafetyType(users, "underaged", ["underage"])
    },
    avatarblacklist: {
      crasher: avatars.filter(item => truthyField(item, "crasher")).length,
      ripper: avatars.filter(item => truthyField(item, "ripper")).length
    },
    groups: (registry.lists.blacklist_groups || []).length,
    ipgrabber_domains: (registry.lists.ipgrabber_domains || []).length,
    blocked_prints: (registry.lists.blocked_prints || []).length,
    blocked_stickers: (registry.lists.blocked_stickers || []).length
  }];
}

function publicSafetyPayload(registry) {
  return {
    updatedAt: registry.updatedAt,
    ipgrabber_domains: registry.lists.ipgrabber_domains || [],
    trusted_internal_domains: registry.lists.trusted_internal_domains || [],
    avatar_blacklist: avatarBlacklistForProxy(registry),
    blacklist_users: registry.lists.blacklist_users || [],
    blacklist_groups: publicGroupBlacklistForProxy(registry),
    blocked_prints: registry.lists.blocked_prints || [],
    blocked_stickers: registry.lists.blocked_stickers || []
  };
}

module.exports = {
  SAFETY_LISTS,
  SAFETY_REGISTRY_PATH,
  PUBLIC_GROUP_TYPES_BLOCKED,
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
};
