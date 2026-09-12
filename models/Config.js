// models/Config.js
const { DataTypes } = require("sequelize");
const sequelize = require("../functions/configsqlite");

const Config = sequelize.define("Config", {
  keyid: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true,
  },
  value: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, {
  tableName: "configs", // Ensures Sequelize uses the correct table name
});

(async () => {
  await sequelize.sync(); // This should create missing tables if they don't exist.
})();

module.exports = Config;
