const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const { JoinGroupSmart } = require("../../modules/vrchatnode.js");

betterlog.vrchatGroup("VRChat Group Join System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

router.post("/", async (req, res) => {
  const { groupid, confirmOverrideBlock = false } = req.body;

  if (!groupid) {
    return res.status(400).json({
      status: 400,
      message: "Missing groupid"
    });
  }

  betterlog.vrchatGroup(`Join group requested (${groupid})`);
  const result = await JoinGroupSmart(groupid, confirmOverrideBlock);
  res.status(result.status || 200).json(result);
});

module.exports = router;
