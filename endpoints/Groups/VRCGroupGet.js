const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const { GetGroupById } = require("../../modules/vrchatnode.js");

betterlog.vrchatGroup("VRChat Group Get System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

router.post("/getgroup", async (req, res) => {
  const { groupid } = req.body;

  if (!groupid) {
    return res.status(400).json({
      status: 400,
      message: "Missing groupid"
    });
  }

  betterlog.vrchatGroup(`VRChat Get Group by ID Endpoint Pinged (${groupid})`);
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  const result = await GetGroupById(groupid);
  res.status(result.status || 200).json(result);
});

module.exports = router;
