const {
  ApplicationCommandType,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js')
const fs = require('fs')
const { createVrchatApi } = require('../../utils/vrchat')
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

async function resolveGroupName (api, groupId, fallbackName) {
  if (!groupId || !api?.GetGroupInfo) return fallbackName
  try {
    const res = await api.GetGroupInfo(groupId)
    const data = res?.data
    return (
      data?.name ||
      data?.group?.name ||
      data?.data?.name ||
      fallbackName
    )
  } catch {
    return fallbackName
  }
}

async function ensureCategory (guild, name, existingId) {
  let category =
    (existingId && guild.channels.cache.get(existingId)) || null
  if (category?.type !== ChannelType.GuildCategory) category = null
  if (!category) {
    category = guild.channels.cache.find(
      c => c.type === ChannelType.GuildCategory && c.name === name
    )
  }

  if (category) {
    const renamed = category.name !== name
    if (renamed) await category.setName(name)
    return { category, created: false, renamed }
  }

  const created = await guild.channels.create({
    name,
    type: ChannelType.GuildCategory
  })
  return { category: created, created: true, renamed: false }
}

async function ensureChannelInCategory (
  guild,
  category,
  name,
  createType,
  allowedTypes = [createType],
  existingId
) {
  const allowed = new Set(allowedTypes)
  let existing =
    (existingId && guild.channels.cache.get(existingId)) || null

  if (existing && !allowed.has(existing.type)) {
    existing = null
  }

  if (!existing && category) {
    existing = category.children?.cache?.find(
      c => c.name === name && allowed.has(c.type)
    )
  }

  if (existing) {
    if (existing.name !== name) {
      await existing.setName(name).catch(() => {})
    }
    if (category && existing.parentId !== category.id) {
      await existing.setParent(category.id, { lockPermissions: false })
    }
    return { channel: existing, created: false }
  }

  const channel = await guild.channels.create({
    name,
    type: createType,
    parent: category?.id
  })
  return { channel, created: true }
}

module.exports = {
  name: 'setup',
  description: 'Create logger channels and map them in this bot config',
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
      content: 'Setting up logger channels...',
      ephemeral: true
    })

    const created = []
    const reused = []
    const renamed = []

    try {
      const settingsPath = getSettingsPath(client)
      const raw = fs.readFileSync(settingsPath, 'utf8')
      const settings = JSON.parse(raw)
      const selectedGroup = getGroup(settings)
      if (!selectedGroup?.groupid) {
        throw new Error('Missing VRCAPI.groupid in config/settings.json.')
      }

      const groupId = selectedGroup.groupid
      const groupSettings = {
        ...selectedGroup,
        LoggerTextChannel: selectedGroup.LoggerTextChannel || {},
        reqnotify: selectedGroup.reqnotify || {}
      }

      let api = null
      try {
        api = createVrchatApi(client.config)
      } catch {}

      const resolvedGroupName = await resolveGroupName(
        api,
        groupId,
        groupSettings.groupName || client.config?.VRCAPI?.groupName
      )
      const categoryName = buildCategoryName(resolvedGroupName, groupId)

      if (resolvedGroupName) {
        groupSettings.groupName = resolvedGroupName
      }

      const {
        category,
        created: catCreated,
        renamed: catRenamed
      } = await ensureCategory(
        interaction.guild,
        categoryName,
        groupSettings.LoggerCategoryId
      )
      groupSettings.LoggerCategoryId = category.id

      if (catCreated) created.push(`Category: ${categoryName}`)
      else reused.push(`Category: ${categoryName}`)
      if (catRenamed) renamed.push(`Category: ${categoryName}`)

      const mapping = {}

      for (const entry of LOGGER_CHANNELS) {
        const existingId = groupSettings.LoggerTextChannel?.[entry.key]
        const { channel, created: chanCreated } =
          await ensureChannelInCategory(
            interaction.guild,
            category,
            entry.name,
            ChannelType.GuildForum,
            [ChannelType.GuildForum, ChannelType.GuildText],
            existingId
          )
        mapping[entry.key] = channel.id
        if (chanCreated) created.push(`#${entry.name}`)
        else reused.push(`#${entry.name}`)
      }

      const { channel: generalChannel, created: generalCreated } =
        await ensureChannelInCategory(
        interaction.guild,
        category,
        GENERAL_TEXT_NAME,
        ChannelType.GuildText,
        [ChannelType.GuildText],
        groupSettings.LoggerTextChannel?.GENERAL
      )
      if (generalCreated) created.push(`#${GENERAL_TEXT_NAME}`)
      else reused.push(`#${GENERAL_TEXT_NAME}`)

      const { channel: voiceChannel, created: voiceCreated } =
        await ensureChannelInCategory(
        interaction.guild,
        category,
        VOICE_NAME,
        ChannelType.GuildVoice,
        [ChannelType.GuildVoice],
        groupSettings.LoggerTextChannel?.VOICE
      )
      if (voiceCreated) created.push(VOICE_NAME)
      else reused.push(VOICE_NAME)

      Object.entries(mapping).forEach(([key, id]) => {
        groupSettings.LoggerTextChannel[key] = id
      })

      groupSettings.LoggerTextChannel.GENERAL = generalChannel?.id || ''
      groupSettings.LoggerTextChannel.VOICE = voiceChannel?.id || ''

      if (groupSettings?.reqnotify?.enable) {
        const { channel, created: reqCreated } =
          await ensureChannelInCategory(
            interaction.guild,
            category,
            REQUEST_LOG_NAME,
            ChannelType.GuildForum,
            [ChannelType.GuildForum, ChannelType.GuildText],
            groupSettings.reqnotify?.REQCHANNEL
          )
        groupSettings.reqnotify.REQCHANNEL = channel.id
        if (reqCreated) created.push(`#${REQUEST_LOG_NAME}`)
        else reused.push(`#${REQUEST_LOG_NAME}`)
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
      if (created.length) parts.push(`Created: ${created.join(', ')}`)
      if (reused.length) parts.push(`Reused: ${reused.join(', ')}`)
      if (renamed.length) parts.push(`Renamed: ${renamed.join(', ')}`)
      parts.push(`Mapped channels for group ${groupId}.`)

      await interaction.editReply({
        content: parts.join('\n')
      })
    } catch (err) {
      console.error('Setup failed:', err)
      await interaction.editReply({
        content: 'Setup failed. Check bot permissions and logs.'
      })
    }
  }
}
