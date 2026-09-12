const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const {
  getFileAnalysis,
  SearchUserAvatar
} = require("../../modules/vrchatnode.js");

betterlog.vrchatUser("VRChat Avatars System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

router.post("/analysis", (req, res) => {
  betterlog.vrchatUser("VRChat Get Avatar Analysiss Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { fileId, fileVersion } = req.body;

  getFileAnalysis(fileId, fileVersion).then(vrcbl => {
    res.json(vrcbl);
  });
});


router.get("/useravatars/:userid", (req, res) => {
  betterlog.vrchatUser("VRChat Get Users Avatars Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const {  userid } = req.params;

  SearchUserAvatar(userid).then(vrcbl => {
    res.json(vrcbl);
  });
});

module.exports = router;
