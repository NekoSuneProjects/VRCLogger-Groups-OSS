const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const {
  GetInventory,
  GetInventoryCollections,
  GetInventoryDrops,
  GetInventoryTemplate,
  GetOwnInventoryItem,
  GetUserInventoryItem,
  UpdateOwnInventoryItem,
  DeleteOwnInventoryItem,
  ConsumeOwnInventoryItem,
  EquipOwnInventoryItem,
  UnequipOwnInventorySlot,
  SpawnInventoryItem,
  ShareInventoryItemByPedestal,
  ShareInventoryItemDirect
} = require("../../modules/vrchatnode.js");

betterlog.vrchatUser("VRChat Inventory System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

const firstValue = (source, keys) => {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }
  return undefined;
};

const inventoryItemIdFrom = (source) => firstValue(source, [
  "inventoryItemId",
  "inventoryItemID",
  "inventoryId",
  "inventoryid",
  "itemId",
  "id"
]);

const userIdFrom = (source) => firstValue(source, ["userId", "userid"]);

const templateIdFrom = (source) => firstValue(source, [
  "inventoryTemplateId",
  "inventoryTemplateID",
  "templateId",
  "templateid",
  "id"
]);

const slotFrom = (source) => firstValue(source, ["slot", "equipSlot", "inventoryItemId", "inventoryid"]);

const sendResult = (res, result) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.contentType("application/json");
  res.status(result.status || 200).json(result);
};

const missing = (res, message) => {
  sendResult(res, {
    status: 400,
    message
  });
};

const inventoryQueryFrom = (source) => ({
  n: source.n,
  offset: source.offset,
  order: source.order,
  tags: source.tags,
  types: source.types,
  flags: source.flags,
  notTypes: source.notTypes,
  notFlags: source.notFlags,
  archived: source.archived
});

router.get("/", async (req, res) => {
  betterlog.vrchatUser("VRChat Get Inventory Endpoint Pinged");
  const result = await GetInventory(inventoryQueryFrom(req.query));
  sendResult(res, result);
});

router.post("/get", async (req, res) => {
  betterlog.vrchatUser("VRChat Get Inventory Endpoint Pinged");
  const result = await GetInventory(inventoryQueryFrom(req.body));
  sendResult(res, result);
});

router.get("/collections", async (req, res) => {
  betterlog.vrchatUser("VRChat Inventory Collections Endpoint Pinged");
  const result = await GetInventoryCollections();
  sendResult(res, result);
});

router.get("/drops", async (req, res) => {
  betterlog.vrchatUser("VRChat Inventory Drops Endpoint Pinged");
  const result = await GetInventoryDrops({ active: req.query.active });
  sendResult(res, result);
});

router.post("/drops", async (req, res) => {
  betterlog.vrchatUser("VRChat Inventory Drops Endpoint Pinged");
  const result = await GetInventoryDrops({ active: req.body.active });
  sendResult(res, result);
});

router.get("/template/:inventoryTemplateId", async (req, res) => {
  betterlog.vrchatUser("VRChat Get Inventory Template Endpoint Pinged");
  const result = await GetInventoryTemplate(req.params.inventoryTemplateId);
  sendResult(res, result);
});

router.post("/template", async (req, res) => {
  betterlog.vrchatUser("VRChat Get Inventory Template Endpoint Pinged");
  const inventoryTemplateId = templateIdFrom(req.body);
  if (!inventoryTemplateId) return missing(res, "Missing inventoryTemplateId");

  const result = await GetInventoryTemplate(inventoryTemplateId);
  sendResult(res, result);
});

router.get("/own/:inventoryItemId", async (req, res) => {
  betterlog.vrchatUser("VRChat Get Own Inventory Item Endpoint Pinged");
  const result = await GetOwnInventoryItem(req.params.inventoryItemId);
  sendResult(res, result);
});

router.post("/own/get", async (req, res) => {
  betterlog.vrchatUser("VRChat Get Own Inventory Item Endpoint Pinged");
  const inventoryItemId = inventoryItemIdFrom(req.body);
  if (!inventoryItemId) return missing(res, "Missing inventoryItemId");

  const result = await GetOwnInventoryItem(inventoryItemId);
  sendResult(res, result);
});

router.get("/user/:userId/:inventoryItemId", async (req, res) => {
  betterlog.vrchatUser("VRChat Get User Inventory Item Endpoint Pinged");
  const { userId, inventoryItemId } = req.params;
  const result = await GetUserInventoryItem(userId, inventoryItemId);
  sendResult(res, result);
});

router.post("/user/get", async (req, res) => {
  betterlog.vrchatUser("VRChat Get User Inventory Item Endpoint Pinged");
  const userId = userIdFrom(req.body);
  const inventoryItemId = inventoryItemIdFrom(req.body);

  if (!userId || !inventoryItemId) return missing(res, "Missing userId or inventoryItemId");

  const result = await GetUserInventoryItem(userId, inventoryItemId);
  sendResult(res, result);
});

router.post("/consume", async (req, res) => {
  betterlog.vrchatUser("VRChat Consume Inventory Item Endpoint Pinged");
  const inventoryItemId = inventoryItemIdFrom(req.body);
  if (!inventoryItemId) return missing(res, "Missing inventoryItemId");

  const result = await ConsumeOwnInventoryItem(inventoryItemId);
  sendResult(res, result);
});

