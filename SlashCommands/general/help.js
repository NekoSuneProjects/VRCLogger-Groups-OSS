const {
   EmbedBuilder,
   ActionRowBuilder,
   StringSelectMenuBuilder,
   PermissionFlagsBits,
   ApplicationCommandType,
   ApplicationCommandOptionType,
   ComponentType
} = require("discord.js");
const helpemoji = require("../../config/help.json");

module.exports = {
   name: "help",
   description: "Help Command",
   toggleOff: false,
   developersOnly: false,
   patreonOnly: false,
   patreonManualWhitelist: [],
   type: ApplicationCommandType.ChatInput,
   userpermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
   botpermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
   options: [],
   run: async (client, interaction, args) => {

      const { clientname, clientavatar } = client.config;

      const roleColor =
         interaction.guild.members.me.displayHexColor === "#000000"
            ? "#ffffff"
            : interaction.guild.members.me.displayHexColor;
      const directories = [
         ...new Set(client.slashCommands.map((cmd) => cmd.directory)),
      ];

      const formatString = (str) => {
         return `${str[0].toUpperCase()}${str.slice(1).toLowerCase()}`;
      };

      const categories = directories.map((dir) => {
         const getCommands = client.slashCommands
            .filter((cmd) => cmd.directory === dir)
            .map((cmd) => {
               return {
                  name: cmd.name ? cmd.name : "No command name!",
                  description: cmd.description
                     ? cmd.description
                     : "No command description!",
               };
            });

         return {
            directory: formatString(dir),
            commands: getCommands,
         };
      });

      const embed = new EmbedBuilder()
         .setTitle(`${clientname || "Bot"}'s Commands`)
         .setDescription(
            "Please choose one of the options in the dropdown below!"
         )
         .setColor(roleColor)
         .setFooter({
        text: `BanLogger v${client.botsettings?.botversion || "unknown"} || Made By ${client.botsettings?.Creator || "unknown"}`,
        iconURL: client?.user?.displayAvatarURL?.({ size: 128 }) || "https://i.imgur.com/AfFp7pu.png"
      })
   .setTimestamp();

   const components = (state) => [
      new ActionRowBuilder().addComponents(
         new StringSelectMenuBuilder()
            .setCustomId("help-menu")
            .setPlaceholder("Please select a category!")
            .setDisabled(state)
            .addOptions(
               categories.map((cmd) => {
                  return {
                     label: `${cmd.directory}`,
                     value: `${cmd.directory.toLowerCase()}`,
                     //emoji: `${helpemoji[cmd.directory.toLowerCase()]}`,
                     description: `Commands from ` + `${cmd.directory}` + " category",
                  };
               }),
            )
      ),
   ];

   const inMessage = await interaction.reply({
      embeds: [embed],
      components: components(false),
   });

   const filter = (interaction) => interaction.user.id === interaction.user.id;

   const collector = interaction.channel.createMessageComponentCollector({
      filter,
      componentType: ComponentType.SELECT_MENU,
      time: 60000,
   });

   collector.on("collect", (interaction) => {
      const [directory] = interaction.values;
      const category = categories.find(
         (x) => x.directory.toLowerCase() === directory
      );

      const embed2 = new EmbedBuilder()
         .setTitle(`${directory.charAt(0).toUpperCase()}${directory.slice(1).toLowerCase()}`)
         .setDescription(
            "" + category.commands.map((cmd) => `✪ | \`${cmd.name}\` (*${cmd.description}*)`).join("\n ")
         )
         .setFooter({
            text: `BanLogger v${client.botsettings?.botversion || "unknown"} || Made By ${client.botsettings?.Creator || "unknown"}`,
            iconURL: client?.user?.displayAvatarURL?.({ size: 128 }) || "https://i.imgur.com/AfFp7pu.png"
         })
         .setColor(roleColor);


      interaction.update({ embeds: [embed2] });
   });

   collector.on("end", () => {
      inMessage.edit({ components: components(true) });
   });

},
};