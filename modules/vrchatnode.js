const vrchat = require("vrchat"); //npm vrchat
if (!Promise.withResolvers) {
  Promise.withResolvers = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
//require('log-timestamp');                 //npm log-timestamp
const throttledQueue = require("throttled-queue");
const { Blob } = require("buffer");
const { AsyncLocalStorage } = require("async_hooks");

const throttle = throttledQueue(3, 60000, true); // Adding RateLimit, 3 request per minutes

const { betterlog } = require("../dependencies.js");
const config = require("../config/config.json");
const packageJson = require("../package.json");

let lastTime = new Date();
let lastPing = new Date();
lastPing = lastPing.getTime();

const accountRequestContext = new AsyncLocalStorage();

const normalizeNonNegativeInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const formatDuration = (ms) => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
};

// One VRChat account: the logger account for this group. Staff permissions are
// handled entirely by the Discord bot and its dashboard, not here.
const buildAccountConfig = () => {
  const vrchatConfig = config.VRChat || {};
  const account = vrchatConfig.account || vrchatConfig;

  return {
    name: account.name || "logger",
    user: account.user,
    pass: account.pass,
    twofa: account.twofa
  };
};

const createClient = (account) => {
  return new vrchat.VRChat({
    baseUrl: "https://api.vrchat.cloud/api/1",
    application: {
      name: "NEKOSUNEVRCLOGGER",
      version: packageJson.version || "1.0.0",
      contact: "https://nekosunevr.co.uk?redirect=discord"
    },
    authentication: {
      credentials: {
        username: account.user,
        password: account.pass,
        ...(account.twofa ? { totpSecret: account.twofa } : {})
      },
      optimistic: true
    }
  });
};

const loggerAccount = {
  ...buildAccountConfig(),
  currentUser: null,
  authenticated: false,
  status: "pending",
  client: null
};
loggerAccount.client = createClient(loggerAccount);

const vrchatConfig = config.VRChat || {};
const loginQueueSettings = {
  retryCooldownMs: normalizeNonNegativeInteger(vrchatConfig.loginRetryCooldownMs, 300000),
  maxRetries: normalizeNonNegativeInteger(vrchatConfig.loginMaxRetries, 2)
};

const getActiveAccount = () => {
  return accountRequestContext.getStore() || loggerAccount;
};

const getActiveClient = () => {
  const account = getActiveAccount();
  if (!account?.client) {
    throw new Error("No VRChat account is configured.");
  }
  return account.client;
};

const vrc = new Proxy({}, {
  get(_target, property) {
    const client = getActiveClient();
    const value = client[property];
    return typeof value === "function" ? value.bind(client) : value;
  },
  set(_target, property, value) {
    const client = getActiveClient();
    client[property] = value;
    return true;
  }
});

const getSelfInfo = async () => {
  const account = getActiveAccount();
  if (account?.currentUser?.id && account?.currentUser?.displayName) {
    return { id: account.currentUser.id, displayName: account.currentUser.displayName };
  }
  try {
    const selfResp = await vrc.getCurrentUser({ throwOnError: true });
    if (selfResp?.data?.id) {
      account.currentUser = selfResp.data;
      return { id: account.currentUser.id, displayName: account.currentUser.displayName };
    }
  } catch (error) {
    betterlog.vrchatError(`Failed to resolve self user id for ${account?.name || "unknown"}: ${error?.message || error}`);
  }
  return null;
};

const useVRChatAccountForRequest = (req, res, next) => {
  const account = loggerAccount;

  accountRequestContext.run(account, () => {
    const isStatusRoute = req.method === "GET" && req.path === "/";
    if (!isStatusRoute && !account.authenticated) {
      res.status(503).json({
        status: 503,
        message: `VRChat account ${account.name} is ${account.status}.`,
        account: account.name
      });
      return;
    }

    next();
  });
};

const getVRChatAccountStatus = () => ({
  name: loggerAccount.name,
  authenticated: Boolean(loggerAccount.authenticated),
  status: loggerAccount.status,
  displayName: loggerAccount.currentUser?.displayName || null
});

const authenticateAccount = async (account) => {
  try {
    account.status = "authenticating";
    account.authenticated = false;
    const authResult = await account.client.authenticate();
    if (!authResult?.data?.displayName) {
      betterlog.vrchatError(`Login failed for ${account.name}: missing displayName.`);
      account.status = "failed";
      return { ok: false, retryable: false };
    }

    account.currentUser = authResult.data;
    betterlog.vrchatLogin(`Logged in ${account.name} as ${account.currentUser.displayName}`);

    const tokenResp = await account.client.verifyAuthToken({ throwOnError: true });
    const authToken = tokenResp?.data?.token;
    if (!authToken) {
      betterlog.vrchatError(`Missing auth token for VRChat pipeline on ${account.name}.`);
      account.authenticated = false;
      account.status = "failed";
      return { ok: false, retryable: true };
    }

    account.client.pipeline.authenticate(authToken);
    account.client.on("notification", notification => HandleNotification(notification, account));
    account.authenticated = true;
    account.status = "authenticated";
    return { ok: true };
  } catch (error) {
    const status = error?.response?.status;
    const retryable = !status || status === 408 || status === 429 || status >= 500;
    account.authenticated = false;
    account.status = "failed";
    betterlog.vrchatError(`VRChat authentication failed for ${account.name}: ${error?.message || error}`);
    return { ok: false, retryable };
  }
};

