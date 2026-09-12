const {
  PermissionFlagsBits,
  ApplicationCommandType,
  ApplicationCommandOptionType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
} = require("discord.js");

module.exports = {
  name: "vrcgroupsbl",
  description: "VRChat Groups Blacklist",
  type: ApplicationCommandType.ChatInput,
  toggleOff: false,
  developersOnly: false,
  userpermissions: [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ViewChannel,
  ],
  botpermissions: [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ViewChannel,
  ],

  options: [
    {
      name: "groupid",
      description: "VRChat group ID (grp_xxxxx)",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
    {
      name: "groupname",
      description: "Name of the group",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
    {
      name: "reason",
      description: "Why this group is blacklisted",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
    {
      name: "action",
      description: "Add or remove group from blacklist",
      type: ApplicationCommandOptionType.String,
      choices: [
        { name: "Add", value: "add" },
        { name: "Remove", value: "remove" },
      ],
      required: true,
    },
  ],

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
        content: "**🚫 You do not have permission to use this command!**",
        ephemeral: true,
      });
    }

    try {
      const { VRCBlacklistGroups } = client.state.models;

      const groupId = interaction.options.getString("groupid");
      const groupName = interaction.options.getString("groupname");
      const reason = interaction.options.getString("reason");
      const action = interaction.options.getString("action"); // add/remove

      // ---------- TYPE SELECT MENU ----------
      const typeSelect = new StringSelectMenuBuilder()
        .setCustomId("group_bl_type")
        .setPlaceholder("Select group blacklist type")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel("Malicious").setValue("MALICIOUS"),
          new StringSelectMenuOptionBuilder().setLabel("Nuisance").setValue("NUISANCE"),
          new StringSelectMenuOptionBuilder().setLabel("Unknown").setValue("UNKNOWN"),
          new StringSelectMenuOptionBuilder().setLabel("Affiliated").setValue("AFFILIATED"),
          new StringSelectMenuOptionBuilder().setLabel("Community").setValue("COMMUNITY"),
          new StringSelectMenuOptionBuilder().setLabel("WatchList").setValue("WATCHLIST"),
        );

      // ---------- TAG SELECT MENU ----------
      const tagLabels = [
        "Moderation", "Crasher", "Anti-Fur", "Ripper", "Client",
        "Troll", "Community", "Gang", "Toxic", "Affiliated",
        "BOS", "Other", "Furry Hate Group", "BOT",
      ];

      const tagOptions = tagLabels.map(label =>
        new StringSelectMenuOptionBuilder().setLabel(label).setValue(label)
      );

      const tagsSelect = new StringSelectMenuBuilder()
        .setCustomId("group_bl_tags")
        .setPlaceholder("Select tags")
        .setMinValues(0)
        .setMaxValues(6)
        .addOptions(tagOptions);

      await interaction.reply({
        content: `**Editing blacklist entry for:**  
**${groupName}** (\`${groupId}\`)  
Action: **${action.toUpperCase()}**  
\nSelect the group's classification + tags.`,
        components: [
          new ActionRowBuilder().addComponents(typeSelect),
          new ActionRowBuilder().addComponents(tagsSelect),
        ],
        ephemeral: true,
      });

      // ---------- COLLECTOR ----------
      let chosenType = null;
      let chosenTags = [];

      const collector = interaction.channel.createMessageComponentCollector({
        filter: i =>
          ["group_bl_type", "group_bl_tags"].includes(i.customId) &&
          i.user.id === interaction.user.id,
        time: 60_000,
      });

      collector.on("collect", async i => {
        if (i.customId === "group_bl_type") chosenType = i.values[0];
        if (i.customId === "group_bl_tags") chosenTags = i.values;

        await i.deferUpdate();

        if (chosenType) {
          collector.stop("done");
        }
      });

      // ---------- FINISH ----------
      collector.on("end", async (_, reasonEnd) => {
        if (reasonEnd !== "done" || !chosenType) {
          return interaction.followUp({
            content: "❌ Blacklist setup cancelled or timed out.",
            ephemeral: true,
          });
        }

        const blacklisted =
          ["MALICIOUS", "NUISANCE", "UNKNOWN"].includes(chosenType);

        if (action === "add") {
          const existing = await VRCBlacklistGroups.findOne({
            where: { groupID: groupId },
          });

          const payload = {
            name: groupName,
            groupID: groupId,
            reason,
            type: chosenType,
            tags: chosenTags,
            moderator: interaction.user.username,
            createdBy: existing?.createdBy || interaction.user.id,
            updatedBy: interaction.user.id,
            blacklisted: blacklisted,
            date: new Date(),
          };

          if (existing) {
            await VRCBlacklistGroups.update(payload, { where: { groupID: groupId } });
            return interaction.followUp({
              content: `🔄 **Updated** group blacklist entry for \`${groupId}\`.\nType: **${chosenType}**`,
              ephemeral: true,
            });
          }

          await VRCBlacklistGroups.create(payload);
          return interaction.followUp({
            content: `✅ **Added** group \`${groupId}\` to blacklist.\nType: **${chosenType}**`,
            ephemeral: true,
          });
        }

        // ---------- REMOVE ----------
        if (action === "remove") {
          const existing = await VRCBlacklistGroups.findOne({
            where: { groupID: groupId },
          });

          if (!existing) {
            return interaction.followUp({
              content: `⚠️ Group \`${groupId}\` was not found in blacklist.`,
              ephemeral: true,
            });
          }

          await VRCBlacklistGroups.update(
            {
              blacklisted: false,
              archived: true,
              archivedAt: new Date(),
              archivedBy: interaction.user.id,
              updatedBy: interaction.user.id,
              tags: [],
              type: null,
              reason: null,
            },
            { where: { groupID: groupId } },
          );

          return interaction.followUp({
            content: `🟩 **Group removed** from blacklist.`,
            ephemeral: true,
          });
        }
      });

    } catch (err) {
      console.error("vrcgroupsbl error:", err);
      return interaction.reply({
        content: "❌ A system error occurred while processing the request.",
        ephemeral: true,
      });
    }
  },
};
