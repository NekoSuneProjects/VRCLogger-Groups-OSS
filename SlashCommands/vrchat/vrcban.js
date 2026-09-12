const {
  PermissionFlagsBits,
  ApplicationCommandType,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const { getGroup } = require("../../lib/vrcGroup");

module.exports = {
  name: "vrcban",
  description: "VRChat Ban Command",
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
  options: [],

  run: async (client, interaction, args) => {
    if (!interaction.isChatInputCommand()) return;

    try {
        if (await client.state.fns.hasAccess(interaction.user.id, "ban")) {
          if (!getGroup(client.config)) {
            return await interaction.reply({
              content: "No VRChat group is configured for this server.",
              ephemeral: true
            });
          }

          const modal = new ModalBuilder()
            .setCustomId("vrcbanuser")
            .setTitle("VRChat Ban Command");

          // Create the text input components
          const uderIdRow = new TextInputBuilder()
            .setCustomId("userid")
            // The label is the prompt the user sees for this input
            .setLabel("VRChat User ID?")
            // Short means only a single line of text
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("usr_xxx, mrq2pSMdHW, or profile URL")
            // set a default value to pre-fill the input
            // require a value in this input field
            .setRequired(true);

          // An action row only holds one text input,
          // so you need one action row per text input.
          const firstActionRow = new ActionRowBuilder().addComponents(
            uderIdRow
          );

          // Add inputs to the modal
          const reasonRow = new TextInputBuilder()
            .setCustomId("reason")
            .setLabel("Reason for ban (optional)")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("Include evidence/context for report")
            .setRequired(false);

          const secondActionRow = new ActionRowBuilder().addComponents(
            reasonRow
          );

          modal.addComponents(firstActionRow, secondActionRow);

          // Show the modal to the user
          await interaction.showModal(modal);
        } else {
          await interaction.reply({
            content: "**YOU DO NOT HAVE ACCESS THIS COMMAND!**"
          });
        }
    } catch (error) {
      console.error("Error fetching staff members:", error);
      await interaction.reply({
        content: "An error occurred while processing your request.",
        ephemeral: true
      });
    }
  }
};
