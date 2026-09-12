const { DataTypes } = require("sequelize");

module.exports = (sequelize, groupId) => {
  if (!groupId) throw new Error("groupId required for dynamic table name");

  // Safe table name → remove symbols
  const safeId = groupId.replace(/[^a-zA-Z0-9_]/g, "_");
  const tableName = `AuditLog_${safeId}`;

  return sequelize.define(tableName, {
    id: { type: DataTypes.STRING, primaryKey: true },
    actorDisplayName: DataTypes.STRING,
    actorId: DataTypes.STRING,
    created_at: DataTypes.DATE,
    description: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: ""
    },
    eventType: DataTypes.STRING,
    groupId: DataTypes.STRING,
    targetId: DataTypes.STRING,
    data: {
      type: DataTypes.JSON,
      defaultValue: {}
    }
  }, {
    tableName,
    timestamps: false
  });
};
