const { EmbedBuilder, PermissionFlagsBits, ApplicationCommandType, ApplicationCommandOptionType } = require("discord.js");

module.exports = {
    name: "uptime",
    description: "Returns BOT Uptime",
    type: ApplicationCommandType.ChatInput,
    toggleOff: false,
    developersOnly: true,
    patreonOnly: false,
    patreonManualWhitelist: [],
    userpermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
    botpermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
    options: [],
 
    run: async (client, interaction, args) => {
      let seconds = Math.floor(message.client.uptime / 1000);
      let minutes = Math.floor(seconds / 60);
      let hours = Math.floor(minutes / 60);
      let days = Math.floor(hours / 24);
      
      seconds %= 60;
      minutes %= 60;
      hours %= 24;
      return await interaction.reply(`Uptime: \`${days} day(s),${hours} hours, ${minutes} minutes, ${seconds} seconds\``)
            .catch(console.error);
    }
}