const {
  EmbedBuilder,
  PermissionFlagsBits,
  ApplicationCommandType,
  ApplicationCommandOptionType
} = require("discord.js");
const { initGlobalAnalytics } = require("../../lib/globalAnalytics");
const { normalizeVrcUserInput } = require("../../utils/vrcUserId");

function normalizeVrcUserId(input) {
  return normalizeVrcUserInput(input) || "";
}

module.exports = {
  name: "globalhistory",
  description: "View global shared community analytics for a VRChat user",
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
      name: "vrcuserid",
      description: "VRChat user id or profile URL",
      type: ApplicationCommandOptionType.String,
      required: true
    },
    {
      name: "view",
      description: "Which global data to view",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "all", value: "all" },
        { name: "bans", value: "bans" },
        { name: "unbans", value: "unbans" },
        { name: "kicks", value: "kicks" },
        { name: "warns", value: "warns" },
        { name: "joins", value: "joins" },
        { name: "leaves", value: "leaves" },
        { name: "history", value: "history" }
      ]
    }
  ],

  run: async (client, interaction) => {
    try {
      const allowed = await client.state?.fns?.hasAccess?.(
        interaction.user.id,
        "userlookup"
      );
      if (!allowed) {
        return await interaction.reply({
          content: "You do not have access to this command.",
          ephemeral: true
        });
      }

      const userInput = interaction.options.getString("vrcuserid");
      const view = interaction.options.getString("view") || "all";
      const vrcUserId = normalizeVrcUserId(userInput);
      if (!vrcUserId) {
        return await interaction.reply({
          content: "Invalid VRChat user id.",
          ephemeral: true
        });
      }

      const store = await initGlobalAnalytics();
      const data = await store.getUser(vrcUserId);
      if (!data) {
        return await interaction.reply({
          content: `No data found for ${vrcUserId}.`,
          ephemeral: true
        });
      }

      const s = data.stats;
      const history = data.history || [];
      const embed = new EmbedBuilder()
        .setColor(0x00b0f4)
        .setTitle(`Global Community Analytics`)
        .setDescription(`VRChat User: \`${vrcUserId}\``)
        .setTimestamp();

      if (view === "all" || view === "bans") {
        embed.addFields({ name: "Bans", value: String(s.bans || 0), inline: true });
      }
      if (view === "all" || view === "unbans") {
        embed.addFields({ name: "Unbans", value: String(s.unbans || 0), inline: true });
      }
      if (view === "all" || view === "kicks") {
        embed.addFields({ name: "Kicks", value: String(s.kicks || 0), inline: true });
      }
      if (view === "all" || view === "warns") {
        embed.addFields({ name: "Warns", value: String(s.warns || 0), inline: true });
      }
      if (view === "all" || view === "joins") {
        embed.addFields({ name: "Joins", value: String(s.joins || 0), inline: true });
      }
      if (view === "all" || view === "leaves") {
        embed.addFields({ name: "Leaves", value: String(s.leaves || 0), inline: true });
      }
      if (view === "all") {
        embed.addFields({ name: "Shared Count", value: String(s.shares || 0), inline: true });
      }

      if (view === "all" || view === "history") {
        const lines = history.slice(0, 10).map(row => {
          const at = row.createdAt ? new Date(row.createdAt).toISOString() : "unknown";
          return `- [${row.action}] ${row.guildName} -> ${row.groupName} by ${row.sharedByDiscordTag} (${at})`;
        });
        embed.addFields({
          name: "History",
          value: lines.length ? lines.join("\n") : "No history found."
        });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      console.error("globalhistory command error:", err);
      await interaction.reply({
        content: "Failed to read global analytics.",
        ephemeral: true
      }).catch(() => {});
    }
  }
};
