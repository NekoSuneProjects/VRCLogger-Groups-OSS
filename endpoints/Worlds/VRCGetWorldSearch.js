const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const {
  GetWorldInfo,
  SearchWorld,
  SearchUserWorld,
  GetWorldInstance
} = require("../../modules/vrchatnode.js");

betterlog.vrchatWorld("VRChat World Search System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

/**
 * @swagger
 * /userid:
 *   post:
 *     summary: Get Users Data by UserID
 *     description: Retrieve a Data of Users VRChat.
 *     responses:
 *       200:
 *         description: Successful response with a list of users.
 *       500:
           description: Error: User not Found
 */

router.post("/worldid", async (req, res) => {
  betterlog.vrchatWorld("VRChat Get World ID Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { worldid } = req.body;

  try {
    const GetWorldID = await GetWorldInfo(worldid);
    res.json(GetWorldID);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post("/worldInstance", async (req, res) => {
  betterlog.vrchatInstance("VRChat Get World Instance Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { worldId, instanceId } = req.body;

  try {
    const GetWorldID = await GetWorldInstance(worldId, instanceId);
    res.json(GetWorldID);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post("/search", (req, res) => {
  betterlog.vrchatWorld("VRChat Get World Search Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { search } = req.body;

  SearchWorld(search).then(vrcbl => {
    res.json(vrcbl);
  });
});

router.post("/searchusers", (req, res) => {
  betterlog.vrchatWorld("VRChat Get World Search Users Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { search } = req.body;

  SearchUserWorld(search).then(vrcbl => {
    res.json(vrcbl);
  });
});

module.exports = router;
