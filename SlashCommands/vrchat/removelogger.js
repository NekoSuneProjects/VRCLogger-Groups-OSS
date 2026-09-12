const {
  ApplicationCommandType,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js')
const fs = require('fs')
const { getGroup, updateGroup } = require('../../lib/vrcGroup')

const CATEGORY_SUFFIX = 'VRCLogger'
const GENERAL_TEXT_NAME = 'banlogger-general'
const VOICE_NAME = 'logger-vc'
const REQUEST_LOG_NAME = 'requestlog'

const LOGGER_CHANNELS = [
  { key: 'ANNOUNCEMENT', name: 'announcementlog' },
  { key: 'BANMEMBER', name: 'ban' },
  { key: 'UNBANMEMBER', name: 'unban' },
  { key: 'KICKMEMBER', name: 'kick' },
  { key: 'REMOVEMEMBER', name: 'removeuser' },
  { key: 'WARNMEMBER', name: 'warn' },
  { key: 'JOINMEMBER', name: 'join' },
  { key: 'LEAVEMEMBER', name: 'leave' },
  { key: 'WORLDCREATEMEMBER', name: 'worldcreated' },
  { key: 'WORLDCLOSEMEMBER', name: 'worldclosed' }
]

function getSettingsPath (client) {
  const configPath = client?.config?.__filePath
  if (!configPath) {
    throw new Error('Config file path missing for this bot.')
  }
  return configPath
}

function buildCategoryName (groupName, groupId) {
  const base =
    String(groupName || '').trim() ||
    (groupId ? `Group-${groupId}` : 'VRChat Group')
  const name = `${base}-${CATEGORY_SUFFIX}`
  return name.length > 100 ? name.slice(0, 100) : name
}

function safeDeleteChannel (channel, removed, skipped, label) {
  if (!channel) {
    skipped.push(label)
    return Promise.resolve()
  }
  return channel
    .delete('Logger cleanup')
    .then(() => removed.push(label))
    .catch(() => skipped.push(label))
}

module.exports = {
  name: 'removelogger',
  description: 'Delete logger channels and clear this bot config mappings',
  type: ApplicationCommandType.ChatInput,
  toggleOff: false,
  developersOnly: false,
  patreonOnly: false,
  patreonManualWhitelist: [],
  userpermissions: [PermissionFlagsBits.ViewChannel],
  botpermissions: [
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ViewChannel
  ],
  options: [],
  cooldowns: 2000,
  run: async (client, interaction) => {
    if (!interaction.guild) {
      return interaction.reply({
        content: 'Run this command inside a server.',
        ephemeral: true
      })
    }

    const member = interaction.member
    const isOwner = interaction.user.id === interaction.guild.ownerId
    const isAdmin =
      member?.permissions?.has?.(PermissionFlagsBits.Administrator) || false
    if (!isOwner && !isAdmin) {
      return interaction.reply({
        content: 'Only the server owner or an admin can run this command.',
        ephemeral: true
      })
    }

    await interaction.reply({
      content: 'Removing logger channels...',
      ephemeral: true
    })

    const removed = []
    const skipped = []

    try {
      const settingsPath = getSettingsPath(client)
      const raw = fs.readFileSync(settingsPath, 'utf8')
      const settings = JSON.parse(raw)
      const selectedGroup = getGroup(settings)
      if (!selectedGroup?.groupid) {
        throw new Error('Missing VRCAPI.groupid in config/settings.json.')
      }

      const groupId = selectedGroup.groupid
      const groupName = selectedGroup.groupName
      const groupSettings = {
        ...selectedGroup,
        LoggerTextChannel: selectedGroup.LoggerTextChannel || {},
        reqnotify: selectedGroup.reqnotify || {}
      }
      const categoryName = buildCategoryName(groupName, groupId)

      let category =
        (groupSettings.LoggerCategoryId &&
          interaction.guild.channels.cache.get(
            groupSettings.LoggerCategoryId
          )) ||
        null
      if (category?.type !== ChannelType.GuildCategory) category = null
      if (!category) {
        category = interaction.guild.channels.cache.find(
          c => c.type === ChannelType.GuildCategory && c.name === categoryName
        )
      }

      const byId = id =>
        id ? interaction.guild.channels.cache.get(String(id)) : null

      for (const entry of LOGGER_CHANNELS) {
        const channel = byId(groupSettings.LoggerTextChannel?.[entry.key])
        await safeDeleteChannel(channel, removed, skipped, `#${entry.name}`)
      }

      await safeDeleteChannel(
        byId(groupSettings.LoggerTextChannel?.GENERAL) ||
          category?.children?.cache?.find(
            c => c.name === GENERAL_TEXT_NAME && c.type === ChannelType.GuildText
          ),
        removed,
        skipped,
        `#${GENERAL_TEXT_NAME}`
      )

      await safeDeleteChannel(
        byId(groupSettings.LoggerTextChannel?.VOICE) ||
          category?.children?.cache?.find(
            c => c.name === VOICE_NAME && c.type === ChannelType.GuildVoice
          ),
        removed,
        skipped,
        VOICE_NAME
      )

      await safeDeleteChannel(
        byId(groupSettings.reqnotify?.REQCHANNEL) ||
          category?.children?.cache?.find(
            c =>
              c.name === REQUEST_LOG_NAME &&
              [ChannelType.GuildForum, ChannelType.GuildText].includes(c.type)
          ),
        removed,
        skipped,
        `#${REQUEST_LOG_NAME}`
      )

      if (category) {
        const hasChildren = category.children?.cache?.size > 0
        if (!hasChildren) {
          await category.delete('Logger cleanup')
          removed.push(`Category: ${categoryName}`)
        }
      }

      LOGGER_CHANNELS.forEach(entry => {
        groupSettings.LoggerTextChannel[entry.key] = ''
      })
      groupSettings.LoggerTextChannel.GENERAL = ''
      groupSettings.LoggerTextChannel.VOICE = ''
      groupSettings.LoggerCategoryId = ''

      if (groupSettings?.reqnotify) {
        groupSettings.reqnotify.REQCHANNEL = ''
      }

      const applyGroup = existing => ({
        ...existing,
        groupid: groupId,
        groupName: groupSettings.groupName,
        LoggerCategoryId: groupSettings.LoggerCategoryId,
        LoggerTextChannel: groupSettings.LoggerTextChannel,
        reqnotify: {
          ...(existing?.reqnotify || {}),
          ...(groupSettings.reqnotify || {})
        }
      })

      updateGroup(settings, applyGroup)
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
      updateGroup(client.config, applyGroup)

      const parts = []
      if (removed.length) parts.push(`Removed: ${removed.join(', ')}`)
      if (skipped.length) parts.push(`Not found: ${skipped.join(', ')}`)
      parts.push(`Cleared mappings for group ${groupId}.`)

      await interaction.editReply({
        content: parts.join('\n')
      })
    } catch (err) {
      console.error('Remove logger failed:', err)
      await interaction.editReply({
        content: 'Remove failed. Check bot permissions and logs.'
      })
    }
  }
}
