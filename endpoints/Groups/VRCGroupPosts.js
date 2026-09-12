const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const { GetGroupPosts } = require("../../modules/vrchatnode.js");

betterlog.vrchatGroup("VRChat Group Posts System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

router.post("/get", async (req, res) => {
  betterlog.vrchatGroup("VRChat Get Group Posts Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { groupid, n, offset, publicOnly } = req.body;

  try {
    const posts = await GetGroupPosts(groupid, { n, offset, publicOnly });
    res.json(posts);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
