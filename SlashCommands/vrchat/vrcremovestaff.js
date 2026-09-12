const {
  EmbedBuilder,
  PermissionFlagsBits,
  ApplicationCommandType,
  ApplicationCommandOptionType
} = require("discord.js");

module.exports = {
  name: "vrcremovestaff",
  description: "VRChat Remove Staff by setting active to false",
  type: ApplicationCommandType.ChatInput,
  toggleOff: false,
  developersOnly: false,
  patreonOnly: false,
  patreonManualWhitelist: [],
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
      description: "The user to remove",
      required: true
    }
  ],

  run: async (client, interaction, args) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      const isGuildOwner = interaction.guild.ownerId === interaction.user.id;
      const allowedUsers = client.config.developerID || [];
      if (!isGuildOwner && !allowedUsers.includes(interaction.user.id)) {
        return await interaction.reply({
          content: "**YOU DO NOT HAVE ACCESS TO THIS COMMAND!**",
          ephemeral: true
        });
      }

      const atuser = interaction.options.getUser("user");

      if (!atuser) {
        return await interaction.reply({
          content: "Invalid user specified.",
          ephemeral: true
        });
      }

      // Check if the user exists in the database
      const existingUser = await client.state.models.VRCStaffList.findOne({
        where: { userId: atuser.id }
      });

      if (!existingUser) {
        return await interaction.reply({
          content: `User **${atuser.globalName ||
            atuser.username}** is not in the staff list.`,
          ephemeral: true
        });
      }

      if (!existingUser.active) {
        return await interaction.reply({
          content: `User **${atuser.globalName ||
            atuser.username}** is already inactive.`,
          ephemeral: true
        });
      }

      // Update the user's active status to false
      await client.state.models.VRCStaffList.update(
        { active: false },
        { where: { userId: atuser.id } }
      );

      await interaction.reply({
        content: `User **${atuser.globalName ||
          atuser.username}** has been successfully removed from the active staff list.`
      });
    } catch (error) {
      console.error("Error removing user from the staff list:", error);
      await interaction.reply({
        content: "An error occurred while processing your request.",
        ephemeral: true
      });
    }
  }
};
