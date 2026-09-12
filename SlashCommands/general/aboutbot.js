const {
   EmbedBuilder,
   ActionRowBuilder,
   StringSelectMenuBuilder,
   PermissionFlagsBits,
   ApplicationCommandType,
   ApplicationCommandOptionType,
   ComponentType
} = require("discord.js");

module.exports = {
   name: "aboutbot",
   description: "About this BOT",
   toggleOff: false,
   developersOnly: false,
   patreonOnly: false,
   patreonManualWhitelist: [],
   type: ApplicationCommandType.ChatInput,
   userpermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
   botpermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
   options: [],
   run: async (client, interaction, args) => {


      const embed = new EmbedBuilder()
         .setTitle(`About BanLogger BOT`)
         .setDescription(
            `${client.botsettings?.note || "unknown"}`
         )
         .setColor(`#00ff00`)
         .setFooter({
            text: `BanLogger v${client.botsettings?.botversion || "unknown"} || Made By ${client.botsettings?.Creator || "unknown"}`,
            iconURL: client?.user?.displayAvatarURL?.({ size: 128 }) || "https://i.imgur.com/AfFp7pu.png"
         })
         .setTimestamp();


      await interaction.reply({
         embeds: [embed]
      });

   },
};