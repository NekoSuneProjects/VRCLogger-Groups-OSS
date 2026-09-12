const { MessageEmbed, PermissionFlagsBits, ApplicationCommandType, ApplicationCommandOptionType } = require("discord.js");

module.exports = {
   name: "ping",
   description: "returns websocket ping",
   type: ApplicationCommandType.ChatInput,
   toggleOff: false,
   developersOnly: false,
   patreonOnly: false,
   patreonManualWhitelist: [],
   userpermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
   botpermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
   cooldowns: 2000,
   run: async (client, interaction, args) => {
      interaction.reply(`Pinging...`).then((m4) => {
        setTimeout(() => {
            m4.edit({ content: `${client.ws.ping}ms!` });
        }, 2000);
     });
   },
};