const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const {
  BanGroupUser,
  UnbanGroupUser,
  GetAllGroupAuditLogsRateLimited,
  KickGroupUser,
  GetGroupMembers,
  GetGroupUserRequest,
  RespondGroupJoinRequest,
  PostGroupUserRequest,
  GetGroupAuditLog,
  ScanGroupAuditLogsSequential
} = require("../../modules/vrchatnode.js");

const fs = require("fs");
const path = require("path");

const getGroupSequelize = require("../../models/index");
const AuditLogModel = require("../../models/AuditLog");
const DEBUG = false;   // toggle this to false to disable all debug logs

function debug(...msg) {
  if (DEBUG) {
    const time = new Date().toISOString().split("T")[1].replace("Z", "");
    betterlog.trace(`[${time}][DEBUG] ${msg.join(" ")}`);
  }
}

//console.clear();
betterlog.vrchatGroup("VRChat Group Moderations System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

// ✅ Cache to avoid repeated syncs (in-memory)
const tableInitCache = new Set();

// ✅ Per-table lock system (promise queue)
const tableSyncLocks = new Map();

async function syncAuditTable(groupId) {
  const sequelize = getGroupSequelize();
  const AuditLog = AuditLogModel(sequelize, groupId);

  // ✅ Already synced → instant return
  if (tableInitCache.has(groupId)) {
    return AuditLog;
  }

  // ✅ Prevent concurrency: if a sync is already running, wait for it
  if (tableSyncLocks.has(groupId)) {
    await tableSyncLocks.get(groupId);
    return AuditLog;
  }

  // ✅ Create a sync promise lock
  let resolveLock;
  const syncPromise = new Promise(res => (resolveLock = res));
  tableSyncLocks.set(groupId, syncPromise);

  try {
    // ✅ Create or update table safely, no conflict
    await AuditLog.sync({ alter: true });

    // ✅ Mark this group as synced
    tableInitCache.add(groupId);

    return AuditLog;

  } finally {
    // ✅ Release the lock
    resolveLock();
    tableSyncLocks.delete(groupId);
  }
}

let lock = Promise.resolve();

function withDbLock(fn) {
  // Chain calls so they run sequentially
  lock = lock.then(() => fn()).catch(() => {});
  return lock;
}

async function saveAuditLogs(groupId, logs) {
  await withDbLock(async () => {
    const AuditLog = await syncAuditTable(groupId);

    for (const entry of logs) {
      await AuditLog.findOrCreate({
        where: { id: entry.id },
        defaults: {
          actorDisplayName: entry.actorDisplayName || "No Data",
          actorId: entry.actorId || "No Data",
          created_at: entry.created_at,
          description: entry.description || "No Data",
          eventType: entry.eventType,
          groupId: entry.groupId,
          targetId: entry.targetId,
          data: entry.data ?? {}
        }
      });
    }
  });
}

async function loadLogs(groupId) {
  const AuditLog = await syncAuditTable(groupId);
  
  return await AuditLog.findAll({
    order: [["created_at", "DESC"]]
  });
}


function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function safeSleep(ms, groupname) {
  const interval = 5000; // 5 sec heartbeat
  let waited = 0;

  while (waited < ms) {
    await new Promise(r => setTimeout(r, interval));
    waited += interval;
    debug(`(Cooldown) [${groupname}]`, `${waited}/${ms} ms`);
  }
}

// ✅ Resolve root directory
// This jumps two folders up: /endpoints/Groups → /root/
const projectRoot = path.resolve(__dirname, "../../");

// ✅ Config directory
const configDir = path.join(projectRoot, "config");

// ✅ Sync file path
const syncFile = path.join(configDir, "groupSync.json");

// GLOBAL SERIALIZER — prevents multiple groups running together
let globalAuditQueueRunning = false;
async function withGlobalLock(fn) {
  while (globalAuditQueueRunning) {
    await sleep(1500); // slow wait
  }
  globalAuditQueueRunning = true;
  try {
    return await fn();
  } finally {
    globalAuditQueueRunning = false;
  }
}

// ✅ Ensure config folder + sync file exist
function ensureSyncFile() {
  // Create /config directory if missing
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Create sync file if missing
  if (!fs.existsSync(syncFile)) {
    const initial = { groups: {} };
    fs.writeFileSync(syncFile, JSON.stringify(initial, null, 2));
  }
}


// ✅ Load sync data (always ensures file exists)
function loadSyncData() {
  ensureSyncFile();

  try {
    return JSON.parse(fs.readFileSync(syncFile, "utf8"));
  } catch (err) {
    betterlog.vrchatError(`ERROR reading groupSync.json, resetting file: ${err.message}`);
    return { groups: {} };
  }
}


// ✅ Save sync data
function saveSyncData(data) {
  ensureSyncFile();
  fs.writeFileSync(syncFile, JSON.stringify(data, null, 2));
}

// ✅ Group Locking System
const groupLocks = new Map();

async function withGroupLock(groupid, fn) {
  while (groupLocks.get(groupid)) {
    await new Promise(r => setTimeout(r, 200));
  }

  groupLocks.set(groupid, true);

  try {
    return await fn();
  } finally {
    groupLocks.delete(groupid);
  }
}

async function runAuditLogSync(groupid, groupname) {
  betterlog.vrchatGroup(`VRChat Group Get AuditLogs Endpoint Pinged (${groupname})`);
  const logGroupStatus = (message) =>
    betterlog.vrchatGroup(`${groupname} | ${message}`);
  const logGroupError = (message) =>
    betterlog.vrchatError(`${groupname} | ${message}`);

  const result = await withGlobalLock(async () =>
    await withGroupLock(groupid, async () => {

      let syncData = loadSyncData();

      if (!syncData.groups[groupid]) {
        syncData.groups[groupid] = { lastLogDate: null };
      }

      const lastSavedDate = syncData.groups[groupid].lastLogDate
        ? new Date(syncData.groups[groupid].lastLogDate)
        : null;

      const isFirstSync = !lastSavedDate;

      try {
        const scan = await ScanGroupAuditLogsSequential(groupid, lastSavedDate, {
          pageSize: 100,
          delayMs: 3500,
          maxRetries: 5,
          onPage: (page, chunk) =>
            logGroupStatus(`Page ${page} -> ${chunk.length} logs`)
        });

        const newLogs = scan.logs;

        if (newLogs.length > 0) {
          await saveAuditLogs(groupid, newLogs);
          debug(`(AUDIT LOGS) [${groupname}]`, `Saved ${newLogs.length} new audit logs`);
        }

        if (newLogs.length > 0) {
          const newestDate = newLogs
            .map(l => new Date(l.created_at))
            .sort((a, b) => b - a)[0];

          syncData.groups[groupid].lastLogDate = newestDate.toISOString();
          saveSyncData(syncData);

          debug(`(AUDIT LOGS) [${groupname}]`, `Updated lastLogDate -> ${newestDate.toISOString()}`);
        }

        return {
          mode: isFirstSync ? "full_initial" : "incremental",
          newLogs,
        };

      } catch (err) {
        logGroupError(`ERROR: ${err.message}`);
        return { error: err.message };
      }

    })
  );

  logGroupStatus("Cooling down 30 seconds...");
  await safeSleep(25000, groupname);

  return result;
}

router.post("/getauditlogs", async (req, res) => {
  const { groupid, groupname } = req.body;

  if (!groupid || !groupname) {
    return res.status(400).json({
      status: 400,
      message: "Missing groupid or groupname"
    });
  }

  try {

    // ✅ Get cached DB rows
    const cachedLogs = await loadLogs(groupid)

    const totalCount = cachedLogs.length;

    // ✅ Fire sync in background
    runAuditLogSync(groupid, groupname)
      .catch(err => betterlog.vrchatError(`Background Sync Error: ${err.message}`));

    // ✅ Return immediately
    return res.json({
      status: 200,
      message: "Get Audit Logs!",
      data: {
        results: cachedLogs,
        totalCount,
        backgroundSync: true
      }
    });

  } catch (err) {
    betterlog.vrchatError(`getauditlogs: ${err.message}`);
    return res.status(500).json({
      status: 500,
      message: "Internal Server Error",
      error: err.message
    });
  }
});


// =====================================================
// ✅ Routes with unified debug logging
// =====================================================

router.post("/getauditlogsold", async (req, res) => {
  const { groupid, groupname } = req.body;
  betterlog.vrchatGroup(`VRChat Group Get AuditLogs Endpoint Pinged (${groupname})`);

  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  try {
    const auditLogs = await GetGroupAuditLog(groupid);

    debug(`(GET AUDIT LOGS) [${groupname}]`, auditLogs);
    res.json(auditLogs);

  } catch (e) {
    debug(`(GET AUDIT LOGS ERROR) [${groupname}]`, e.message);
    res.status(500).json({ message: e.message });
  }
});

// -----------------------------------------------------

router.post("/requestjoingroup", (req, res) => {
  const { groupid, userid, action, groupname } = req.body;
  betterlog.vrchatGroup(`VRChat Group Join Request Member Endpoint Pinged (${groupname})`);

  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  RespondGroupJoinRequest(groupid, userid, action).then(vrcbl => {
    debug(`(JOIN REQUEST) [${groupname}]`, vrcbl);
    res.json(vrcbl);
  });
});

// -----------------------------------------------------

router.post("/banmember", (req, res) => {
  const { groupid, userid, groupname } = req.body;
  betterlog.vrchatGroup(`VRChat Group Ban Member Endpoint Pinged (${groupname})`);

  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  BanGroupUser(groupid, userid).then(vrcbl => {
    debug(`(BAN MEMBER) [${groupname}]`, vrcbl);
    res.json(vrcbl);
  });
});

// -----------------------------------------------------

router.post("/unbanmember", (req, res) => {
  const { groupid, userid, groupname } = req.body;
  betterlog.vrchatGroup(`VRChat Group UnBan Member Endpoint Pinged (${groupname})`);

  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  UnbanGroupUser(groupid, userid).then(vrcbl => {
    debug(`(UNBAN MEMBER) [${groupname}]`, vrcbl);
    res.json(vrcbl);
  });
});

// -----------------------------------------------------

router.post("/kickmember", (req, res) => {
  const { groupid, userid, groupname } = req.body;
  betterlog.vrchatGroup(`VRChat Group Kick Member Endpoint Pinged (${groupname})`);

  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  KickGroupUser(groupid, userid).then(vrcbl => {
    debug(`(KICK MEMBER) [${groupname}]`, vrcbl);
    res.json(vrcbl);
  });
});

// -----------------------------------------------------

router.post("/getmemberrequests", (req, res) => {
  const { groupid, groupname } = req.body;
  betterlog.vrchatGroup(`VRChat Get Group Member Request Endpoint Pinged (${groupname})`);

  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  GetGroupUserRequest(groupid).then(vrcbl => {
    debug(`(GET MEMBER REQUESTS) [${groupname}]`, vrcbl);
    res.json(vrcbl);
  });
});

// -----------------------------------------------------

router.post("/getgroupmembers", (req, res) => {
  const { groupid, groupname } = req.body;
  betterlog.vrchatGroup(`VRChat Get Group Members Endpoint Pinged (${groupname})`);

  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  GetGroupMembers(groupid).then(vrcbl => {
    debug(`(GET GROUP MEMBERS) [${groupname}]`, vrcbl);
    res.json(vrcbl);
  });
});

// -----------------------------------------------------

router.post("/postmemberrequests", (req, res) => {
  const { groupid, userId, action, block, groupname } = req.body;
  betterlog.vrchatGroup(`VRChat Respond Group Member Request Endpoint Pinged (${groupname})`);

  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  PostGroupUserRequest(groupid, userId, action, block).then(vrcbl => {
    debug(`(RESPOND MEMBER REQUEST) [${groupname}]`, vrcbl);
    res.json(vrcbl);
  });
});

module.exports = router;
