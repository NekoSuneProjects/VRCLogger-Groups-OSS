const {
  ApplicationCommandType,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

module.exports = {
  name: "vrcuserbl",
  description: "VRChat User Blacklist Manager",
  type: ApplicationCommandType.ChatInput,
  toggleOff: false,
  developersOnly: false,
  options: [],

  run: async (client, interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // SECURITY CHECK — your existing system
    const staffModel = client.state?.models?.VRCStaffList;
    const staff = staffModel ? await staffModel.findOne({
      where: { userId: interaction.user.id, active: true },
      attributes: ["role"]
    }).catch(() => null) : null;
    const role = String(staff?.role || "").toLowerCase();
    const allowedRoles = ["owner", "co-owner", "admin", "mod", "trainee", "it-tech"];
    if (!allowedRoles.includes(role)) {
      return interaction.reply({
        content: "**YOU DO NOT HAVE ACCESS TO THIS COMMAND!**",
        ephemeral: true
      });
    }

    // CREATE MODAL
    const modal = new ModalBuilder()
      .setCustomId("vrcuserblacklist")
      .setTitle("VRChat User Blacklist");

    const toggle = new TextInputBuilder()
      .setCustomId("togglesdel")
      .setLabel("Add or Remove?")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("add / remove")
      .setRequired(true);

    const userid = new TextInputBuilder()
      .setCustomId("userid")
      .setLabel("VRChat User ID")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("usr_xxx, mrq2pSMdHW, or profile URL")
      .setRequired(true);

    const display = new TextInputBuilder()
      .setCustomId("displayname")
      .setLabel("VRChat DisplayName")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Example: NekoSuneVR")
      .setRequired(false);

    const reason = new TextInputBuilder()
      .setCustomId("reason")
      .setLabel("Reason")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Enter the reason...")
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(toggle),
      new ActionRowBuilder().addComponents(userid),
      new ActionRowBuilder().addComponents(display),
      new ActionRowBuilder().addComponents(reason)
    );

    await interaction.showModal(modal);
  }
};
