const {
  EmbedBuilder,
  PermissionFlagsBits,
  ApplicationCommandType
} = require("discord.js");

module.exports = {
  name: "restart",
  description: "RESTART BOT (ONLY DEVELOPERS HAS ACCESS)",
  type: ApplicationCommandType.ChatInput,
  toggleOff: false,
  developersOnly: true,
  patreonOnly: false,
  patreonManualWhitelist: [],
  userpermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
  botpermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
  options: [],

  run: async (client, interaction) => {
    // pull token for THIS bot only
    const token =
      client?.state?.config?.token ||
      client?.config?.token ||
      process.env.DISCORD_TOKEN; // last-ditch fallback

    if (!token) {
      return interaction.reply({
        content: "❌ Cannot restart: no token available for this bot.",
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setDescription("```Restarting this bot…```")
      .setColor(0x00ff00)
      .setFooter({
        text: `BanLogger v${client.botsettings?.botversion || "unknown"} || Made By ${client.botsettings?.Creator || "unknown"}`,
        iconURL: client?.user?.displayAvatarURL?.({ size: 128 }) || "https://i.imgur.com/AfFp7pu.png"
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });

    // small delay so the reply gets out before we drop the ws connection
    setTimeout(async () => {
      try {
        // gracefully disconnect THIS client only
        await client.destroy();

        // re-login this same client with its own token
        await client.login(token);

        // (optional) notify the invoker if you track restarts elsewhere
        // you can't edit the ephemeral reply after destroy+login reliably,
        // but you can log to console:
        console.log(`[Restart] ${client.user?.tag || "Bot"} restarted successfully.`);
      } catch (err) {
        console.error("[Restart] Failed to restart this bot:", err);
      }
    }, 1200);
  }
};
