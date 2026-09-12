const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const {
  SendGroupMessage,
  GetGroupMessage
} = require("../../modules/vrchatnode.js");

//console.clear();
betterlog.vrchatGroup("VRChat Group Message System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

router.post("/sendmessage", (req, res) => {
  const { groupid, title, text, bool, groupname } = req.body;
  betterlog.vrchatGroup(`VRChat Group Send Message Endpoint Pinged (${groupname})`);
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  SendGroupMessage(groupid, title, text, bool).then(vrcbl => {
    res.json(vrcbl);
  });
});

router.post("/getmessage", (req, res) => {
  const { groupid, groupname } = req.body;
  betterlog.vrchatGroup(`VRChat Group Get Message Endpoint Pinged (${groupname})`);
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  GetGroupMessage(groupid).then(vrcbl => {
    res.json(vrcbl);
  });
});

module.exports = router;
