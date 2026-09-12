const { Sequelize } = require("sequelize");
const path = require("path");
const pkgjn = require("../package.json");

// Create a new SQLite database in the user's data path
const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: path.join(
    process.env.HOME || process.env.USERPROFILE,
    "AppData",
    "Roaming",
    pkgjn.name,
    "config",
    "config.sqlite"
  ),
  logging: false
});

module.exports = sequelize;