router.put("/:inventoryItemId/consume", async (req, res) => {
  betterlog.vrchatUser("VRChat Consume Inventory Item Endpoint Pinged");
  const result = await ConsumeOwnInventoryItem(req.params.inventoryItemId);
  sendResult(res, result);
});

router.post("/equip", async (req, res) => {
  betterlog.vrchatUser("VRChat Equip Inventory Item Endpoint Pinged");
  const inventoryItemId = inventoryItemIdFrom(req.body);
  const equipSlot = firstValue(req.body, ["equipSlot", "slot"]);

  if (!inventoryItemId) return missing(res, "Missing inventoryItemId");

  const result = await EquipOwnInventoryItem(inventoryItemId, { equipSlot });
  sendResult(res, result);
});

router.put("/:inventoryItemId/equip", async (req, res) => {
  betterlog.vrchatUser("VRChat Equip Inventory Item Endpoint Pinged");
  const equipSlot = firstValue(req.body, ["equipSlot", "slot"]);
  const result = await EquipOwnInventoryItem(req.params.inventoryItemId, { equipSlot });
  sendResult(res, result);
});

router.post("/unequip", async (req, res) => {
  betterlog.vrchatUser("VRChat Unequip Inventory Slot Endpoint Pinged");
  const slot = slotFrom(req.body);
  if (slot === undefined) return missing(res, "Missing slot or equipSlot");

  const result = await UnequipOwnInventorySlot(slot);
  sendResult(res, result);
});

router.delete("/:slot/equip", async (req, res) => {
  betterlog.vrchatUser("VRChat Unequip Inventory Slot Endpoint Pinged");
  const result = await UnequipOwnInventorySlot(req.params.slot);
  sendResult(res, result);
});

router.get("/spawn", async (req, res) => {
  betterlog.vrchatUser("VRChat Spawn Inventory Item Endpoint Pinged");
  const id = inventoryItemIdFrom(req.query);
  if (!id) return missing(res, "Missing id or inventoryItemId");

  const result = await SpawnInventoryItem(id);
  sendResult(res, result);
});

router.post("/spawn", async (req, res) => {
  betterlog.vrchatUser("VRChat Spawn Inventory Item Endpoint Pinged");
  const id = inventoryItemIdFrom(req.body);
  if (!id) return missing(res, "Missing id or inventoryItemId");

  const result = await SpawnInventoryItem(id);
  sendResult(res, result);
});

router.get("/cloning/pedestal", async (req, res) => {
  betterlog.vrchatUser("VRChat Share Inventory Item Pedestal Endpoint Pinged");
  const itemId = inventoryItemIdFrom(req.query);
  if (!itemId) return missing(res, "Missing itemId or inventoryItemId");

  const result = await ShareInventoryItemByPedestal(itemId, req.query.duration);
  sendResult(res, result);
});

router.post("/cloning/pedestal", async (req, res) => {
  betterlog.vrchatUser("VRChat Share Inventory Item Pedestal Endpoint Pinged");
  const itemId = inventoryItemIdFrom(req.body);
  if (!itemId) return missing(res, "Missing itemId or inventoryItemId");

  const result = await ShareInventoryItemByPedestal(itemId, req.body.duration);
  sendResult(res, result);
});

router.post("/cloning/direct", async (req, res) => {
  betterlog.vrchatUser("VRChat Share Inventory Item Direct Endpoint Pinged");
  const itemId = inventoryItemIdFrom(req.body);
  const { users, duration } = req.body;

  if (!itemId || !Array.isArray(users)) return missing(res, "Missing itemId or users");

  const result = await ShareInventoryItemDirect(itemId, users, duration);
  sendResult(res, result);
});

router.post("/update", async (req, res) => {
  betterlog.vrchatUser("VRChat Update Inventory Item Endpoint Pinged");
  const inventoryItemId = inventoryItemIdFrom(req.body);
  if (!inventoryItemId) return missing(res, "Missing inventoryItemId");

  const { inventoryItemId: _inventoryItemId, inventoryItemID, inventoryId, inventoryid, itemId, id, ...inventoryItemData } = req.body;
  const result = await UpdateOwnInventoryItem(inventoryItemId, inventoryItemData);
  sendResult(res, result);
});

router.put("/:inventoryItemId", async (req, res) => {
  betterlog.vrchatUser("VRChat Update Inventory Item Endpoint Pinged");
  const result = await UpdateOwnInventoryItem(req.params.inventoryItemId, req.body);
  sendResult(res, result);
});

router.post("/delete", async (req, res) => {
  betterlog.vrchatUser("VRChat Delete Inventory Item Endpoint Pinged");
  const inventoryItemId = inventoryItemIdFrom(req.body);
  if (!inventoryItemId) return missing(res, "Missing inventoryItemId");

  const result = await DeleteOwnInventoryItem(inventoryItemId);
  sendResult(res, result);
});

router.delete("/:inventoryItemId", async (req, res) => {
  betterlog.vrchatUser("VRChat Delete Inventory Item Endpoint Pinged");
  const result = await DeleteOwnInventoryItem(req.params.inventoryItemId);
  sendResult(res, result);
});

module.exports = router;
