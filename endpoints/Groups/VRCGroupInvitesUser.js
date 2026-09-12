const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const {
  GetPendingGroupInvites,
  AcceptGroupInvite,
  DeclineGroupInvite
} = require("../../modules/vrchatnode.js");

betterlog.vrchatGroup("VRChat Group Invites (User) System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

router.get("/pending", async (req, res) => {
  const result = await GetPendingGroupInvites();
  res.status(result.status || 200).json(result);
});

router.post("/accept", async (req, res) => {
  const { groupid, confirmOverrideBlock = false } = req.body;

  if (!groupid) {
    return res.status(400).json({
      status: 400,
      message: "Missing groupid"
    });
  }

  betterlog.vrchatGroup(`Accept group invite requested (${groupid})`);
  const result = await AcceptGroupInvite(groupid, confirmOverrideBlock);
  res.status(result.status || 200).json(result);
});

router.post("/decline", async (req, res) => {
  const { groupid } = req.body;

  if (!groupid) {
    return res.status(400).json({
      status: 400,
      message: "Missing groupid"
    });
  }

  betterlog.vrchatGroup(`Decline group invite requested (${groupid})`);
  const result = await DeclineGroupInvite(groupid, false);
  res.status(result.status || 200).json(result);
});

router.post("/ignore", async (req, res) => {
  const { groupid } = req.body;

  if (!groupid) {
    return res.status(400).json({
      status: 400,
      message: "Missing groupid"
    });
  }

  betterlog.vrchatGroup(`Ignore group invite requested (${groupid})`);
  const result = await DeclineGroupInvite(groupid, true);
  res.status(result.status || 200).json(result);
});

module.exports = router;
