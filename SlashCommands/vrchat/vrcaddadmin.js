const {
  PermissionFlagsBits,
  ApplicationCommandType,
  ApplicationCommandOptionType
} = require('discord.js')

module.exports = {
  name: 'vrcaddadmin',
  description: 'VRChat add admin to staff list',
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
      description: 'The user to add as admin',
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

      if (existingUser) {
        if (!existingUser.active) {
          await VRCStaffList.update(
            { active: true, role: 'admin' },
            { where: { userId: atuser.id } }
          )
          return await interaction.reply({
            content: `User **${atuser.globalName || atuser.username}** was reactivated as admin.`
          })
        }

        return await interaction.reply({
          content: `User **${atuser.globalName || atuser.username}** is already active.`,
          ephemeral: true
        })
      }

      await VRCStaffList.create({
        userId: atuser.id,
        displayName: atuser.globalName || atuser.username,
        role: 'admin'
      })

      await interaction.reply({
        content: `User **${atuser.globalName || atuser.username}** added as admin.`
      })
    } catch (error) {
      console.error('Error managing admin:', error)
      await interaction.reply({
        content: 'An error occurred while processing your request.',
        ephemeral: true
      })
    }
  }
}