const waitBeforeLogin = async (account, waitMs, reason) => {
  if (waitMs <= 0) return;
  account.status = "waiting";
  betterlog.vrchatLogin(`Waiting ${formatDuration(waitMs)} before ${reason} for ${account.name}.`);
  await sleep(waitMs);
};

const authenticateAccountWithRetry = async (account) => {
  const totalAttempts = loginQueueSettings.maxRetries + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    if (attempt > 1) {
      await waitBeforeLogin(
        account,
        loginQueueSettings.retryCooldownMs,
        `retry ${attempt}/${totalAttempts}`
      );
    }

    const result = await authenticateAccount(account);
    if (result.ok) return true;

    if (!result.retryable) {
      betterlog.vrchatError(`Login for ${account.name} is not retryable; skipping remaining retries.`);
      return false;
    }
  }

  account.status = "failed";
  betterlog.vrchatError(`Login for ${account.name} failed after ${totalAttempts} attempt(s).`);
  return false;
};

//CONNECTION CODE
(async () => {
  if (!loggerAccount.user || !loggerAccount.pass) {
    betterlog.vrchatError("No VRChat logger account configured. Set VRChat.account in config/config.json.");
    return;
  }

  await authenticateAccountWithRetry(loggerAccount);
})();

// HANDLING A RECIEVED MESSAGE
function HandleNotification(notification, account = getActiveAccount()) {
  switch (notification.type) {
    case "requestInvite":
      break;
    case "friendRequest":
      break;
  }
}

//////////////////////////////////GROUP STUFF//////////////////////////////////

async function SearchGroups(search) {
  return new Promise((resolve, reject) => {
    vrc.searchGroups({
      query: { query: search },
      throwOnError: true
    })
      .then(resp => {
        const response = {
          status: 200,
          message: "Found Groups!",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function GetGroupById(groupId) {
  return new Promise((resolve, reject) => {
    vrc.getGroup({
      path: { groupId },
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Fetched group.",
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        });
      });
  });
}

async function GetGroupPosts(groupId, { n, offset, publicOnly } = {}) {
  return new Promise((resolve, reject) => {
    vrc.getGroupPosts({
      path: { groupId },
      query: { n, offset, publicOnly },
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Fetched group posts.",
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        });
      });
  });
}

async function GetCalendarEvents({ date, n, offset } = {}) {
  return new Promise((resolve, reject) => {
    vrc.getCalendarEvents({
      query: { date, n, offset },
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Fetched calendar events.",
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        });
      });
  });
}

async function GetFeaturedCalendarEvents({ date, n, offset } = {}) {
  return new Promise((resolve, reject) => {
    vrc.getFeaturedCalendarEvents({
      query: { date, n, offset },
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Fetched featured calendar events.",
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        });
      });
  });
}

async function SearchCalendarEvents({ searchTerm, utcOffset, n, offset, isInternalVariant } = {}) {
  return new Promise((resolve, reject) => {
    vrc.searchCalendarEvents({
      query: { searchTerm, utcOffset, n, offset, isInternalVariant },
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Fetched calendar search results.",
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        });
      });
  });
}

async function GetGroupCalendarEvents(groupId, { date, n, offset } = {}) {
  return new Promise((resolve, reject) => {
    vrc.getGroupCalendarEvents({
      path: { groupId },
      query: { date, n, offset },
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Fetched group calendar events.",
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        });
      });
  });
}

async function GetGroupCalendarEvent(groupId, calendarId) {
  return new Promise((resolve, reject) => {
    vrc.getGroupCalendarEvent({
      path: { groupId, calendarId },
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Fetched group calendar event.",
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        });
      });
  });
}

async function GetGroupCalendarEventIcs(groupId, calendarId) {
  return new Promise((resolve, reject) => {
    vrc.getGroupCalendarEventIcs({
      path: { groupId, calendarId },
      parseAs: "text",
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Fetched calendar event ICS.",
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        });
      });
  });
}

async function CreateGroupCalendarEvent(groupId, eventData) {
  return new Promise((resolve, reject) => {
    vrc.createGroupCalendarEvent({
      path: { groupId },
      body: eventData,
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Created group calendar event.",
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        });
      });
  });
}

async function UpdateGroupCalendarEvent(groupId, calendarId, eventData) {
  return new Promise((resolve, reject) => {
    vrc.updateGroupCalendarEvent({
      path: { groupId, calendarId },
      body: eventData,
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Updated group calendar event.",
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        });
      });
  });
}

