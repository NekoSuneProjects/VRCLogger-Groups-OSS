// functions/getConfig.js
const Config = require("../models/Config");

async function getConfig(key) {
  const config = await Config.findOne({ where: { keyid: key } });
  return config ? JSON.parse(config.value) : null;
}

module.exports = getConfig;
