const {
  PermissionFlagsBits,
  ApplicationCommandType,
  ApplicationCommandOptionType
} = require("discord.js");

module.exports = {
  name: "vrcaddstaff",
  description: "VRChat Add Staff able to use Buttons / Commands",
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
      description: "The user to add",
      required: true
    },
    {
      name: "role",
      type: ApplicationCommandOptionType.String,
      description: "Select the staff role",
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

      const atuserrole = interaction.options.getString("role");

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

      if (existingUser) {
        if (!existingUser.active) {
          // Set active to true if the user exists but is inactive
          await client.state.models.VRCStaffList.update(
            { active: true },
            { where: { userId: atuser.id } }
          );
          return await interaction.reply({
            content: `User **${atuser.globalName ||
              atuser.username}** has been reactivated in the staff list.`
          });
        }

        // User is already active
        return await interaction.reply({
          content: `User **${atuser.globalName ||
            atuser.username}** is already active in the staff list.`,
          ephemeral: true
        });
      }

      // Add the new user to the database
      await client.state.models.VRCStaffList.create({
        userId: atuser.id,
        displayName: atuser.globalName || atuser.username,
        role: atuserrole
      });

      await interaction.reply({
        content: `User **${atuser.globalName ||
          atuser.username}** has been successfully added to the staff list.`
      });
    } catch (error) {
      console.error("Error managing staff members:", error);
      await interaction.reply({
        content: "An error occurred while processing your request.",
        ephemeral: true
      });
    }
  }
};
