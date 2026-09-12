const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const {
  AddGroupRoles,
  RemoveGroupRoles,
  GetGroupRoles
} = require("../../modules/vrchatnode.js");

//console.clear();
betterlog.vrchatGroup("VRChat Group Invites System System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

router.post("/add/:groupid", (req, res) => {
  const { groupid } = req.params;
  const { userId, groupRoleId, groupname } = req.body;
  betterlog.vrchatGroup(`VRChat Group Add Member Role Endpoint Pinged (${groupname})`);
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  AddGroupRoles(groupid, userId, groupRoleId).then(vrcbl => {
    res.json(vrcbl);
  });
});

router.post("/remove/:groupid", (req, res) => {
  const { groupid } = req.params;
  const { userId, groupRoleId, groupname } = req.body;
  betterlog.vrchatGroup(`VRChat Group Remove Member Role Endpoint Pinged (${groupname})`);
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  RemoveGroupRoles(groupid, userId, groupRoleId).then(vrcbl => {
    res.json(vrcbl);
  });
});

router.post("/get/:groupid", (req, res) => {
  const { groupid } = req.params;
  const { groupname } = req.body;
  betterlog.vrchatGroup(`VRChat Group List Role Endpoint Pinged (${groupname})`);
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  GetGroupRoles(groupid).then(vrcbl => {
    res.json(vrcbl);
  });
});

module.exports = router;
