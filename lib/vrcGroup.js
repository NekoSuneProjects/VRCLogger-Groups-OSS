// lib/vrcGroup.js
// One Discord server tracks exactly one VRChat group.
// The group lives directly on config.VRCAPI - there is no groups[] array.

function cloneObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

function normalizeOwnerIds(vrc) {
  const raw = Array.isArray(vrc.ownerDiscordIds)
    ? vrc.ownerDiscordIds
    : Array.isArray(vrc.ownerIds)
    ? vrc.ownerIds
    : [];
  return [...new Set(raw.map(id => String(id || "").trim()).filter(Boolean))];
}

/**
 * Returns the single configured VRChat group, or null when none is set up yet.
 */
function getGroup(config) {
  const vrc = config?.VRCAPI || {};
  const groupid = String(vrc.groupid || "").trim();
  if (!groupid) return null;

  const groupSql = cloneObject(vrc.SQL);

  return {
    groupid,
    groupName: vrc.groupName || "",
    LoggerCategoryId: vrc.LoggerCategoryId || "",
    LoggerTextChannel: cloneObject(vrc.LoggerTextChannel),
    VRCProxyNode: vrc.VRCProxyNode || "",
    SQL: Object.keys(groupSql).length ? groupSql : cloneObject(config?.SQL),
    ownerDiscordIds: normalizeOwnerIds(vrc),
    globalAnalytics: cloneObject(vrc.globalAnalytics),
    reqnotify: cloneObject(vrc.reqnotify),
    ACCESS: cloneObject(vrc.ACCESS)
  };
}

/**
 * Applies `updater` to config.VRCAPI in place. Returns the updated VRCAPI block.
 */
function updateGroup(config, updater) {
  if (!config || typeof updater !== "function") return null;
  config.VRCAPI = updater(config.VRCAPI || {});
  return config.VRCAPI;
}

module.exports = { getGroup, updateGroup };
