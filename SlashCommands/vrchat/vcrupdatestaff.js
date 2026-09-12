const {
  EmbedBuilder,
  PermissionFlagsBits,
  ApplicationCommandType,
  ApplicationCommandOptionType
} = require("discord.js");

module.exports = {
  name: "vcrupdatestaff",
  description: "Update a staff member's role",
  type: ApplicationCommandType.ChatInput,
  toggleOff: false,
  developersOnly: false,
  patreonOnly: false,
  userpermissions: [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ViewChannel
  ],
  botpermissions: [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ViewChannel
  ],

  options: [
    {
      name: "user",
      type: ApplicationCommandOptionType.User,
      description: "The staff member to update",
      required: true
    },
    {
      name: "role",
      type: ApplicationCommandOptionType.String,
      description: "Select the new staff role",
      required: true,
      choices: [
        { name: "Owner", value: "owner" },
        { name: "Co-Owner", value: "co-owner" },
        { name: "Admin", value: "admin" },
        { name: "Moderator", value: "mod" },
        { name: "Trainee", value: "trainee" },
        { name: "IT-Tech", value: "it-tech" }
      ]
    }
  ],

  run: async (client, interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      // ✅ Permission Check
      const isGuildOwner = interaction.guild.ownerId === interaction.user.id;
      const allowedUsers = client.config.developerID || []; // array of IDs

      if (!isGuildOwner && !allowedUsers.includes(interaction.user.id)) {
        return await interaction.reply({
          content: "**YOU DO NOT HAVE ACCESS TO THIS COMMAND!**",
          ephemeral: true
        });
      }

      const atuser = interaction.options.getUser("user");
      const newRole = interaction.options.getString("role");

      // ✅ must exist
      const existingUser = await client.state.models.VRCStaffList.findOne({
        where: { userId: atuser.id }
      });

      if (!existingUser) {
        return await interaction.reply({
          content: `User **${atuser.globalName || atuser.username}** is not in the staff list.`,
          ephemeral: true
        });
      }

      // ✅ Update the role
      await client.state.models.VRCStaffList.update(
        { role: newRole },
        { where: { userId: atuser.id } }
      );

      await interaction.reply({
        content: `✅ Updated **${atuser.globalName || atuser.username}** to role **${newRole}**`
      });

    } catch (error) {
      console.error("Error updating staff role:", error);
      await interaction.reply({
        content: "An error occurred while processing your request.",
        ephemeral: true
      });
    }
  }
};
