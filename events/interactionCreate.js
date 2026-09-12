// events/interactionCreate.js
const i18n = require("i18n");
i18n.setLocale("en");
const ms = require("ms");
const { EmbedBuilder } = require("discord.js");

module.exports = (client) => {
  client.on("interactionCreate", async (interaction) => {
    // This bot serves one Discord server only.
    if (interaction.guildId && interaction.guildId !== client.config?.TestingServerID) {
      return;
    }

    if (interaction.isAutocomplete?.()) {
      // No autocompleting options remain now that there is a single VRChat group.
      return interaction.respond([]).catch(() => {});
    }

    const {
      developerID = [],
      randomMessages_Cooldown = []
    } = client.config || {};

    if (interaction.isCommand?.()) {
      const cmd = client.slashCommands.get(interaction.commandName.toLowerCase());
      if (!cmd) return interaction.reply({ content: "An error has occured " });

      const args = [];
      for (let option of interaction.options.data) {
        if (option.type === 1 /* SUB_COMMAND */) {
          if (option.name) args.push(option.name);
          option.options?.forEach((x) => x.value && args.push(x.value));
        } else if (option.value) args.push(option.value);
      }
      interaction.member = interaction.guild.members.cache.get(interaction.user.id);

      if (cmd.toggleOff) {
        const embed = new EmbedBuilder()
          .setTitle(`:x: | That Command Has Been Disabled By The Developers! Please Try Later.`)
          .setColor(0x0099ff)
          .setFooter({
            text: `BanLogger v${client.botsettings?.botversion || "unknown"} || Made By ${client.botsettings?.Creator || "unknown"}`,
            iconURL: client?.user?.displayAvatarURL?.({ size: 128 }) || "https://i.imgur.com/AfFp7pu.png"
          })
          .setTimestamp();
        return interaction.reply({ embeds: [embed] });
      }

      if (!interaction.member.permissions.has(cmd.userpermissions || [])) {
        const embed = new EmbedBuilder()
          .setTitle(`:x: | You Don't Have Permissions To Use The Command!`)
          .setColor(0x0099ff)
          .setFooter({
            text: `BanLogger v${client.botsettings?.botversion || "unknown"} || Made By ${client.botsettings?.Creator || "unknown"}`,
            iconURL: client?.user?.displayAvatarURL?.({ size: 128 }) || "https://i.imgur.com/AfFp7pu.png"
          })
          .setTimestamp();
        return interaction.reply({ embeds: [embed] });
      }

      if (!interaction.guild.members.me.permissions.has(cmd.botpermissions || [])) {
        const embed = new EmbedBuilder()
          .setTitle(`:x: | I Don't Have Permissions To Use The Command!`)
          .setColor(0x0099ff)
          .setFooter({
            text: `BanLogger v${client.botsettings?.botversion || "unknown"} || Made By ${client.botsettings?.Creator || "unknown"}`,
            iconURL: client?.user?.displayAvatarURL?.({ size: 128 }) || "https://i.imgur.com/AfFp7pu.png"
          })
          .setTimestamp();
        return interaction.reply({ embeds: [embed] });
      }

      if (cmd.developersOnly) {
        if (!developerID.includes(interaction.member.id)) {
          const embed = new EmbedBuilder()
            .setTitle(`:x: | Only Developers Can Use That Command!`)
            .setDescription(`Developers: ${developerID.map((v) => `<@${v}>`).join(",")}`)
            .setColor(0x0099ff)
            .setFooter({
              text: `BanLogger v${client.botsettings?.botversion || "unknown"} || Made By ${client.botsettings?.Creator || "unknown"}`,
              iconURL: client?.user?.displayAvatarURL?.({ size: 128 }) || "https://i.imgur.com/AfFp7pu.png"
            })
            .setTimestamp();
          return interaction.reply({ embeds: [embed] });
        }
      }

      if (cmd.cooldowns) {
        if (client.cooldowns.has(`${cmd.name}${interaction.member.id}`)) {
          const embed = new EmbedBuilder()
            .setTitle(
              `${randomMessages_Cooldown[
              Math.floor(Math.random() * randomMessages_Cooldown.length)
              ] || "Slow down!"
              }`
            )
            .setDescription(
              `You Need To Wait \`${ms(
                client.cooldowns.get(`${cmd.name}${interaction.member.id}`) - Date.now(),
                { long: true }
              )}\` To Use \`/${cmd.name}\` again!`
            )
            .setColor(0x0099ff)
            .setFooter({
              text: `BanLogger v${client.botsettings?.botversion || "unknown"} || Made By ${client.botsettings?.Creator || "unknown"}`,
              iconURL: client?.user?.displayAvatarURL?.({ size: 128 }) || "https://i.imgur.com/AfFp7pu.png"
            })
            .setTimestamp();
          return interaction.reply({ embeds: [embed] });
        }

        client.cooldowns.set(`${cmd.name}${interaction.member.id}`, Date.now() + cmd.cooldowns);
        setTimeout(() => {
          client.cooldowns.delete(`${cmd.name}${interaction.member.id}`);
        }, cmd.cooldowns);
      }

      cmd.run(client, interaction, args);
    }

    if (interaction.isUserContextMenuCommand?.()) {
      await interaction.deferReply({ ephemeral: false });
      const command = client.slashCommands.get(interaction.commandName.toLowerCase());
      if (command) command.run(client, interaction);
    }
  });
};
