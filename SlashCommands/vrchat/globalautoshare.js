const {
  ApplicationCommandType,
  ApplicationCommandOptionType,
  PermissionFlagsBits
} = require('discord.js')
const fs = require('fs')
const { updateGroup } = require('../../lib/vrcGroup')

function getSettingsPath (client) {
  const configPath = client?.config?.__filePath
  if (!configPath) {
    throw new Error('Config file path missing for this bot.')
  }
  return configPath
}

function setAutoShare (config, enabled) {
  updateGroup(config, existing => ({
    ...existing,
    globalAnalytics: {
      ...(existing?.globalAnalytics || {}),
      autoShare: enabled
    }
  }))
}

module.exports = {
  name: 'globalautoshare',
  description: 'Toggle global analytics auto-share for this VRChat group',
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
      name: 'state',
      description: 'Turn auto-share on or off',
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: [
        { name: 'on', value: 'on' },
        { name: 'off', value: 'off' }
      ]
    }
  ],

  run: async (client, interaction) => {
    if (!interaction.guild) {
      return interaction.reply({
        content: 'Run this command inside a server.',
        ephemeral: true
      })
    }

    if (interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({
        content: 'Only the Discord server owner can use this command.',
        ephemeral: true
      })
    }

    const enabled = interaction.options.getString('state', true) === 'on'

    try {
      const settingsPath = getSettingsPath(client)
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))

      setAutoShare(settings, enabled)
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
      setAutoShare(client.config, enabled)

      return interaction.reply({
        content: `Auto-share is now ${enabled ? 'ON' : 'OFF'} for this VRChat group.`,
        ephemeral: true
      })
    } catch (err) {
      console.error('globalautoshare command error:', err)
      return interaction.reply({
        content: 'Failed to update auto-share config.',
        ephemeral: true
      }).catch(() => {})
    }
  }
}
