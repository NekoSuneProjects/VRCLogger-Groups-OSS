const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const { GroupInvite } = require("../../modules/vrchatnode.js");

//console.clear();
betterlog.vrchatGroup("VRChat Group Invites System System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

router.post("/invitemember/:groupid", (req, res) => {
  const { groupid } = req.params;
  const { userid, groupname } = req.body;
  betterlog.vrchatGroup(`VRChat Group invite Member Endpoint Pinged (${groupname})`);
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  GroupInvite(groupid, userid).then(vrcbl => {
    res.json(vrcbl);
  });
});

module.exports = router;