async function DeleteGroupCalendarEvent(groupId, calendarId) {
  return new Promise((resolve, reject) => {
    vrc.deleteGroupCalendarEvent({
      path: { groupId, calendarId },
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Deleted group calendar event.",
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        });
      });
  });
}

async function JoinGroup(groupId, confirmOverrideBlock = false) {
  return new Promise((resolve, reject) => {
    vrc.joinGroup({
      path: { groupId },
      query: { confirmOverrideBlock },
      throwOnError: true
    })
      .then(resp => {
        const response = {
          status: 200,
          message: "Joined group.",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function SetGroupVisibility(groupId, visibility) {
  return new Promise(async (resolve, reject) => {
    const selfInfo = await getSelfInfo();
    if (!selfInfo?.id) {
      resolve({
        status: 500,
        message: "Unable to resolve bot user id."
      });
      return;
    }

    vrc.updateGroupMember({
      path: { groupId, userId: selfInfo.id },
      body: { visibility },
      throwOnError: true
    })
      .then(resp => {
        const response = {
          status: 200,
          message: "Updated group visibility.",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function JoinGroupSmart(groupId, confirmOverrideBlock = false) {
  return new Promise(async (resolve, reject) => {
    const selfInfo = await getSelfInfo();
    if (!selfInfo?.id) {
      resolve({
        status: 500,
        message: "Unable to resolve bot user id."
      });
      return;
    }

    try {
      const groupResp = await vrc.getGroup({
        path: { groupId },
        throwOnError: true
      });
      const joinState = groupResp?.data?.joinState;

      if (joinState === "invite") {
        resolve({
          status: 403,
          message: "Invite only. Please invite the bot to this group.",
          bot: selfInfo
        });
        return;
      }

      if (joinState === "closed") {
        resolve({
          status: 403,
          message: "Group is closed to new members.",
          bot: selfInfo
        });
        return;
      }

      const joinResp = await vrc.joinGroup({
        path: { groupId },
        query: { confirmOverrideBlock },
        throwOnError: true
      });

      const message = joinState === "request" ? "Join request submitted." : "Joined group.";

      resolve({
        status: 200,
        message,
        bot: selfInfo,
        data: joinResp.data
      });
    } catch (e) {
      resolve({
        status: e?.response?.status || 500,
        message: e?.response?.statusText || e?.message,
        bot: selfInfo
      });
    }
  });
}

async function GetPendingGroupInvites() {
  return new Promise(async (resolve, reject) => {
    const selfInfo = await getSelfInfo();
    if (!selfInfo?.id) {
      resolve({
        status: 500,
        message: "Unable to resolve bot user id."
      });
      return;
    }

    vrc.getInvitedGroups({
      path: { userId: selfInfo.id },
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Fetched pending group invites.",
          bot: selfInfo,
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message,
          bot: selfInfo
        });
      });
  });
}

async function AcceptGroupInvite(groupId, confirmOverrideBlock = false) {
  return new Promise(async (resolve, reject) => {
    const selfInfo = await getSelfInfo();
    if (!selfInfo?.id) {
      resolve({
        status: 500,
        message: "Unable to resolve bot user id."
      });
      return;
    }

    vrc.joinGroup({
      path: { groupId },
      query: { confirmOverrideBlock },
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Accepted group invite.",
          bot: selfInfo,
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message,
          bot: selfInfo
        });
      });
  });
}

async function DeclineGroupInvite(groupId, block = false) {
  return new Promise(async (resolve, reject) => {
    const selfInfo = await getSelfInfo();
    if (!selfInfo?.id) {
      resolve({
        status: 500,
        message: "Unable to resolve bot user id."
      });
      return;
    }

    vrc.declineGroupInvite({
      path: { groupId },
      body: { block },
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: block ? "Declined invite and blocked future invites." : "Declined group invite.",
          bot: selfInfo,
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message,
          bot: selfInfo
        });
      });
  });
}

async function ScanGroupAuditLogsSequential(groupId, lastSavedDate, {
  pageSize = 100,
  delayMs = 30000,
  maxRetries = 4,
  onPage = () => {}
} = {}) {

  let offset = 0;
  let allNewLogs = [];
  let keepGoing = true;

  while (keepGoing) {
    let resp = null;

    // --- retry block ---
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        resp = await vrc.getGroupAuditLogs({
          path: { groupId },
          query: { n: pageSize, offset },
          throwOnError: true
        });
        break;
      } catch (err) {
        betterlog.vrchatError(`Group ${groupId} | ERROR on page ${offset / pageSize} attempt ${attempt}/${maxRetries}`);

        if (attempt === maxRetries) throw err;

        await new Promise(r => setTimeout(r, delayMs * 2)); // bigger wait on retry
      }
    }

    const chunk = resp.data?.results ?? [];
    if (chunk.length === 0) break;

    // callback for monitoring
    onPage(offset / pageSize, chunk);

    // append only NEW logs
    for (const log of chunk) {
      const created = new Date(log.created_at);

      if (lastSavedDate && created <= lastSavedDate) {
        keepGoing = false;
        break;
      }

      allNewLogs.push(log);
    }

    // next page
    offset += pageSize;

    // delay between calls
    await new Promise(r => setTimeout(r, delayMs));
  }

  return {
    logs: allNewLogs,
    totalFetched: allNewLogs.length
  };
}

/**
 * Fetch ALL audit logs using offset-based pagination, but slowly to avoid rate limiting.
 *
 * @param {string} groupId
 * @param {object} opts
 *   - pageSize (n): number per request (default 100)
 *   - delayMs: delay between successful requests in ms (default 500)
 *   - maxRetries: retries for 429/5xx (default 5)
 *   - maxBackoffMs: cap for exponential backoff in ms (default 30_000)
 *   - onProgress: optional (pageIndex, chunk, accumulated) => void callback
 */
async function GetAllGroupAuditLogsRateLimited(groupId, opts = {}) {
  const {
    pageSize = 100,
    delayMs = 500,
    maxRetries = 5,
    maxBackoffMs = 30_000,
    onProgress = null,
  } = opts;

  const sleep = (ms) => new Promise(res => setTimeout(res, ms));
  const allLogs = [];
  let offset = 0;
  let pageIndex = 0;

  try {
    while (true) {
      let attempt = 0;
      while (true) {
        try {
          // Call the API (n = pageSize, offset)
          const resp = await vrc.getGroupAuditLogs({
            path: { groupId },
            query: { n: pageSize, offset },
            throwOnError: true
          });
          const data = resp?.data ?? {};

          const chunk = Array.isArray(data.results) ? data.results : [];
          allLogs.push(...chunk);

          // progress callback
          if (typeof onProgress === 'function') {
            try { onProgress(pageIndex, chunk, allLogs); } catch (cbErr) { /* swallow callback errors */ }
          }

          // If less than pageSize returned, we've reached the last page
          if (chunk.length < pageSize) {
            return {
              status: 200,
              message: "Fetched ALL audit logs (rate-limited safe).",
              total: allLogs.length,
              data: allLogs,
            };
          }

          // Prepare for next page
          offset += pageSize;
          pageIndex += 1;

          // Wait a bit between successful requests to avoid hitting rate limits
          await sleep(delayMs);
          break; // break retry loop, go to next page

        } catch (e) {
          attempt += 1;
          const status = e?.response?.status;

          // If 429 (Too Many Requests) or server error (5xx) then retry
          const shouldRetry = (status === 429) || (status >= 500 && status < 600);

          if (shouldRetry && attempt <= maxRetries) {
            // exponential backoff with jitter
            const backoff = Math.min((2 ** attempt) * delayMs + Math.random() * 200, maxBackoffMs);
            console.warn(`getGroupAuditLogs attempt ${attempt}/${maxRetries} failed (status ${status}). Backing off ${Math.round(backoff)}ms then retrying...`);
            await sleep(backoff);
            continue; // retry
          }

          // Non-retriable or out of retries -> return partial data + error info
          betterlog.vrchatError(`getGroupAuditLogs failed, returning partial results: ${e?.message || e}`);
          return {
            status: status ?? 500,
            message: e?.response?.statusText ?? e?.message ?? 'Unknown error',
            totalFetched: allLogs.length,
            data: allLogs,
            error: {
              // lightly sanitized error details
              status,
              body: e?.response?.data ?? null,
            },
          };
        }
      } // end retry loop
    } // end pagination loop
  } catch (outerErr) {
    // Unexpected error
    return {
      status: 500,
      message: 'Unexpected error during fetching audit logs',
      totalFetched: allLogs.length,
      data: allLogs,
      error: { message: outerErr?.message },
    };
  }
}

async function GetGroupAuditLog(groupid) {
  return new Promise((resolve, reject) => {
    vrc.getGroupAuditLogs({
      path: { groupId: groupid },
      throwOnError: true
    })
      .then(resp => {
        const response = {
          status: 200,
          message: "Get Audit Logs!",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function SendGroupMessage(groupid, title, text, bool) {
  return new Promise((resolve, reject) => {
    vrc.createGroupAnnouncement({
      path: { groupId: groupid },
      body: {
        title: title,
        text: text,
        sendNotification: bool
      },
      throwOnError: true
    })
      .then(resp => {
        const response = {
          status: 200,
          message: "Sended Announcement!",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function GetGroupMembers(groupId) {
  return new Promise(async (resolve, reject) => {
    let members = [];
    let offset = 0; // Start from the first member
    const n = 100; // Number of members to retrieve per request
    let moreMembers = true;

    try {
      while (moreMembers) {
        // Fetch a batch of members
        const response = await vrc.getGroupMembers({
          path: { groupId },
          query: { n, offset },
          throwOnError: true
        });

        if (response && response.data && response.data.length > 0) {
          // Add the fetched members to the list
          members = members.concat(response.data);

          // Check if there are more members to fetch
          moreMembers = response.data.length === n; // If we received 'n' members, there might be more
          offset += n; // Move to the next set of members
        } else {
          moreMembers = false; // No more members
        }
      }

      resolve(members);
    } catch (error) {
      betterlog.vrchatError(`Error fetching VRChat group members: ${error?.message || error}`);
      reject(error);
    }
  });
}

async function KickGroupUser(groupid, userid) {
  return new Promise((resolve, reject) => {
    vrc.kickGroupMember({
      path: { groupId: groupid, userId: `${userid}` },
      throwOnError: true
    })
      .then(resp => {
        const response = {
          status: 200,
          message: "Kick USER!",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function RespondGroupJoinRequest(groupid, userid, action, block = false) {
  betterlog.vrchatGroup(`Responding user ${userid} Joining Request from group ${groupid}...`);
  return new Promise((resolve, reject) => {
    const payload = {
      action: action,
      block: block
    };
    vrc.respondGroupJoinRequest({
      path: { groupId: groupid, userId: userid },
      body: payload,
      throwOnError: true
    })
    .then(resp => {
        betterlog.vrchatGroup(`Responding user ${userid} Joining Request from group successfully!`);
        const response = {
          status: 200,
          message: "REQUEST SENDED!",
          data: resp.data
        };
        resolve(response);
    })
    .catch(e => {
        betterlog.vrchatError(`Error Responding user ${userid} Joining Request from group ${groupid}: ${e?.message || e}`);
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
    });
  });
}

async function BanGroupUser(groupid, userid) {
  betterlog.vrchatGroup(`Banning user ${userid} from group ${groupid}...`);
  return new Promise((resolve, reject) => {
    vrc.banGroupMember({
      path: { groupId: groupid },
      body: { userId: `${userid}` },
      throwOnError: true
    })
      .then(resp => {
        betterlog.vrchatGroup(`User ${userid} banned from group ${groupid} successfully!`);
        const response = {
          status: 200,
          message: "Banned USER!",
          data: resp.data
        };
        resolve(response);
})
      .catch(e => {
        betterlog.vrchatError(`Error banning user ${userid} from group ${groupid}: ${e?.message || e}`);
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function UnbanGroupUser(groupid, userid) {
  return new Promise((resolve, reject) => {
    vrc.unbanGroupMember({
      path: { groupId: groupid, userId: userid },
      throwOnError: true
    })
      .then(resp => {
        const response = {
          status: 200,
          message: "Unbanned USER!",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}


async function GroupInvite(groupid, userid) {
  return new Promise((resolve, reject) => {
    vrc.createGroupInvite({
      path: { groupId: groupid },
      body: {
        userId: userid,
        confirmOverrideBlock: false
      },
      throwOnError: true
    }).then(resp => {
        const response = {
          status: 200,
          message: "Invite the USER to group",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function AddGroupRoles(groupid, userId, groupRoleId) {
  return new Promise((resolve, reject) => {
    vrc.addGroupMemberRole({
      path: { groupId: groupid, userId, groupRoleId },
      throwOnError: true
    }).then(resp => {
        const response = {
          status: 200,
          message: "Give USER role to Group",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function RemoveGroupRoles(groupid, userId, groupRoleId) {
  return new Promise((resolve, reject) => {
    vrc.removeGroupMemberRole({
      path: { groupId: groupid, userId, groupRoleId },
      throwOnError: true
    }).then(resp => {
        const response = {
          status: 200,
          message: "Remove USER role to Group",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function GetGroupRoles(groupid) {
  return new Promise((resolve, reject) => {
    vrc.getGroupRoles({
      path: { groupId: groupid },
      throwOnError: true
    }).then(resp => {
        const response = {
          status: 200,
          message: "List Group Roles",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function GetGroupUserRequest(groupid) {
  return new Promise((resolve, reject) => {
    vrc.getGroupRequests({
      path: { groupId: groupid },
      throwOnError: true
    }).then(resp => {
        const response = {
          status: 200,
          message: "Get Members Group Request",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function PostGroupUserRequest(groupid, userId, action, block) {
  return new Promise((resolve, reject) => {
    vrc.respondGroupJoinRequest({
      path: { groupId: groupid, userId },
      body: {
        action: action,
        block: block
      },
      throwOnError: true
    }).then(resp => {
        const response = {
          status: 200,
          message: "Respond Members Group Request",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function SearchGroups(groupid) {
  return new Promise((resolve, reject) => {
    vrc.getGroup({
      path: { groupId: groupid },
      throwOnError: true
    }).then(resp => {
        const response = {
          status: 200,
          message: "Respond Get Group Request",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

//////////////////////////////////////////////////////////////////////////////

//////////////////////////////////USER STUFF//////////////////////////////////

async function GetUsers(userid) {
  return new Promise((resolve, reject) => {
    vrc.getUser({
      path: { userId: userid },
      throwOnError: true
    })
      .then(resp => {
        const response = {
          status: 200,
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function GetSelf() {
  return new Promise((resolve, reject) => {
    vrc.getCurrentUser({ throwOnError: true })
      .then(resp => {
        const response = {
          status: 200,
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function SearchUser(displayname) {
  return new Promise((resolve, reject) => {
    vrc.searchUsers({
      query: { search: displayname },
      throwOnError: true
    })
      .then(resp => {
        const matchedData = resp.data.filter(
          item => item.displayName === displayname
        );
        const response = {
          status: 200,
          data: matchedData
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function UserGroupsleepy(userid) {
  return new Promise((resolve, reject) => {
    vrc.getUserGroups({
      path: { userId: userid },
      throwOnError: true
    })
      .then(resp => {
        const response = {
          status: 200,
          message: "Get USER groups!",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function GetCurrentOnlineUsers() {
  return new Promise((resolve, reject) => {
    vrc.getCurrentOnlineUsers({ throwOnError: true })
      .then(resp => {
        resolve({
          status: 200,
          message: "Fetched current online users.",
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        });
      });
  });
}

//////////////////////////////////////////////////////////////////////////////

//////////////////////////////////WORLD STUFF//////////////////////////////////

async function GetWorldInfo(worldid) {
  return new Promise((resolve, reject) => {
    vrc.getWorld({
      path: { worldId: worldid },
      throwOnError: true
    })
      .then(resp => {
        const response = {
          status: 200,
          message: "Get World Info!",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function SearchWorld(search) {
  return new Promise((resolve, reject) => {
    vrc.searchWorlds({
      query: { search },
      throwOnError: true
    })
      .then(resp => {
        const response = {
          status: 200,
          message: "Get World Search!",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function SearchUserWorld(userId) {
  return new Promise(async (resolve, reject) => {
    const allWorlds = [];
    let offset = 0;
    const limit = 100;

    try {
      let keepFetching = true;

      while (keepFetching) {
        const resp = await vrc.searchWorlds({
          query: {
            userId,
            n: limit,
            order: "descending",
            offset
          },
          throwOnError: true
        });

        const batch = (resp?.data || []).map(world => {
          const { udonProducts, unityPackages, ...cleaned } = world;
          return cleaned;
        });

        allWorlds.push(...batch);
        keepFetching = batch.length === limit;
        offset += limit;
      }

      resolve({
        status: 200,
        message: "Get User World Search!",
        data: allWorlds
      });
    } catch (e) {
      resolve({
        status: e?.response?.status || 500,
        message: e?.response?.statusText || e?.message || "Error fetching user worlds"
      });
    }
  });
}

async function GetWorldInstance(worldId, instanceId) {
  return new Promise((resolve, reject) => {
    vrc.getWorldInstance({
      path: { worldId, instanceId },
      throwOnError: true
    })
      .then(resp => {
        const response = {
          status: 200,
          message: "Get World Instance!",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

const buildPrintImageBlob = (imageBase64) => {
  if (!imageBase64) return null;
  const cleaned = imageBase64.replace(/^data:.*;base64,/, "");
  const buffer = Buffer.from(cleaned, "base64");
  return new Blob([buffer], { type: "image/png" });
};

const cleanRequestObject = (source = {}) => {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== null)
  );
};

async function InventoryRequest(method, url, {
  path,
  query,
  body,
  message
} = {}) {
  try {
    const options = {
      url,
      throwOnError: true
    };
    const cleanedPath = cleanRequestObject(path);
    const cleanedQuery = cleanRequestObject(query);

    if (Object.keys(cleanedPath).length > 0) options.path = cleanedPath;
    if (Object.keys(cleanedQuery).length > 0) options.query = cleanedQuery;
    if (body !== undefined) {
      options.body = body;
      options.headers = { "Content-Type": "application/json" };
    }

    const resp = await vrc.client[method](options);
    return {
      status: 200,
      message,
      data: resp.data
    };
  } catch (e) {
    return {
      status: e?.response?.status || 500,
      message: e?.response?.statusText || e?.message
    };
  }
}

async function GetInventory({ n, offset, order, tags, types, flags, notTypes, notFlags, archived } = {}) {
  return InventoryRequest("get", "/inventory", {
    query: { n, offset, order, tags, types, flags, notTypes, notFlags, archived },
    message: "Fetched inventory."
  });
}

async function GetInventoryCollections() {
  return InventoryRequest("get", "/inventory/collections", {
    message: "Fetched inventory collections."
  });
}

async function GetInventoryDrops({ active } = {}) {
  return InventoryRequest("get", "/inventory/drops", {
    query: { active },
    message: "Fetched inventory drops."
  });
}

async function GetInventoryTemplate(inventoryTemplateId) {
  return InventoryRequest("get", "/inventory/template/{inventoryTemplateId}", {
    path: { inventoryTemplateId },
    message: "Fetched inventory template."
  });
}

async function GetOwnInventoryItem(inventoryItemId) {
  return InventoryRequest("get", "/inventory/{inventoryItemId}", {
    path: { inventoryItemId },
    message: "Fetched own inventory item."
  });
}

async function GetUserInventoryItem(userId, inventoryItemId) {
  return InventoryRequest("get", "/user/{userId}/inventory/{inventoryItemId}", {
    path: { userId, inventoryItemId },
    message: "Fetched user inventory item."
  });
}

async function UpdateOwnInventoryItem(inventoryItemId, inventoryItemData = {}) {
  return InventoryRequest("put", "/inventory/{inventoryItemId}", {
    path: { inventoryItemId },
    body: inventoryItemData,
    message: "Updated own inventory item."
  });
}

async function DeleteOwnInventoryItem(inventoryItemId) {
  return InventoryRequest("delete", "/inventory/{inventoryItemId}", {
    path: { inventoryItemId },
    message: "Deleted own inventory item."
  });
}

async function ConsumeOwnInventoryItem(inventoryItemId) {
  return InventoryRequest("put", "/inventory/{inventoryItemId}/consume", {
    path: { inventoryItemId },
    message: "Consumed own inventory item."
  });
}

async function EquipOwnInventoryItem(inventoryItemId, { equipSlot } = {}) {
  return InventoryRequest("put", "/inventory/{inventoryItemId}/equip", {
    path: { inventoryItemId },
    body: cleanRequestObject({ equipSlot }),
    message: "Equipped own inventory item."
  });
}

async function UnequipOwnInventorySlot(slot) {
  return InventoryRequest("delete", "/inventory/{slot}/equip", {
    path: { slot },
    message: "Unequipped own inventory slot."
  });
}

async function SpawnInventoryItem(id) {
  return InventoryRequest("get", "/inventory/spawn", {
    query: { id },
    message: "Spawned inventory item."
  });
}

async function ShareInventoryItemByPedestal(itemId, duration) {
  return InventoryRequest("get", "/inventory/cloning/pedestal", {
    query: { itemId, duration },
    message: "Created inventory sharing pedestal."
  });
}

async function ShareInventoryItemDirect(itemId, users, duration) {
  return InventoryRequest("post", "/inventory/cloning/direct", {
    query: { itemId, duration },
    body: cleanRequestObject({ itemId, users }),
    message: "Shared inventory item directly."
  });
}

async function getPrints(printid) {
  return new Promise(async (resolve, reject) => {
    vrc.getPrint({
      path: { printId: printid },
      throwOnError: true
    })
      .then(async resp => {
        const userInfo = await GetUsers(resp.data.ownerId);

        if (userInfo) {
          resp.data.ownerName = userInfo.data.displayName || "Unknown"; // Assuming `name` is the correct field
        }
        const response = {
          status: 200,
          message: "Prints DATA!",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function GetOwnPrints() {
  return new Promise(async (resolve, reject) => {
    const selfInfo = await getSelfInfo();
    if (!selfInfo?.id) {
      resolve({
        status: 500,
        message: "Unable to resolve bot user id."
      });
      return;
    }

    vrc.getUserPrints({
      path: { userId: selfInfo.id },
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Fetched own prints.",
          bot: selfInfo,
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message,
          bot: selfInfo
        });
      });
  });
}

async function UploadPrint({ imageBase64, note, timestamp, worldId, worldName } = {}) {
  return new Promise((resolve, reject) => {
    const image = buildPrintImageBlob(imageBase64);
    if (!image) {
      resolve({
        status: 400,
        message: "imageBase64 is required."
      });
      return;
    }

    const when = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(when.getTime())) {
      resolve({
        status: 400,
        message: "Invalid timestamp."
      });
      return;
    }

    vrc.uploadPrint({
      body: {
        image,
        note,
        timestamp: when,
        worldId,
        worldName
      },
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Uploaded print.",
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        });
      });
  });
}

async function EditPrint(printId, { imageBase64, note } = {}) {
  return new Promise((resolve, reject) => {
    const image = buildPrintImageBlob(imageBase64);
    if (!image) {
      resolve({
        status: 400,
        message: "imageBase64 is required."
      });
      return;
    }

    vrc.editPrint({
      path: { printId },
      body: {
        image,
        note
      },
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Edited print.",
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        });
      });
  });
}

async function DeletePrint(printId) {
  return new Promise((resolve, reject) => {
    vrc.deletePrint({
      path: { printId },
      throwOnError: true
    })
      .then(resp => {
        resolve({
          status: 200,
          message: "Deleted print.",
          data: resp.data
        });
      })
      .catch(e => {
        resolve({
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        });
      });
  });
}

async function getFileAnalysis(fileId, versionId) {
  return new Promise(async (resolve, reject) => {
    vrc.getFileAnalysisSecurity({
      path: { fileId, versionId },
      throwOnError: true
    })
      .then(async resp => {
        const response = {
          status: 200,
          message: "File Analysis DATA!",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function SendFriendRequest(userid) {
  return new Promise(async (resolve, reject) => {
    vrc.friend({
      path: { userId: userid },
      throwOnError: true
    })
      .then(async resp => {
        const response = {
          status: 200,
          message: "Send Friend Request DATA!",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function DeleteFriendRequest(userid) {
  return new Promise(async (resolve, reject) => {
    vrc.deleteFriendRequest({
      path: { userId: userid },
      throwOnError: true
    })
      .then(async resp => {
        const response = {
          status: 200,
          message: "Delete Friend Request DATA!",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function GetFriendStatus(userid) {
  return new Promise(async (resolve, reject) => {
    vrc.getFriendStatus({
      path: { userId: userid },
      throwOnError: true
    })
      .then(async resp => {
        const response = {
          status: 200,
          message: "Get Friend Status DATA!",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}

async function UnFriend(userid) {
  return new Promise(async (resolve, reject) => {
    vrc.unfriend({
      path: { userId: userid },
      throwOnError: true
    })
      .then(async resp => {
        const response = {
          status: 200,
          message: "UnFriend DATA!",
          data: resp.data
        };
        resolve(response);
      })
      .catch(e => {
        const response = {
          status: e?.response?.status || 500,
          message: e?.response?.statusText || e?.message
        };
        resolve(response);
      });
  });
}


async function SearchUserAvatar(userId) {
  return new Promise(async (resolve, reject) => {
    const allWorlds = [];
    let offset = 0;
    const limit = 100;

    try {
      let keepFetching = true;

      while (keepFetching) {
        const resp = await vrc.searchAvatars({
          query: {
            userId,
            n: limit,
            order: "descending",
            offset
          },
          throwOnError: true
        });

        const batch = (resp?.data || []).map(world => {
          const { unityPackages, ...cleaned } = world;
          return cleaned;
        });

        allWorlds.push(...batch);
        keepFetching = batch.length === limit;
        offset += limit;
      }

      resolve({
        status: 200,
        message: "Get User Avatars Search!",
        data: allWorlds
      });
    } catch (e) {
      resolve({
        status: e?.response?.status || 500,
        message: e?.response?.statusText || e?.message || "Error fetching user avatars"
      });
    }
  });
}

//////////////////////////////////////////////////////////////////////////////

module.exports = {
  useVRChatAccountForRequest,
  getVRChatAccountStatus,
  SendGroupMessage,
  GetUsers,
  GetSelf,
  SearchUser,
  BanGroupUser,
  UnbanGroupUser,
  GetGroupAuditLog,
  SearchGroups,
  GetGroupById,
  GetGroupPosts,
  JoinGroup,
  SetGroupVisibility,
  JoinGroupSmart,
  GetPendingGroupInvites,
  AcceptGroupInvite,
  DeclineGroupInvite,
  GetCalendarEvents,
  GetFeaturedCalendarEvents,
  SearchCalendarEvents,
  GetGroupCalendarEvents,
  GetGroupCalendarEvent,
  GetGroupCalendarEventIcs,
  CreateGroupCalendarEvent,
  UpdateGroupCalendarEvent,
  DeleteGroupCalendarEvent,
  KickGroupUser,
  UserGroupsleepy,
  GetCurrentOnlineUsers,
  GroupInvite,
  AddGroupRoles, 
  RemoveGroupRoles, 
  GetGroupRoles,
  GetGroupUserRequest,
  PostGroupUserRequest,
  SearchGroups,
  GetWorldInfo,
  SearchWorld,
  SearchUserWorld,
  GetWorldInstance,
  getPrints,
  GetOwnPrints,
  UploadPrint,
  EditPrint,
  DeletePrint,
  GetGroupMembers,
  getFileAnalysis,
  SendFriendRequest,
  DeleteFriendRequest,
  GetFriendStatus,
  UnFriend,
  SearchUserAvatar,
  GetInventory,
  GetInventoryCollections,
  GetInventoryDrops,
  GetInventoryTemplate,
  GetOwnInventoryItem,
  GetUserInventoryItem,
  UpdateOwnInventoryItem,
  DeleteOwnInventoryItem,
  ConsumeOwnInventoryItem,
  EquipOwnInventoryItem,
  UnequipOwnInventorySlot,
  SpawnInventoryItem,
  ShareInventoryItemByPedestal,
  ShareInventoryItemDirect,
  RespondGroupJoinRequest,
  GetAllGroupAuditLogsRateLimited,
  ScanGroupAuditLogsSequential
};
