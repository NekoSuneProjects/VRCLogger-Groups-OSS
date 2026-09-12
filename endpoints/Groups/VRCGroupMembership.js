const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const {
  JoinGroup,
  SetGroupVisibility
} = require("../../modules/vrchatnode.js");

betterlog.vrchatGroup("VRChat Group Membership System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

router.post("/join", async (req, res) => {
  const { groupid, confirmOverrideBlock = false } = req.body;

  if (!groupid) {
    return res.status(400).json({
      status: 400,
      message: "Missing groupid"
    });
  }

  betterlog.vrchatGroup(`Join group requested (${groupid})`);
  const result = await JoinGroup(groupid, confirmOverrideBlock);
  res.status(result.status || 200).json(result);
});

router.post("/visibility", async (req, res) => {
  const { groupid, visibility } = req.body;
  const allowed = new Set(["visible", "friends", "hidden"]);

  if (!groupid || !visibility) {
    return res.status(400).json({
      status: 400,
      message: "Missing groupid or visibility"
    });
  }

  if (!allowed.has(visibility)) {
    return res.status(400).json({
      status: 400,
      message: "Invalid visibility. Use visible, friends, or hidden."
    });
  }

  betterlog.vrchatGroup(`Update group visibility requested (${groupid})`);
  const result = await SetGroupVisibility(groupid, visibility);
  res.status(result.status || 200).json(result);
});

module.exports = router;
