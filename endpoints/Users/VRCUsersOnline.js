const { betterlog, express } = require("../../dependencies.js");

const router = express.Router();
const { GetCurrentOnlineUsers } = require("../../modules/vrchatnode.js");

betterlog.vrchatUser("VRChat Online Users System Active");

router.get("/", async (req, res) => {
  betterlog.vrchatUser("VRChat Current Online Users Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  try {
    const online = await GetCurrentOnlineUsers();
    res.json(online);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
