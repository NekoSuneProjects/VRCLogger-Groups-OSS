const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const {
  BanGroupUser,
  UnbanGroupUser,
  KickGroupUser,
  GetGroupMembers,
  GetGroupUserRequest,
  RespondGroupJoinRequest,
  PostGroupUserRequest,
  GetGroupAuditLog
} = require("../../modules/vrchatnode.js");


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

// This backend keeps no database. Audit logs are fetched from VRChat and
// returned straight to the caller; the Discord bot stores and de-duplicates
// them in its own database.

router.post("/getauditlogs", async (req, res) => {
  const { groupid, groupname } = req.body;

  if (!groupid || !groupname) {
    return res.status(400).json({
      status: 400,
      message: "Missing groupid or groupname"
    });
  }

  try {
    // No local cache: read straight from VRChat and hand the logs back.
    // The Discord bot keeps the history and skips events it has already stored.
    const auditLogs = await GetGroupAuditLog(groupid);
    const results = auditLogs?.data?.results || auditLogs?.results || [];

    debug(`(GET AUDIT LOGS) [${groupname}]`, `${results.length} logs`);

    return res.json({
      status: 200,
      message: "Get Audit Logs!",
      data: {
        results,
        totalCount: results.length,
        backgroundSync: false
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
