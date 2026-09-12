const { Sequelize } = require("sequelize");
const path = require("path");
const fs = require("fs");

let sequelize = null;

function getGroupSequelize(groupId) {
  if (sequelize) return sequelize;

  const dataDir = path.join(__dirname, "..", "config");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, "groups_Loggers.sqlite");

  sequelize = new Sequelize({
    dialect: "sqlite",
    storage: dbPath,
    logging: false
  });

  return sequelize;
}

module.exports = getGroupSequelize;
