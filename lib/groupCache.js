// lib/groupCache.js
//
// Keeps a local snapshot of the tracked VRChat group and its members.
//
// Members are never deleted: when someone leaves they are flagged inactive and
// kept, so a display name seen in an old audit log entry can still be resolved
// back to a user id. Every observed display-name change is appended to
// vrc_user_name_history, which is what makes name backtracking work.

const { getGroup } = require("./vrcGroup");

const NAME_HISTORY_SOURCE = "group-member-cache";

function text(value) {
  const out = String(value ?? "").trim();
  return out || null;
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** VRChat returns members in a few shapes depending on endpoint version. */
function normalizeMember(raw) {
  const user = raw?.user || raw?.userData || {};
  const userId = text(raw?.userId || raw?.id || user?.id);
  if (!userId) return null;

  return {
    userId,
    displayName: text(raw?.displayName || user?.displayName),
    roleIds: Array.isArray(raw?.roleIds) ? raw.roleIds : [],
    isRepresenting: Boolean(raw?.isRepresenting),
    joinedAt: toDate(raw?.joinedAt || raw?.createdAt),
    membershipStatus: text(raw?.membershipStatus),
    visibility: text(raw?.visibility),
    isSubscribedToAnnouncements:
      typeof raw?.isSubscribedToAnnouncements === "boolean"
        ? raw.isSubscribedToAnnouncements
        : null,
    managerNotes: text(raw?.managerNotes),
    raw
  };
}

function extractMemberList(response) {
  const data = response?.data ?? response;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.members)) return data.members;
  return [];
}

function extractGroupInfo(response) {
  const data = response?.data ?? response;
  return data?.group || data?.data || data || {};
}

/**
 * Appends a name change, unless the exact transition is already the newest row
 * for that user (the poller runs repeatedly and must stay idempotent).
 */
async function recordNameChange(db, userId, oldName, newName, source = NAME_HISTORY_SOURCE) {
  const model = db?.VRCUserNameHistory;
  if (!model || !userId || !oldName || !newName || oldName === newName) return false;

  const latest = await model
    .findOne({ where: { userId }, order: [["observedAt", "DESC"], ["id", "DESC"]] })
    .catch(() => null);

  if (latest && latest.oldDisplayName === oldName && latest.newDisplayName === newName) {
    return false;
  }

  await model
    .create({ userId, oldDisplayName: oldName, newDisplayName: newName, source })
    .catch(() => null);
  return true;
}

async function upsertGroupSnapshot(db, groupId, response) {
  const model = db?.VRCGroupCache;
  if (!model) return null;

  const info = extractGroupInfo(response);
  const payload = {
    groupId,
    name: text(info?.name),
    shortCode: text(info?.shortCode),
    discriminator: text(info?.discriminator),
    description: text(info?.description),
    ownerId: text(info?.ownerId),
    iconUrl: text(info?.iconUrl),
    bannerUrl: text(info?.bannerUrl),
    memberCount: Number.isFinite(Number(info?.memberCount)) ? Number(info.memberCount) : null,
    raw: info,
    lastFetchedAt: new Date()
  };

  const existing = await model.findOne({ where: { groupId } }).catch(() => null);
  if (existing) {
    await existing.update(payload).catch(() => null);
    return existing;
  }
  return await model.create(payload).catch(() => null);
}

/**
 * Reconciles the member cache against a freshly fetched member list.
 * Returns counts plus the display-name changes that were recorded.
 */
async function syncGroupMembers(db, groupId, members) {
  const model = db?.VRCGroupMemberCache;
  if (!model) return { added: 0, updated: 0, departed: 0, renamed: [] };

  const now = new Date();
  const seen = new Set();
  const renamed = [];
  let added = 0;
  let updated = 0;

  for (const rawMember of members) {
    const member = normalizeMember(rawMember);
    if (!member) continue;
    seen.add(member.userId);

    const existing = await model
      .findOne({ where: { groupId, userId: member.userId } })
      .catch(() => null);

    const row = {
      groupId,
      userId: member.userId,
      displayName: member.displayName,
      roleIds: member.roleIds,
      isRepresenting: member.isRepresenting,
      joinedAt: member.joinedAt,
      membershipStatus: member.membershipStatus,
      visibility: member.visibility,
      isSubscribedToAnnouncements: member.isSubscribedToAnnouncements,
      managerNotes: member.managerNotes,
      active: true,
      lastSeenAt: now,
      leftAt: null,
      raw: member.raw
    };

    if (!existing) {
      await model.create({ ...row, firstSeenAt: now }).catch(() => null);
      added++;
      continue;
    }

    const previousName = text(existing.displayName);
    if (previousName && member.displayName && previousName !== member.displayName) {
      const recorded = await recordNameChange(
        db,
        member.userId,
        previousName,
        member.displayName
      );
      if (recorded) renamed.push({ userId: member.userId, from: previousName, to: member.displayName });
    }

    // Keep the last known name if VRChat omitted it this time round.
    if (!row.displayName) row.displayName = existing.displayName;

    await existing.update(row).catch(() => null);
    updated++;
  }

  // Anyone previously active but absent from this fetch has left the group.
  let departed = 0;
  const activeRows = await model.findAll({ where: { groupId, active: true } }).catch(() => []);
  for (const row of activeRows) {
    if (seen.has(row.userId)) continue;
    await row.update({ active: false, leftAt: now }).catch(() => null);
    departed++;
  }

  return { added, updated, departed, renamed };
}

