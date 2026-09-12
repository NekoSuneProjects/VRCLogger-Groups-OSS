const {
  PermissionFlagsBits,
  ApplicationCommandType,
  ApplicationCommandOptionType
} = require('discord.js')

module.exports = {
  name: 'vrcremoveadmin',
  description: 'VRChat remove admin from active staff list',
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
      name: 'user',
      type: ApplicationCommandOptionType.User,
      description: 'The user to remove',
      required: true
    }
  ],

  run: async (client, interaction) => {
    if (!interaction.isChatInputCommand()) return

    try {
      const isGuildOwner = interaction.guild.ownerId === interaction.user.id
      if (!isGuildOwner) {
        return await interaction.reply({
          content: '**YOU DO NOT HAVE ACCESS TO THIS COMMAND!**',
          ephemeral: true
        })
      }

      const atuser = interaction.options.getUser('user')
      if (!atuser) {
        return await interaction.reply({
          content: 'Invalid user specified.',
          ephemeral: true
        })
      }

      const { VRCStaffList } = client.state.models
      const existingUser = await VRCStaffList.findOne({
        where: { userId: atuser.id }
      })

      if (!existingUser) {
        return await interaction.reply({
          content: `User **${atuser.globalName || atuser.username}** is not in the staff list.`,
          ephemeral: true
        })
      }

      if (!existingUser.active) {
        return await interaction.reply({
          content: `User **${atuser.globalName || atuser.username}** is already inactive.`,
          ephemeral: true
        })
      }

      await VRCStaffList.update(
        { active: false },
        { where: { userId: atuser.id } }
      )

      await interaction.reply({
        content: `User **${atuser.globalName || atuser.username}** removed from active admins.`
      })
    } catch (error) {
      console.error('Error removing admin:', error)
      await interaction.reply({
        content: 'An error occurred while processing your request.',
        ephemeral: true
      })
    }
  }
}
