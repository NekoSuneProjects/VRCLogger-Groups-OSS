// utils/vrchat.js
const fetch = require("node-fetch");

/**
 * Factory that builds API helpers using the provided config.
 * Usage: const api = createVrchatApi(client.config);
 */
function createVrchatApi(config) {
  if (!config?.VRCAPI?.VRCBackEndURL) {
    throw new Error("VRCBackEndURL missing in config.VRCAPI");
  }
  const base = config.VRCAPI.VRCBackEndURL.replace(/\/+$/, "");

  async function post(path, payload, headers) {
    const url = `${base}${path}`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload || {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          status: data.status ?? response.status,
          message: data.message ?? response.statusText,
          bot: data.bot,
          data: data.data
        };
      }
      return {
        status: data.status ?? 200,
        message: data.message ?? "OK",
        bot: data.bot,
        data: data.data
      };
    } catch (err) {
      return { status: 500, message: err.message || "Network error" };
    }
  }

  // ---- API wrappers ----
  const BanGroupUser = (groupid, userid, groupname) => post("/v1/vrchat/groups/moderation/banmember", { groupid, userid, groupname }, { "Content-Type": "application/json" });
  const UnbanGroupUser = (groupid, userid, groupname) => post("/v1/vrchat/groups/moderation/unbanmember", { groupid, userid, groupname }, { "Content-Type": "application/json" });
  const RespondGroupJoinRequest = (groupid, userid, action, groupname) => post("/v1/vrchat/groups/moderation/requestjoingroup", { groupid, userid, action, groupname }, { "Content-Type": "application/json" });
  const GetGroupJoinRequests = (groupid, groupname) => post("/v1/vrchat/groups/moderation/getmemberrequests", { groupid, groupname }, { "Content-Type": "application/json" });
  const RespondGroupMemberRequest = (groupid, userId, action, block = false, groupname) => post("/v1/vrchat/groups/moderation/postmemberrequests", { groupid, userId, action, block, groupname }, { "Content-Type": "application/json" });
  const KickGroupUser = (groupid, userid, groupname) => post("/v1/vrchat/groups/moderation/kickmember", { groupid, userid, groupname }, { "Content-Type": "application/json" });
  // NOTE: your original path had "getuditlogs" – keep as-is if the backend expects that typo.
  const GetGroupAuditLog = (groupid, groupname) => post("/v1/vrchat/groups/moderation/getauditlogs", { groupid, groupname }, { "Content-Type": "application/json" });
  const GetGroupInfo = (groupid) => post("/v1/vrchat/groups/getgroup", { groupid }, { "Content-Type": "application/json" });
  const GroupMessages = (payload = {}) => post("/v1/vrchat/groups/messages", payload, { "Content-Type": "application/json" });
  const GroupModeration = (payload = {}) => post("/v1/vrchat/groups/moderation", payload, { "Content-Type": "application/json" });
  const GroupInvite = (payload = {}) => post("/v1/vrchat/groups/invite", payload, { "Content-Type": "application/json" });
  const GroupRole = (payload = {}) => post("/v1/vrchat/groups/role", payload, { "Content-Type": "application/json" });
  const GroupSearch = (payload = {}) => post("/v1/vrchat/groups/search", payload, { "Content-Type": "application/json" });
  const SetGroupMembershipVisibility = (groupid, visibility) => post("/v1/vrchat/groups/membership/visibility", { groupid, visibility }, { "Content-Type": "application/json" });

  function ok(result) {
    const status = Number(result?.status || 0);
    return status >= 200 && status < 300;
  }

  async function EnsureGroupMembershipHidden(groupid) {
    return SetGroupMembershipVisibility(groupid, "hidden");
  }

  async function withHiddenMembership(groupid, action) {
    const result = await action();
    if (!ok(result)) return result;

    const privacy = await EnsureGroupMembershipHidden(groupid);
    return {
      ...result,
      privacy: {
        visibility: "hidden",
        status: privacy.status,
        message: privacy.message || "Bot group membership visibility set to hidden."
      }
    };
  }

  const JoinGroup = (groupid, confirmOverrideBlock = false) => withHiddenMembership(
    groupid,
    () => post("/v1/vrchat/groups/join", { groupid, confirmOverrideBlock }, { "Content-Type": "application/json" })
  );
  const JoinGroupMembership = (groupid, confirmOverrideBlock = false) => withHiddenMembership(
    groupid,
    () => post("/v1/vrchat/groups/membership/join", { groupid, confirmOverrideBlock }, { "Content-Type": "application/json" })
  );
  const AcceptGroupInvite = (groupid) => withHiddenMembership(
    groupid,
    () => post("/v1/vrchat/groups/invites/accept", { groupid }, { "Content-Type": "application/json" })
  );
  const DeclineGroupInvite = (groupid) => post("/v1/vrchat/groups/invites/decline", { groupid }, { "Content-Type": "application/json" });
  const IgnoreGroupInvite = (groupid) => post("/v1/vrchat/groups/invites/ignore", { groupid }, { "Content-Type": "application/json" });
  const GetGroupPosts = (payload = {}) => post("/v1/vrchat/groups/posts/get", payload, { "Content-Type": "application/json" });

  async function GetPendingGroupInvites() {
    const url = `${base}/v1/vrchat/groups/invites/pending`;
    try {
      const response = await fetch(url, { method: "GET" });
      const data = await response.json().catch(() => ({}));
      return {
        status: data.status ?? response.status,
        message: data.message ?? (response.ok ? "OK" : response.statusText),
        bot: data.bot,
        data: data.data
      };
    } catch (err) {
      return { status: 500, message: err.message || "Network error" };
    }
  }

  const GetGroupWorldLog = (instance) => {
    const [worldId, instanceId] = String(instance || "").split(":");
    return post("/v1/vrchat/world/worldInstance", { worldId, instanceId }, { "Content-Type": "application/json" });
  };

  const GetAvatarAnalysisAPI = (fileId, fileVersion) => post("/v1/vrchat/avatars/analysis", { fileId, fileVersion }, { "Content-Type": "application/json" });
  const GetUsersAPI = (userid) => post("/v1/vrchat/users/search/userid", { userid }, { "Content-Type": "application/json" });
  const GetUsersGroupsAPI = (userid) => post("/v1/vrchat/users/search/usergroups", { userid }, { "Content-Type": "application/json" });

  async function GetUserAvatarsAPI(userid) {
    const cleanUserId = String(userid || "").trim();
    const url = `${base}/v1/vrchat/avatars/useravatars/${encodeURIComponent(cleanUserId)}`;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      const data = await response.json().catch(() => ({}));
      return {
        status: data.status ?? response.status,
        message: data.message ?? (response.ok ? "OK" : response.statusText),
        data: data.data ?? data
      };
    } catch (err) {
      return { status: 500, message: err.message || "Network error" };
    }
  }

  // helpers used by your blacklist check
  async function fetchUserGroups(userid) {
    return post("/v1/vrchat/users/search/usergroups", { userid }, { "Content-Type": "application/json" });
  }

  async function fetchAllGroupLists() {
    const baseUrl = "https://vrcloggerpub.nekosunevr.co.uk/v5/games/api/vrchat/yoinker";

    const groupUrls = [
      { url: `${baseUrl}/groupslist`, provider: "globalbanlogger" },
      { url: `${baseUrl}/WTH/groupslist`, provider: "wth" },
      { url: `${baseUrl}/NEKOLOGGER/groupslist`, provider: "nekosunecommunity" },
      { url: `${baseUrl}/NS/groupslist`, provider: "nekostudios" },
      { url: `${baseUrl}/EH/groupslist`, provider: "ehcommunityoasis" },
    ];

    try {
      const resps = await Promise.all(groupUrls.map(async g => {
        try {
          const res = await fetch(g.url, { method: "GET", headers: { "Content-Type": "application/json" } });
          if (!res.ok) return { provider: g.provider, data: [] };
          const json = await res.json();
          return { provider: g.provider, data: json };
        } catch (err) {
          return { provider: g.provider, data: [] };
        }
      }));

      return resps; // <-- raw results, used by both blacklist & watchlist builders
    } catch (err) {
      throw new Error(err.message || "Failed to fetch group lists");
    }
  }

  async function fetchBlacklist() {
    try {
      const groups = await fetchAllGroupLists();

      const blacklist = groups.flatMap(({ provider, data }) =>
        Object.values(data || {})
          .flat()
          .filter(entry => ["MALICIOUS", "NUISANCE"].includes(entry.type))
          .map(entry => ({ ...entry, provider }))
      );

      return {
        status: 200,
        message: "Blacklist fetched.",
        data: blacklist,
      };
    } catch (err) {
      return {
        status: 500,
        message: err.message || "Failed to fetch blacklist.",
      };
    }
  }

  async function fetchWatchlist() {
    try {
      const groups = await fetchAllGroupLists();

      const watchlist = groups.flatMap(({ provider, data }) =>
        Object.values(data || {})
          .flat()
          .filter(entry => entry.type === "WATCHLIST")
          .map(entry => ({ ...entry, provider }))
      );

      return {
        status: 200,
        message: "Watchlist fetched.",
        data: watchlist,
      };
    } catch (err) {
      return {
        status: 500,
        message: err.message || "Failed to fetch watchlist.",
      };
    }
  }

  async function fetchCommunityList() {
    try {
      const groups = await fetchAllGroupLists();

      const community = groups.flatMap(({ provider, data }) =>
        Object.values(data || {})
          .flat()
          .filter(entry => entry.type === "COMMUNITY")
          .map(entry => ({ ...entry, provider }))
      );

      return {
        status: 200,
        message: "Community list fetched.",
        data: community,
      };
    } catch (err) {
      return {
        status: 500,
        message: err.message || "Failed to fetch community list.",
      };
    }
  }

  async function fetchAffiliatedList() {
    try {
      const groups = await fetchAllGroupLists();

      const affiliated = groups.flatMap(({ provider, data }) =>
        Object.values(data || {})
          .flat()
          .filter(entry => entry.type === "AFFILIATED")
          .map(entry => ({ ...entry, provider }))
      );

      return {
        status: 200,
        message: "Affiliated list fetched.",
        data: affiliated,
      };
    } catch (err) {
      return {
        status: 500,
        message: err.message || "Failed to fetch affiliated list.",
      };
    }
  }

  async function GetBannedUsersGroups(userid) {
    try {
      const userGroupsResult = await fetchUserGroups(userid);

      const [
        blacklistResult,
        watchlistResult,
        communityResult,
        affiliatedResult
      ] = await Promise.all([
        fetchBlacklist(),
        fetchWatchlist(),
        fetchCommunityList(),
        fetchAffiliatedList(),
      ]);

      const userGroups = userGroupsResult.data || [];

      const blacklist = blacklistResult.data || [];
      const watchlist = watchlistResult.data || [];
      const community = communityResult.data || [];
      const affiliated = affiliatedResult.data || [];

      // ---- MATCH GROUPS ----
      const matchBlacklist = userGroups.filter(g =>
        blacklist.some(b => b.groupID === g.groupId)
      );

      const matchWatchlist = userGroups.filter(g =>
        watchlist.some(b => b.groupID === g.groupId)
      );

      const matchCommunity = userGroups.filter(g =>
        community.some(b => b.groupID === g.groupId)
      );

      const matchAffiliated = userGroups.filter(g =>
        affiliated.some(b => b.groupID === g.groupId)
      );

      return {
        status: 200,
        found:
          matchBlacklist.length > 0 ||
          matchWatchlist.length > 0 ||
          matchCommunity.length > 0 ||
          matchAffiliated.length > 0,

        message:
          matchBlacklist.length > 0
            ? "User has blacklisted groups."
            : matchWatchlist.length > 0
              ? "User is on watchlist groups."
              : matchCommunity.length > 0
                ? "User is in community groups."
                : matchAffiliated.length > 0
                  ? "User is in affiliated groups."
                  : "No flagged groups found.",

        userGroups: userGroupsResult.data,

        blacklistMatches: matchBlacklist,
        watchlistMatches: matchWatchlist,
        communityMatches: matchCommunity,
        affiliatedMatches: matchAffiliated,
      };

    } catch (err) {
      return {
        status: 500,
        found: false,
        message: err.message || "Unexpected error in group detection."
      };
    }
  }

  return {
    BanGroupUser,
    UnbanGroupUser,
    KickGroupUser,
    RespondGroupJoinRequest,
    GetGroupJoinRequests,
    RespondGroupMemberRequest,
    GetGroupAuditLog,
    GetGroupInfo,
    GroupMessages,
    GroupModeration,
    GroupInvite,
    GroupRole,
    GroupSearch,
    JoinGroup,
    JoinGroupMembership,
    SetGroupMembershipVisibility,
    EnsureGroupMembershipHidden,
    GetPendingGroupInvites,
    AcceptGroupInvite,
    DeclineGroupInvite,
    IgnoreGroupInvite,
    GetGroupPosts,
    GetAvatarAnalysisAPI,
    GetUsersAPI,
    GetUsersGroupsAPI,
    GetUserAvatarsAPI,
    GetBannedUsersGroups,
    fetchUserGroups,
    GetGroupWorldLog,
    fetchBlacklist,
    fetchAffiliatedList,
    fetchCommunityList,
    fetchWatchlist
  };
}

module.exports = { createVrchatApi };
