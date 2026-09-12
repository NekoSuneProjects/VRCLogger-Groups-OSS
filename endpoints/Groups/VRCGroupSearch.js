const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const {
  SearchGroups
} = require("../../modules/vrchatnode.js");

//console.clear();
betterlog.vrchatGroup("VRChat Group Search System System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

router.post("/:groupid", (req, res) => {
  const { groupid } = req.params;
  const { groupname } = req.body;
  betterlog.vrchatGroup(`VRChat Group Search Endpoint Pinged (${groupname})`);
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  SearchGroups(groupid).then(vrcbl => {
    res.json(vrcbl);
  });
});

module.exports = router;
