const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const {
  SendFriendRequest,
  DeleteFriendRequest,
  GetFriendStatus,
  UnFriend
} = require("../../modules/vrchatnode.js");

betterlog.vrchatFriend("VRChat User Friends System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

router.post("/sendfriendreq", async (req, res) => {
  betterlog.vrchatFriend("VRChat Send User Friend Request Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { userid } = req.body;

  try {
    const GetuserID = await SendFriendRequest(userid);
    res.json(GetuserID);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post("/deletefriendreq", async (req, res) => {
  betterlog.vrchatFriend("VRChat Delete User Friend Request Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { userid } = req.body;

  try {
    const GetuserID = await DeleteFriendRequest(userid);
    res.json(GetuserID);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post("/getfriendstatus", async (req, res) => {
  betterlog.vrchatFriend("VRChat Get User Friend Status Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { userid } = req.body;

  try {
    const GetuserID = await GetFriendStatus(userid);
    res.json(GetuserID);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post("/unfrienduser", async (req, res) => {
  betterlog.vrchatFriend("VRChat Unfriend User Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { userid } = req.body;

  try {
    const GetuserID = await UnFriend(userid);
    res.json(GetuserID);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
