// models/UserConfig.js
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../functions/configsqlite");

class UserConfig extends Model {}
UserConfig.init(
  {
    userid: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  { sequelize, modelName: "UserConfig" }
);

module.exports = UserConfig;
