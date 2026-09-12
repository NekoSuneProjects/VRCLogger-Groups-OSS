const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const {
  getPrints,
  GetOwnPrints,
  UploadPrint,
  EditPrint,
  DeletePrint
} = require("../../modules/vrchatnode.js");

betterlog.vrchatUser("VRChat Prints System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

router.post("/get", async (req, res) => {
  betterlog.vrchatUser("VRChat Get Print Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { printid } = req.body;

  try {
    const print = await getPrints(printid);
    res.json(print);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.get("/own", async (req, res) => {
  betterlog.vrchatUser("VRChat Get Own Prints Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");

  try {
    const prints = await GetOwnPrints();
    res.json(prints);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post("/upload", async (req, res) => {
  betterlog.vrchatUser("VRChat Upload Print Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { imageBase64, note, timestamp, worldId, worldName } = req.body;

  try {
    const upload = await UploadPrint({ imageBase64, note, timestamp, worldId, worldName });
    res.json(upload);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post("/edit", async (req, res) => {
  betterlog.vrchatUser("VRChat Edit Print Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { printid, imageBase64, note } = req.body;

  try {
    const edit = await EditPrint(printid, { imageBase64, note });
    res.json(edit);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post("/delete", async (req, res) => {
  betterlog.vrchatUser("VRChat Delete Print Endpoint Pinged");
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  const { printid } = req.body;

  try {
    const del = await DeletePrint(printid);
    res.json(del);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