/**
 * Fetches the group + member list once and writes both caches.
 */
async function refreshGroupCache({ api, db, config, logger = console }) {
  const group = getGroup(config);
  if (!group?.groupid) return null;
  if (!db?.VRCGroupMemberCache) return null;

  const groupId = group.groupid;

  try {
    if (typeof api.GetGroupInfo === "function") {
      const info = await api.GetGroupInfo(groupId).catch(() => null);
      if (info) await upsertGroupSnapshot(db, groupId, info);
    }

    if (typeof api.GetGroupMembers !== "function") return null;

    const response = await api.GetGroupMembers(groupId, group.groupName);
    const members = extractMemberList(response);
    if (!members.length) return null;

    const result = await syncGroupMembers(db, groupId, members);

    if (result.added || result.departed || result.renamed.length) {
      logger.info(
        `[group-cache] ${groupId}: +${result.added} new, ${result.updated} updated, ` +
          `${result.departed} left, ${result.renamed.length} renamed.`
      );
    }
    for (const change of result.renamed) {
      logger.info(`[group-cache] name change ${change.userId}: "${change.from}" -> "${change.to}"`);
    }

    return result;
  } catch (err) {
    logger.error(`[group-cache] Refresh failed for ${groupId}: ${err?.message || err}`);
    return null;
  }
}

/**
 * Resolves a user id from a display name, current or historical.
 * Returns { userId, displayName, matchedOn, historical }.
 */
async function resolveUserByName(db, displayName) {
  const name = text(displayName);
  if (!name) return null;

  const member = await db?.VRCGroupMemberCache?.findOne({
    where: { displayName: name },
    order: [["lastSeenAt", "DESC"]]
  }).catch(() => null);

  if (member) {
    return {
      userId: member.userId,
      displayName: member.displayName,
      matchedOn: "current",
      historical: false,
      active: member.active
    };
  }

  const historyRow = await db?.VRCUserNameHistory?.findOne({
    where: { oldDisplayName: name },
    order: [["observedAt", "DESC"], ["id", "DESC"]]
  }).catch(() => null);

  if (!historyRow) return null;

  const current = await db?.VRCGroupMemberCache?.findOne({
    where: { userId: historyRow.userId }
  }).catch(() => null);

  return {
    userId: historyRow.userId,
    displayName: current?.displayName || historyRow.newDisplayName,
    matchedOn: "history",
    historical: true,
    active: current ? current.active : null
  };
}

/** Full known-name list for a user, oldest first. */
async function listKnownNames(db, userId) {
  const id = text(userId);
  if (!id) return [];

  const rows = await db?.VRCUserNameHistory?.findAll({
    where: { userId: id },
    order: [["observedAt", "ASC"], ["id", "ASC"]]
  }).catch(() => []);

  const names = [];
  for (const row of rows || []) {
    if (row.oldDisplayName && !names.includes(row.oldDisplayName)) names.push(row.oldDisplayName);
    if (row.newDisplayName && !names.includes(row.newDisplayName)) names.push(row.newDisplayName);
  }

  const member = await db?.VRCGroupMemberCache?.findOne({ where: { userId: id } }).catch(() => null);
  if (member?.displayName && !names.includes(member.displayName)) names.push(member.displayName);

  return names;
}

function startGroupCache({ api, db, config, intervalMs = 15 * 60 * 1000, logger = console }) {
  const run = () => refreshGroupCache({ api, db, config, logger });
  run();
  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => clearInterval(timer), refresh: run };
}

module.exports = {
  refreshGroupCache,
  startGroupCache,
  syncGroupMembers,
  recordNameChange,
  resolveUserByName,
  listKnownNames
};
