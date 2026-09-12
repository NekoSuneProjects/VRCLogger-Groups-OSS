const {
  PermissionFlagsBits,
  ApplicationCommandType,
  ApplicationCommandOptionType
} = require("discord.js");

const crypto = require("crypto"); // For generating random characters

module.exports = {
  name: "vrcmanageapikey",
  description: "Manage API keys for VRChat staff",
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
      name: "action",
      type: ApplicationCommandOptionType.String,
      description: "Create or remove an API key",
      required: true,
      choices: [
        { name: "Create", value: "create" },
        { name: "Remove", value: "remove" },
        { name: "Fetch", value: "fetch" },
        { name: "Regenerate", value: "regenerate" },
      ]
    },
    {
      name: "user",
      type: ApplicationCommandOptionType.User,
      description: "The user for the API key",
      required: true
    },
    {
      name: "admin",
      type: ApplicationCommandOptionType.Boolean,
      description: "Set the user as admin (true or false)",
      required: false
    }
  ],

  run: async (client, interaction) => {
    try {
      const action = interaction.options.getString("action");
      const targetUser = interaction.options.getUser("user") || interaction.user;
      const isAdmin = interaction.options.getBoolean("admin") || false;

      const isGuildOwner = interaction.guild.ownerId === interaction.user.id;
      const isSelfAction = interaction.user.id === targetUser.id;

      const existingEntry = await client.state.models.ApiKey.findOne({ where: { userId: targetUser.id } });

      if (action === "create") {
        if (!isGuildOwner) {
          return await interaction.reply({
            content: "Only the guild owner can create API keys for other users.",
            ephemeral: true,
          });
        }

        const randomChars = crypto.randomBytes(10).toString("base64url").slice(0, 16);
        const apiKey = `${targetUser.username}-${randomChars}`;

        if (existingEntry) {
          // Update existing record
          await client.state.models.ApiKey.update(
            { key: apiKey, isAdmin, usageLimit: isAdmin ? 9999999 : 100 },
            { where: { userId: targetUser.id } }
          );
        } else {
          // Create new record
          await client.state.models.ApiKey.create({
            userId: targetUser.id,
            displayName: targetUser.username,
            key: apiKey,
            isAdmin,
            usageLimit: isAdmin ? 9999999 : 100,
          });
        }

        // DM the API key or notify in the server
        try {
          await targetUser.send(`Your new API key is: \`${apiKey}\``);
        } catch {
          await interaction.reply({
            content: `Failed to DM **${targetUser.username}**. They can use \`/vrcmanageapikey action:Fetch user:@${targetUser.username}\` to retrieve their key.`,
          });
          return;
        }

        await interaction.reply({
          content: `API key for **${targetUser.username}** has been created.`,
        });
      } else if (action === "remove") {

        if (!isGuildOwner) {
            return await interaction.reply({
              content: "Only the guild owner can remove API keys for other users.",
              ephemeral: true,
            });
        }

        if (!existingEntry) {
          return await interaction.reply({
            content: `User **${targetUser.username}** does not have an API key to remove.`,
            ephemeral: true,
          });
        }

        await client.state.models.ApiKey.update(
          { key: null, isAdmin: false, usageLimit: 0 },
          { where: { userId: targetUser.id } }
        );

        await interaction.reply({
          content: `API key for **${targetUser.username}** has been removed.`,
        });
      } else if (action === "fetch") {
        if (!isSelfAction) {
            return await interaction.reply({
              content: "You can only fetch your own API key.",
              ephemeral: true,
            });
        }

        if (!existingEntry || !existingEntry.key) {
          return await interaction.reply({
            content: `No API key found for **${targetUser.username}**.`,
            ephemeral: true,
          });
        }

        if (!isSelfAction && !isGuildOwner) {
          return await interaction.reply({
            content: "You can only fetch your own API key.",
            ephemeral: true,
          });
        }

        await interaction.reply({
          content: `Your API key is: \`${existingEntry.key}\``,
          ephemeral: true,
        });
    } else if (action === "regenerate") {
        if (!isSelfAction) {
          return await interaction.reply({
            content: "You can only regenerate your own API key.",
            ephemeral: true,
          });
        }

        if (!existingEntry || !existingEntry.key) {
          return await interaction.reply({
            content: "You don't have an API key to regenerate. ask Owner to create ApiKey.",
            ephemeral: true,
          });
        }

        const randomChars = crypto.randomBytes(10).toString("base64url").slice(0, 16);
        const newApiKey = `${targetUser.username}-${randomChars}`;

        await client.state.models.ApiKey.update(
          { key: newApiKey, lastUpdated: new Date() },
          { where: { userId: targetUser.id } }
        );

        try {
          await targetUser.send(`Your regenerated API key is: \`${newApiKey}\``);
        } catch {
          return await interaction.reply({
            content: `Failed to DM you the regenerated API key. Use \`/vrcmanageapikey action:Fetch user:@${targetUser.username}\` to retrieve it.`,
            ephemeral: true,
          });
        }

        await interaction.reply({
          content: "Your API key has been successfully regenerated.",
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error("Error managing API keys:", error);
      await interaction.reply({
        content: "An error occurred while processing your request.",
        ephemeral: true,
      });
    }
  },
};
