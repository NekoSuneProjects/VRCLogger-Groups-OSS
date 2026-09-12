const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const {
  GetUsers,
  SearchUser,
  UserGroupsleepy,
  getPrints
} = require("../../modules/vrchatnode.js");

betterlog.vrchatUser("VRChat User Search System Active");

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

router.post("/userid", async (req, res) => {
  betterlog.vrchatUser("VRChat Get User Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { userid } = req.body;

  try {
    const GetuserID = await GetUsers(userid);
    res.json(GetuserID);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post("/search", (req, res) => {
  betterlog.vrchatUser("VRChat Get User Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { search } = req.body;

  SearchUser(search).then(vrcbl => {
    res.json(vrcbl);
  });
});

router.post("/usergroups", (req, res) => {
  betterlog.vrchatUser("VRChat Get User Groups Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { userid } = req.body;

  UserGroupsleepy(userid).then(vrcbl => {
    res.json(vrcbl);
  });
});

router.post("/prints", (req, res) => {
  betterlog.vrchatUser("VRChat Get Prints Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { printsid } = req.body;

  getPrints(printsid).then(vrcbl => {
    res.json(vrcbl);
  });
});

module.exports = router;
