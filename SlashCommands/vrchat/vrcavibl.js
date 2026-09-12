const {
  PermissionFlagsBits,
  ApplicationCommandType,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

module.exports = {
  name: "vrcavibl",
  description: "VRChat Avatar Blacklist",
  type: ApplicationCommandType.ChatInput,

  userpermissions: [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ViewChannel
  ],

  botpermissions: [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ViewChannel
  ],

  options: [],

  run: async (client, interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const staffModel = client.state?.models?.VRCStaffList;
    const staff = staffModel ? await staffModel.findOne({
      where: { userId: interaction.user.id, active: true },
      attributes: ["role"]
    }).catch(() => null) : null;
    const role = String(staff?.role || "").toLowerCase();
    if (!["owner", "co-owner", "admin"].includes(role)) {
      return interaction.reply({
        content: "**🚫 YOU DO NOT HAVE ACCESS TO THIS COMMAND!**",
        ephemeral: true
      });
    }

    // CREATE MODAL
    const modal = new ModalBuilder()
      .setCustomId("vrcaviblacklist")
      .setTitle("VRChat Avatar Blacklist");

    const toggle = new TextInputBuilder()
      .setCustomId("togglesdel")
      .setLabel("Add or Remove?")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("add / remove")
      .setRequired(true);

    const avatarId = new TextInputBuilder()
      .setCustomId("avatarid")
      .setLabel("Avatar ID (avtr_)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("avtr_XXXXXXXX")
      .setRequired(true);

    const userId = new TextInputBuilder()
      .setCustomId("userid")
      .setLabel("Creator User ID")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("usr_xxx, mrq2pSMdHW, or profile URL")
      .setRequired(true);

    const reason = new TextInputBuilder()
      .setCustomId("reason")
      .setLabel("Reason")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Explain why this avatar is blacklisted...")
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(toggle),
      new ActionRowBuilder().addComponents(avatarId),
      new ActionRowBuilder().addComponents(userId),
      new ActionRowBuilder().addComponents(reason)
    );

    await interaction.showModal(modal);
  }
};
