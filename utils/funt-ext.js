// utils/funt-ext.js
const {
  ActionRowBuilder,
  ButtonBuilder,
  ChannelType,
  StringSelectMenuBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js')

const { createVrchatApi } = require('../utils/vrchat')
const { normalizeVrcUserInput } = require('../utils/vrcUserId')
const {
  buildModerationReport,
  attachmentsFromInteraction
} = require('./vrchatHelpDesk')
const { DataTypes } = require('sequelize')
const { getGroup } = require('../lib/vrcGroup')
const { initGlobalAnalytics, mapActionToMetric } = require('../lib/globalAnalytics')

// initializer: wire everything up for a specific client instance
module.exports = function initFunExt (client, profile) {
  const cfg = profile?.config || client.config || {}
  const api = createVrchatApi(cfg, db)
  const db = profile?.db || client.state?.db || {}
  const analyticsStorePromise = initGlobalAnalytics().catch(err => {
    console.error('Failed to init global analytics store:', err.message)
    return null
  })

  const { GroupUserEvent, GroupEvents, VRCStaffList } = db

  const profileGuildId = String(cfg.TestingServerID || '')
  const isInteractionForProfile = interaction => {
    if (!profileGuildId) return true
    return String(interaction.guildId || '') === profileGuildId
  }

  async function hasAccess (userId, actionName, groupOverride = null) {
    const defaultGroup = groupOverride || getGroup(cfg)
    const allowedRoles =
      defaultGroup?.ACCESS?.[actionName] || cfg?.VRCAPI?.ACCESS?.[actionName]
    if (!Array.isArray(allowedRoles)) return false
    const user = await VRCStaffList?.findOne({
      where: { userId, active: true },
      attributes: ['role']
    })
    const role = String(user?.role || '').toLowerCase()
    if (!role) return false
    return allowedRoles.map(r => String(r).toLowerCase()).includes(role)
  }

  async function safeReplyEphemeral (interaction, payload) {
    try {
      if (interaction.deferred || interaction.replied) {
        return await interaction.followUp({ ...payload, ephemeral: true })
      }
      return await interaction.reply({ ...payload, ephemeral: true })
    } catch (err) {
      // 10062: Unknown interaction (expired), 40060: already acknowledged
      if (err?.code === 10062 || err?.code === 40060) return null
      throw err
    }
  }

  const encodeTarget = (prefix, userId) => `${prefix}://${String(userId || '')}`

  const decodeTarget = (customId, prefix) => {
    const raw = String(customId || '').replace(`${prefix}://`, '')
    // Buttons posted by older multi-group builds encoded "<groupId>|<userId>".
    const parts = raw.split('|')
    const userId = parts.length > 1 ? parts[1] : parts[0]
    return { group: getGroup(cfg), userId: String(userId || '') }
  }

  const normalizeUserId = value => normalizeVrcUserInput(value) || ''
  const userProfileUrl = userId =>
    `https://vrchat.com/home/user/${encodeURIComponent(String(userId || ''))}`

  function mapEventTypeToAction (eventType) {
    switch (String(eventType || '').toLowerCase()) {
      case 'group.user.ban':
        return 'ban'
      case 'group.user.unban':
        return 'unban'
      case 'group.instance.kick':
        return 'kick'
      case 'group.instance.warn':
        return 'warn'
      case 'group.member.join':
        return 'join'
      case 'group.member.leave':
        return 'leave'
      default:
        return null
    }
  }

  function extractEventUserId (event) {
    return (
      normalizeUserId(event?.targetId) || normalizeUserId(event?.actorId) || ''
    )
  }

  function canAutoShareAnalytics (group) {
    return Boolean(group?.globalAnalytics?.autoShare)
  }

  async function trackGlobalAnalytics ({
    vrcUserId,
    action,
    group,
    guildId,
    guildName,
    sharedByDiscordId,
    sharedByDiscordTag,
    mode
  }) {
    const store = await analyticsStorePromise
    if (!store) return null
    if (!mapActionToMetric(action)) return null

    return await store.track({
      vrcUserId,
      action,
      groupId: group?.groupid,
      groupName: group?.groupName,
      guildId,
      guildName,
      sharedByDiscordId,
      sharedByDiscordTag,
      mode
    })
  }

  function extractTagsFromThread (thread) {
    if (!thread?.isThread?.()) return []

    // Forum tags
    if (thread.parent?.type === ChannelType.GuildForum) {
      const byId = new Map(
        (thread.parent.availableTags || []).map(tag => [tag.id, tag.name])
      )
      const names = (thread.appliedTags || [])
        .map(id => byId.get(id))
        .filter(Boolean)
      return [...new Set(names)]
    }

    // Pseudo tags: "name [tag1, tag2]"
    const m = String(thread.name || '').match(/\[([^\]]+)\]\s*$/)
    if (!m?.[1]) return []
    return m[1]
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  }

  // ephemeral context:
  //   choices: string[] slugs selected
  //   map: Map<slug -> displayName>
  const pendingTagCtx = new Map() // key = `${userId}:${threadId}` -> { choices: string[], map: Map }
  const banReportCache = new Map()

  // Persist ban report context for report button reuse
  let BanReportCacheModel = null
  async function ensureBanReportCacheModel (db) {
    if (BanReportCacheModel) return BanReportCacheModel
    const sequelize = db?.sequelize
    if (!sequelize) return null
    BanReportCacheModel = sequelize.define(
      'BanReportCache',
      {
        moderatorId: { type: DataTypes.STRING, primaryKey: true },
        bannedUserId: { type: DataTypes.STRING },
        reason: { type: DataTypes.TEXT }
      },
      { tableName: 'BanReportCache', timestamps: false }
    )
    await BanReportCacheModel.sync()
    db.BanReportCache = BanReportCacheModel
    return BanReportCacheModel
  }

  // ---------- file + forum utilities ----------

  async function loadTagNamesFromFile () {
    const DEFAULTS = [
      'Hacking',
      'Client',
      'Exploits',
      'Crasher',
      'Ripper',
      'Doxxing',
      'Threats',
      'Harassment',
      'Hate Raid',
      'Hate Speech',
      'Racist',
      'Mic Spam',
      'Soundboard Spam',
      'Text Spam',
      'Advertising',
      'Impersonation',
      'Phishing/Scam',
      'Underage',
      'NSFW Public',
      'Grooming'
    ]

    try {
      const raw = client?.tags?.names
      if (!Array.isArray(raw)) return DEFAULTS

      const seen = new Set()
      const cleaned = []

      for (let name of raw) {
        if (name == null) continue
        let s = String(name).trim()
        if (!s) continue

        // Discord forum tag name limit
        if (s.length > 20) s = s.slice(0, 20)

        const key = s.toLowerCase()
        if (seen.has(key)) continue

        seen.add(key)
        cleaned.push(s)

        // Discord forum channels allow up to 20 available tags
        if (cleaned.length >= 20) break
      }

      return cleaned.length ? cleaned : DEFAULTS
    } catch {
      return DEFAULTS
    }
  }

  function slugify (name) {
    return String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  }

  /**
   * Return the list of tag names to show in the picker:
   * - If in a forum (or a thread under a forum) and there are configured tags, use those names.
   * - Else fall back to names from config file.
   */
  async function getPickerNamesForChannel (channelOrThread) {
    const parent = channelOrThread?.isThread?.()
      ? channelOrThread.parent
      : channelOrThread
    if (
      parent?.type === ChannelType.GuildForum &&
      parent.availableTags?.length
    ) {
      return parent.availableTags.map(t => t.name)
    }
    return await loadTagNamesFromFile()
  }

  /**
   * Ensure all `names` exist as forum tags; returns their IDs in order.
   */
  async function ensureForumTagsAndGetIds (forumChannel, names = []) {
    if (forumChannel?.type !== ChannelType.GuildForum) return []

    const byName = new Map(
      forumChannel.availableTags.map(t => [t.name.toLowerCase(), t])
    )
    const missing = names.filter(n => !byName.has(String(n).toLowerCase()))

    if (missing.length) {
      const me = forumChannel.guild.members.me
      const canEdit = me
        ?.permissionsIn(forumChannel)
        ?.has(PermissionFlagsBits.ManageChannels)
      if (canEdit) {
        const keep = forumChannel.availableTags.map(t => ({ id: t.id }))
        const add = missing.map(n => ({ name: String(n).slice(0, 20) })) // 20-char limit
        try {
          const updated = await forumChannel.setAvailableTags([...keep, ...add])
          updated.availableTags.forEach(t =>
            byName.set(t.name.toLowerCase(), t)
          )
        } catch (e) {
          console.error('Failed to add forum tags:', e)
        }
      }
    }

    return names
      .map(n => byName.get(String(n).toLowerCase()))
      .filter(Boolean)
      .map(t => t.id)
  }

  /**
   * Unified resolver: return forum tag IDs if in a forum; otherwise indicate pseudo mode.
   * If forum has no tags configured, we populate from file automatically.
   */
  async function resolveForumOrPseudo (channelOrThread, desiredNames) {
    const parent = channelOrThread?.isThread?.()
      ? channelOrThread.parent
      : channelOrThread

    if (parent?.type === ChannelType.GuildForum) {
      // If forum has no tags, seed it from file before continuing
      if (!parent.availableTags?.length) {
        const fromFile = await loadTagNamesFromFile()
        await ensureForumTagsAndGetIds(parent, fromFile)
        // re-fetch is not strictly needed; ensureForumTagsAndGetIds updates internal list
      }

      const ids = await ensureForumTagsAndGetIds(parent, desiredNames)
      return { mode: 'forum', ids }
    }

    return { mode: 'pseudo', ids: [] }
  }

  /**
   * Apply pseudo-tags on a text thread:
   * - add [tag1, tag2] suffix to thread name
   * - pin/update a "**Tags:** ..." message
   */
  async function applyPseudoTags (thread, names = []) {
    const base = thread.name.replace(/\s*\[[^\]]*\]\s*$/g, '').trim()
    const suffix = names.length ? ` [${names.join(', ')}]` : ''
    if (base + suffix !== thread.name) {
      await thread.setName(base + suffix).catch(() => {})
    }
    try {
      const pinned = await thread.messages.fetchPinned()
      const prev = pinned.find(
        m =>
          m.author.id === thread.client.user.id &&
          m.content?.startsWith('**Tags:**')
      )
      const content = `**Tags:** ${names.length ? names.join(', ') : 'None'}`
      if (prev?.editable) await prev.edit({ content }).catch(() => {})
      else {
        const msg = await thread.send({ content }).catch(() => null)
        if (msg?.pinnable) await msg.pin().catch(() => {})
      }
    } catch {}
  }

  // ------------ helpers ------------
  async function logUserEvent (event, UserEvents) {
    const eventUserId =
      normalizeUserId(event?.targetId) || normalizeUserId(event?.actorId)
    if (!eventUserId) return
    const [row] = await UserEvents.findOrCreate({
      where: { userId: eventUserId },
      defaults: {
        userId: eventUserId,
        bans: 0,
        unbans: 0,
        kicks: 0,
        warnings: 0,
        joins: 0,
        leaves: 0,
        remove: 0,
        requestsend: 0,
        requestreject: 0
      }
    })
    switch (event.eventType) {
      case 'group.user.ban':
        await row.increment('bans')
        break
      case 'group.user.unban':
        await row.increment('unbans')
        break
      case 'group.instance.kick':
        await row.increment('kicks')
        break
      case 'group.instance.warn':
        await row.increment('warnings')
        break
      case 'group.member.join':
        await row.increment('joins')
        break
      case 'group.member.leave':
        await row.increment('leaves')
        break
      case 'group.member.remove':
        await row.increment('remove')
        break
      case 'group.request.create':
        await row.increment('requestsend')
        break
      case 'group.request.reject':
        await row.increment('requestreject')
        break
    }
    await row.save()
  }

  function buildListFields (title, items) {
    const fields = []
    let buf = ''

    // Ensure array
    const list = Array.isArray(items) ? items : []

    for (const name of list) {
      if ((buf + name + '\n').length > 1024) {
        fields.push({
          name: fields.length ? 'Continued:' : title,
          value: buf.trim(),
          inline: false
        })
        buf = ''
      }
      buf += `${name}\n`
    }

    if (buf) {
      fields.push({
        name: fields.length ? 'Continued:' : title,
        value: buf.trim(),
        inline: false
      })
    }

    if (fields.length === 0) {
      fields.push({ name: title, value: 'None', inline: false })
    }

    return fields
  }

  async function BigLogger (
    event,
    UserEvents,
    action,
    buttonStyle,
    channel,
    groupCtx,
    targetId,
    userdata
  ) {
    const activeGroup = groupCtx || getGroup(cfg) || {}
    const normalizedTargetId = normalizeUserId(targetId)
    if (!normalizedTargetId) return

    // per-user counters
    let userEventData = await UserEvents.findOne({
      where: { userId: normalizedTargetId }
    })
    if (!userEventData) {
      userEventData = await UserEvents.create({
        userId: normalizedTargetId,
        bans: 0,
        unbans: 0,
        kicks: 0,
        warnings: 0,
        joins: 0,
        leaves: 0,
        remove: 0,
        requestsend: 0,
        requestreject: 0
      })
    }

    const bans =
      event.eventType === 'group.user.ban'
        ? userEventData.bans + 1
        : userEventData.bans
    const unbans =
      event.eventType === 'group.user.unban'
        ? userEventData.unbans + 1
        : userEventData.unbans
    const kicks =
      event.eventType === 'group.instance.kick'
        ? userEventData.kicks + 1
        : userEventData.kicks
    const warnings =
      event.eventType === 'group.instance.warn'
        ? userEventData.warnings + 1
        : userEventData.warnings

    const blacklistGroupsResult = await api.GetBannedUsersGroups(
      normalizedTargetId
    )

    // Member groups fields
    const groupFields = []
    const groupNames = Array.isArray(
      blacklistGroupsResult.userGroupsResult?.data
    )
      ? blacklistGroupsResult.userGroupsResult.data.map(g => g.name)
      : []
    let buf = ''
    for (const name of groupNames) {
      if ((buf + name + '\n').length > 1024) {
        groupFields.push({
          name: groupFields.length ? 'Continued:' : 'Member of Groups:',
          value: buf.trim(),
          inline: false
        })
        buf = ''
      }
      buf += `${name}\n`
    }
    if (buf)
      groupFields.push({
        name: groupFields.length ? 'Continued:' : 'Member of Groups:',
        value: buf.trim(),
        inline: false
      })
    if (groupFields.length === 0)
      groupFields.push({
        name: 'Member of Groups:',
        value: 'None',
        inline: false
      })

    // Blacklisted groups fields
    // Member Groups (always available)
    const memberGroups = Array.isArray(blacklistGroupsResult.userGroups)
      ? blacklistGroupsResult.userGroups.map(g => g.name)
      : []

    const memberGroupFields = buildListFields('Member of Groups:', memberGroups)

    // Blacklisted Groups (MALICIOUS / NUISANCE)
    const blacklistNames = Array.isArray(blacklistGroupsResult.blacklistMatches)
      ? blacklistGroupsResult.blacklistMatches.map(g => g.name)
      : []

    const blacklistFields = buildListFields(
      'Blacklisted Groups:',
      blacklistNames
    )

    // Watchlist Groups (WATCHLIST)
    const watchlistNames = Array.isArray(blacklistGroupsResult.watchlistMatches)
      ? blacklistGroupsResult.watchlistMatches.map(g => g.name)
      : []

    const watchlistFields = buildListFields('Watchlist Groups:', watchlistNames)

    // Community Groups (COMMUNITY)
    const communityNames = Array.isArray(blacklistGroupsResult.communityMatches)
      ? blacklistGroupsResult.communityMatches.map(g => g.name)
      : []

    const communityFields = buildListFields('Community Groups:', communityNames)

    // Affiliated Groups (AFFILIATED)
    const affiliatedNames = Array.isArray(
      blacklistGroupsResult.affiliatedMatches
    )
      ? blacklistGroupsResult.affiliatedMatches.map(g => g.name)
      : []

    const affiliatedFields = buildListFields(
      'Affiliated Groups:',
      affiliatedNames
    )

    const dangerColor = parseInt(cfg.embedcfg?.colors?.Danger ?? 'ff0000', 16)
    const successColor = parseInt(cfg.embedcfg?.colors?.Success ?? '00ff00', 16)

    const iconURL =
      client.guilds.cache
        .get(client.config.TestingServerID)
        ?.iconURL({ size: 1024, extension: 'png' }) ??
      'https://i.imgur.com/AfFp7pu.png' // fallback if no icon / not cached

    const embed = new EmbedBuilder()
      .setAuthor({
        name: activeGroup.groupName || 'VRChat Group',
        iconURL: iconURL,
        url: `https://vrchat.com/home/group/${activeGroup.groupid || ''}`
      })
      .setColor(buttonStyle === ButtonStyle.Danger ? dangerColor : successColor)
      .setTitle(`${userdata.data.displayName}`)
      .setImage(`${userdata.data.currentAvatarImageUrl}`)
      .setURL(userProfileUrl(normalizedTargetId))
      .setFields([
        { name: 'Event AuditId:', value: `${event.id}`, inline: false },
        { name: 'Event Type:', value: `${event.eventType}`, inline: false },
        { name: 'VRC UserId:', value: `${userdata.data.id}`, inline: false },
        {
          name: 'User Status:',
          value: userdata.data.statusDescription || 'N/A',
          inline: false
        },
        { name: 'User Bio:', value: userdata.data.bio || 'N/A', inline: false },
        ...memberGroupFields,
        ...blacklistFields,
        ...watchlistFields,
        ...communityFields,
        ...affiliatedFields,
        {
          name: 'Date Joined:',
          value: `${userdata.data.date_joined}`,
          inline: false
        },
        { name: 'Bans:', value: `${bans} Events`, inline: false },
        { name: 'UnBans:', value: `${unbans} Events`, inline: false },
        { name: 'Kicks:', value: `${kicks} Events`, inline: false },
        { name: 'Warns:', value: `${warnings} Events`, inline: false }
      ])
      .setTimestamp(new Date(event.created_at))
      .setFooter({
        text: `BanLogger v${
          client.botsettings?.botversion || 'unknown'
        } || Made By ${client.botsettings?.Creator || 'unknown'}`,
        iconURL:
          client?.user?.displayAvatarURL?.({ size: 128 }) ||
          'https://i.imgur.com/AfFp7pu.png'
      })

    const userKey = normalizedTargetId
    if (action === 'ban') {
      const reason = event?.description || 'No reason provided'
      const model = await ensureBanReportCacheModel(db)
      if (model) {
        await model.upsert({
          moderatorId: client.user.id,
          bannedUserId: userKey,
          reason
        })
      } else {
        banReportCache.set(userKey, { userId: userKey, reason })
      }
    }

    const banbutton =
      action === 'ban'
        ? new ButtonBuilder()
            .setCustomId(encodeTarget('unban', userKey))
            .setLabel('UNBAN USER')
            .setStyle(buttonStyle)
        : new ButtonBuilder()
            .setCustomId(encodeTarget('ban', userKey))
            .setLabel('BAN USER')
            .setStyle(buttonStyle)

    const tagBtn = new ButtonBuilder()
      .setCustomId(`settags://${userKey}`)
      .setLabel('Set Tags')
      .setStyle(ButtonStyle.Secondary)

    const reactedBtn = new ButtonBuilder()
      .setCustomId(encodeTarget('reacted', userKey))
      .setLabel('Reacted')
      .setStyle(ButtonStyle.Secondary)

    /*const reportBtn = new ButtonBuilder()
      .setCustomId(`vrcban_report://${userKey}`)
      .setLabel('Report to VRChat')
      .setStyle(ButtonStyle.Secondary)*/

    const row = new ActionRowBuilder().addComponents(
      banbutton,
      tagBtn,
      reactedBtn
    )

    if (!channel)
      return console.error('LoggerTextChannel is invalid or missing')

    let message

    if (channel.type === 0) {
      const thread = await channel.threads.create({
        name: `${event.actorDisplayName} Event`,
        autoArchiveDuration: 60
      })
      message = await thread.send({ embeds: [embed], components: [row] })
    } else if (channel.type === 15) {
      // Forum channel -> create a forum thread with a starter message
      const thread = await channel.threads.create({
        name: `${event.actorDisplayName} Event`,
        message: { embeds: [embed], components: [row] }
        // appliedTags: defaultTagIds, // optional if you use forum tags
      })
      message = await thread.fetchStarterMessage().catch(() => null)
    } else {
      message = await channel.send({ embeds: [embed], components: [row] })
    }

    await logUserEvent(event, UserEvents)
  }

  async function postEventEmbed (
    event,
    UserEvents,
    action,
    buttonStyle,
    LoggerTextChannel,
    groupCtx
  ) {
    const activeGroup = groupCtx || getGroup(cfg) || {}
    const channelId = String(LoggerTextChannel || '').trim()
    if (!channelId) {
      return
    }

    let channel = client.channels.cache.get(channelId)
    if (!channel) {
      channel = await client.channels.fetch(channelId).catch(() => null)
    }
    if (!channel) {
      console.warn(
        `Skipping event ${event?.id || 'unknown'} (${event?.eventType || 'unknown'}) for group ${activeGroup.groupid || 'unknown'}: channel ${channelId} not found.`
      )
      return
    }

    const targetId =
      normalizeUserId(event.targetId) || normalizeUserId(event.actorId)
    if (!targetId) return

    const userdata = await api.GetUsersAPI(targetId)
    const dangerColor = parseInt(cfg.embedcfg?.colors?.Danger ?? 'ff0000', 16)
    const successColor = parseInt(cfg.embedcfg?.colors?.Success ?? '00ff00', 16)

    const iconURL =
      client.guilds.cache
        .get(client.config.TestingServerID)
        ?.iconURL({ size: 1024, extension: 'png' }) ??
      'https://i.imgur.com/AfFp7pu.png' // fallback if no icon / not cached

    switch (event.eventType) {
      case 'group.instance.close':
      case 'group.instance.create': {
        const gw = await api.GetGroupWorldLog(event.targetId)
        const embed = new EmbedBuilder()
          .setAuthor({
            name: activeGroup.groupName || 'VRChat Group',
            iconURL: iconURL,
            url: `https://vrchat.com/home/group/${activeGroup.groupid || ''}`
          })
          .setColor(
            event.eventType === 'group.instance.close'
              ? dangerColor
              : successColor
          )
          .setTitle(`${event.actorDisplayName}`)
          .setImage(gw?.data?.world?.imageUrl || null)
          .setThumbnail(`${userdata.data.currentAvatarImageUrl}`)
          .setURL(userProfileUrl(targetId))
          .setFields([
            { name: 'Event AuditId:', value: `${event.id}`, inline: false },
            { name: 'Event Type:', value: `${event.eventType}`, inline: false },
            { name: 'VRC UserId:', value: `${event.actorId}`, inline: false },
            {
              name: 'Group World Id:',
              value: `${event.targetId}`,
              inline: false
            },
            {
              name: 'Group World Name:',
              value: `${gw?.data?.world?.name || 'Unknown'}`,
              inline: false
            },
            {
              name: 'Date Joined:',
              value: `${userdata.data.date_joined}`,
              inline: false
            }
          ])
          .setTimestamp(new Date(event.created_at))
          .setFooter({
            text: `BanLogger v${
              client.botsettings?.botversion || 'unknown'
            } || Made By ${client.botsettings?.Creator || 'unknown'}`,
            iconURL:
              client?.user?.displayAvatarURL?.({ size: 128 }) ||
              'https://i.imgur.com/AfFp7pu.png'
          })

        let message
        if (channel.type === 0) {
          const thread = await channel.threads.create({
            name: `${event.actorDisplayName} Event`,
            autoArchiveDuration: 60
          })
          message = await thread.send({ embeds: [embed] })
        } else if (channel.type === 15) {
          // Forum channel -> create a forum thread with a starter message
          const thread = await channel.threads.create({
            name: `${event.actorDisplayName} Event`,
            message: { embeds: [embed] }
            // appliedTags: defaultTagIds, // optional if you use forum tags
          })
          message = await thread.fetchStarterMessage().catch(() => null)
        } else {
          message = await channel.send({ embeds: [embed] })
        }
        await logUserEvent(event, UserEvents)
        break
      }

      case 'group.post.create':
      case 'group.post.delete': {
        const imageId = event.data?.imageId
        const imageUrl = imageId
          ? `https://api.vrchat.cloud/api/1/file/${imageId}/1/file`
          : null
        const postTitle = event.data?.title || 'Untitled Post'
        const postText = event.data?.text || 'No content provided.'
        const visibility = event.data?.visibility || 'Unknown'

        const embed = new EmbedBuilder()
          .setAuthor({
            name: activeGroup.groupName || 'VRChat Group',
            iconURL: iconURL,
            url: `https://vrchat.com/home/group/${activeGroup.groupid || ''}`
          })
          .setColor(dangerColor)
          .setTitle(
            `${
              event.eventType === 'group.post.create' ? '📢' : '🗑️'
            } ${postTitle}`
          )
          .setDescription(postText)
          .setURL(userProfileUrl(normalizeUserId(event.actorId)))
          .addFields([
            { name: 'Event AuditId:', value: String(event.id), inline: false },
            { name: 'Event Type:', value: event.eventType, inline: false },
            {
              name: 'VRC UserId:',
              value: String(event.actorId),
              inline: false
            },
            {
              name: 'Post Visibility:',
              value: String(visibility),
              inline: false
            },
            { name: 'Date:', value: String(event.created_at), inline: false }
          ])
          .setTimestamp(new Date(event.created_at))
          .setFooter({
            text: `BanLogger v${
              client.botsettings?.botversion || 'unknown'
            } || Made By ${client.botsettings?.Creator || 'unknown'}`,
            iconURL:
              client?.user?.displayAvatarURL?.({ size: 128 }) ||
              'https://i.imgur.com/AfFp7pu.png'
          })

        if (imageUrl) embed.setImage(imageUrl)

        let message
        if (channel.type === 0) {
          const thread = await channel.threads.create({
            name: `${
              event.eventType === 'group.post.create'
                ? 'Announcement Created'
                : 'Announcement Deleted'
            } Event`,
            autoArchiveDuration: 60
          })
          message = await thread.send({ embeds: [embed] })
        } else if (channel.type === 15) {
          // Forum channel -> create a forum thread with a starter message
          const thread = await channel.threads.create({
            name: `${
              event.eventType === 'group.post.create'
                ? 'Announcement Created'
                : 'Announcement Deleted'
            } Event`,
            message: { embeds: [embed] }
            // appliedTags: defaultTagIds, // optional if you use forum tags
          })
          message = await thread.fetchStarterMessage().catch(() => null)
        } else {
          message = await channel.send({ embeds: [embed] })
        }

        await logUserEvent(event, UserEvents)
        break
      }

      case 'group.member.leave':
      case 'group.member.remove':
      case 'group.member.join': {
        // Reuse the larger renderer for groups fields/buttons
        const iconURL =
          client.guilds.cache
            .get(client.config.TestingServerID)
            ?.iconURL({ size: 1024, extension: 'png' }) ??
          'https://i.imgur.com/AfFp7pu.png' // fallback if no icon / not cached

        const embed = new EmbedBuilder()
          .setAuthor({
            name: activeGroup.groupName || 'VRChat Group',
            iconURL: iconURL,
            url: `https://vrchat.com/home/group/${activeGroup.groupid || ''}`
          })
          .setColor(
            event.eventType === 'group.member.leave'
              ? dangerColor
              : successColor
          )
          .setTitle(`${userdata.data.displayName}`)
          .setImage(`${userdata.data.currentAvatarImageUrl}`)
          .setURL(userProfileUrl(targetId))
          .setFields([
            { name: 'Event AuditId:', value: `${event.id}`, inline: false },
            { name: 'Event Type:', value: `${event.eventType}`, inline: false },
            {
              name: 'VRC UserId:',
              value: `${userdata.data.id}`,
              inline: false
            },
            {
              name: 'User Status:',
              value: userdata.data.statusDescription || 'N/A',
              inline: false
            },
            {
              name: 'User Bio:',
              value: userdata.data.bio || 'N/A',
              inline: false
            },
            {
              name: 'Date Joined:',
              value: `${userdata.data.date_joined}`,
              inline: false
            }
          ])
          .setTimestamp(new Date(event.created_at))
          .setFooter({
            text: `BanLogger v${
              client.botsettings?.botversion || 'unknown'
            } || Made By ${client.botsettings?.Creator || 'unknown'}`,
            iconURL:
              client?.user?.displayAvatarURL?.({ size: 128 }) ||
              'https://i.imgur.com/AfFp7pu.png'
          })

        let message
        if (channel.type === 0) {
          const thread = await channel.threads.create({
            name: `${event.actorDisplayName} Event`,
            autoArchiveDuration: 60
          })
          message = await thread.send({ embeds: [embed] })
        } else if (channel.type === 15) {
          // Forum channel -> create a forum thread with a starter message
          const thread = await channel.threads.create({
            name: `${event.actorDisplayName} Event`,
            message: { embeds: [embed] }
            // appliedTags: defaultTagIds, // optional if you use forum tags
          })
          message = await thread.fetchStarterMessage().catch(() => null)
        } else {
          message = await channel.send({ embeds: [embed] })
        }
        await logUserEvent(event, UserEvents)
        break
      }

      case 'group.request.create':
      case 'group.request.reject': {
        if (activeGroup.reqnotify?.enable === true) {
          // Reuse the larger renderer for groups fields/buttons
          const iconURL =
            client.guilds.cache
              .get(client.config.TestingServerID)
              ?.iconURL({ size: 1024, extension: 'png' }) ??
            'https://i.imgur.com/AfFp7pu.png' // fallback if no icon / not cached

          const responsemsg =
            event.eventType === 'group.request.reject'
              ? 'been Rejected to Join!'
              : 'been Requested to Join'

          const blacklistGroupsResult = await api.GetBannedUsersGroups(
            targetId
          )

          const acceptBtn = new ButtonBuilder()
            .setCustomId(
              encodeTarget('acceptreq', targetId)
            )
            .setLabel('Accept Request Join')
            .setStyle(ButtonStyle.Secondary)

          const rejectBtn = new ButtonBuilder()
            .setCustomId(
              encodeTarget('rejectreq', targetId)
            )
            .setLabel('Reject Request')
            .setStyle(ButtonStyle.Secondary)

          const row = new ActionRowBuilder().addComponents(acceptBtn, rejectBtn)

          // Member groups fields
          const groupFields = []
          const groupNames = Array.isArray(
            blacklistGroupsResult.userGroupsResult?.data
          )
            ? blacklistGroupsResult.userGroupsResult.data.map(g => g.name)
            : []
          let buf = ''
          for (const name of groupNames) {
            if ((buf + name + '\n').length > 1024) {
              groupFields.push({
                name: groupFields.length ? 'Continued:' : 'Member of Groups:',
                value: buf.trim(),
                inline: false
              })
              buf = ''
            }
            buf += `${name}\n`
          }
          if (buf)
            groupFields.push({
              name: groupFields.length ? 'Continued:' : 'Member of Groups:',
              value: buf.trim(),
              inline: false
            })
          if (groupFields.length === 0)
            groupFields.push({
              name: 'Member of Groups:',
              value: 'None',
              inline: false
            })

          // Blacklisted groups fields
          const blFields = []
          if (
            blacklistGroupsResult.found &&
            Array.isArray(blacklistGroupsResult.data)
          ) {
            const blNames = blacklistGroupsResult.data.map(g => g.name)
            let bbuf = ''
            for (const name of blNames) {
              if ((bbuf + name + '\n').length > 1024) {
                blFields.push({
                  name: blFields.length ? 'Continued:' : 'Blacklisted Groups:',
                  value: bbuf.trim(),
                  inline: false
                })
                bbuf = ''
              }
              bbuf += `${name}\n`
            }
            if (bbuf)
              blFields.push({
                name: blFields.length ? 'Continued:' : 'Blacklisted Groups:',
                value: bbuf.trim(),
                inline: false
              })
          } else {
            blFields.push({
              name: 'Blacklisted Groups:',
              value: 'None',
              inline: false
            })
          }

          const embed = new EmbedBuilder()
            .setAuthor({
              name: activeGroup.groupName || 'VRChat Group',
              iconURL: iconURL,
              url: `https://vrchat.com/home/group/${activeGroup.groupid || ''}`
            })
            .setColor(
              event.eventType === 'group.request.reject'
                ? dangerColor
                : successColor
            )
            .setTitle(`${userdata.data.displayName}`)
            .setImage(`${userdata.data.currentAvatarImageUrl}`)
            .setURL(userProfileUrl(targetId))
            .setDescription(`${userdata.data.displayName} has ${responsemsg}`)
            .setFields([
              { name: 'Event AuditId:', value: `${event.id}`, inline: false },
              {
                name: 'Event Type:',
                value: `${event.eventType}`,
                inline: false
              },
              {
                name: 'VRC UserId:',
                value: `${userdata.data.id}`,
                inline: false
              },
              {
                name: 'User Status:',
                value: userdata.data.statusDescription || 'N/A',
                inline: false
              },
              ...groupFields,
              ...blFields,
              {
                name: 'User Bio:',
                value: userdata.data.bio || 'N/A',
                inline: false
              },
              {
                name: 'Date Joined:',
                value: `${userdata.data.date_joined}`,
                inline: false
              }
            ])
            .setTimestamp(new Date(event.created_at))
            .setFooter({
              text: `BanLogger v${
                client.botsettings?.botversion || 'unknown'
              } || Made By ${client.botsettings?.Creator || 'unknown'}`,
              iconURL:
                client?.user?.displayAvatarURL?.({ size: 128 }) ||
                'https://i.imgur.com/AfFp7pu.png'
            })

          let message, thread
          if (channel.type === 0) {
            const thread = await channel.threads.create({
              name: `${event.actorDisplayName} Event`,
              autoArchiveDuration: 60
            })
            if (event.eventType === 'group.request.create') {
              message = await thread.send({
                embeds: [embed],
                components: [row]
              })
            } else {
              message = await thread.send({ embeds: [embed] })
            }
          } else if (channel.type === 15) {
            // Forum channel -> create a forum thread with a starter message
            if (event.eventType === 'group.request.create') {
              thread = await channel.threads.create({
                name: `${event.actorDisplayName} Event`,
                message: { embeds: [embed], components: [row] }
              })
            } else {
              thread = await channel.threads.create({
                name: `${event.actorDisplayName} Event`,
                message: { embeds: [embed] }
              })
            }
            message = await thread.fetchStarterMessage().catch(() => null)
          } else {
            if (event.eventType === 'group.request.create') {
              message = await channel.send({
                embeds: [embed],
                components: [row]
              })
            } else {
              message = await channel.send({ embeds: [embed] })
            }
          }
          await logUserEvent(event, UserEvents)
          break
        }
        break
      }

      case 'group.user.unban':
      case 'group.user.ban':
      case 'group.instance.warn':
      case 'group.instance.kick': {
        await BigLogger(
          event,
          UserEvents,
          action,
          buttonStyle,
          channel,
          activeGroup,
          targetId,
          userdata
        )
        break
      }

      default:
        console.log('Unhandled event type:', event.eventType)
        break
    }
  }

  async function checkForUpdates () {
    const group = getGroup(cfg)
    if (!group) return
    try {
      {
        const localGroupEvents = GroupEvents
        const localGroupUserEvent = GroupUserEvent
        if (!localGroupEvents || !localGroupUserEvent) return

        const res = await api.GetGroupAuditLog(group.groupid, group.groupName)
        if (!res?.data?.results?.length) return

        for (const event of res.data.results.slice(0, 100)) {
          const scopedEventId = `${group.groupid}:${event.id}`
          const exists = await localGroupEvents.findOne({
            where: { eventId: scopedEventId }
          })
          if (exists) continue

          const normalizedTargetUserId =
            normalizeUserId(event.targetId) || normalizeUserId(event.actorId)
          const targetId11 =
            normalizedTargetUserId ||
            (String(event.targetId || '').startsWith('wrld_')
              ? event.targetId
              : event.actorId ?? null)

          await localGroupEvents.create({
            eventId: scopedEventId,
            eventType: event.eventType,
            description: event.description,
            targetId: targetId11,
            json: event
          })

          if (['group.member.join'].includes(event.eventType)) {
            await postEventEmbed(
              event,
              localGroupUserEvent,
              'unban',
              ButtonStyle.Success,
              group.LoggerTextChannel?.JOINMEMBER,
              group
            )
          } else if (['group.member.leave'].includes(event.eventType)) {
            await postEventEmbed(
              event,
              localGroupUserEvent,
              'unban',
              ButtonStyle.Success,
              group.LoggerTextChannel?.LEAVEMEMBER,
              group
            )
          } else if (['group.member.remove'].includes(event.eventType)) {
            await postEventEmbed(
              event,
              localGroupUserEvent,
              'unban',
              ButtonStyle.Success,
              group.LoggerTextChannel?.REMOVEMEMBER,
              group
            )
          } else if (['group.user.unban'].includes(event.eventType)) {
            await postEventEmbed(
              event,
              localGroupUserEvent,
              'unban',
              ButtonStyle.Success,
              group.LoggerTextChannel?.UNBANMEMBER,
              group
            )
          } else if (['group.instance.kick'].includes(event.eventType)) {
            await postEventEmbed(
              event,
              localGroupUserEvent,
              'unban',
              ButtonStyle.Success,
              group.LoggerTextChannel?.KICKMEMBER,
              group
            )
          } else if (['group.instance.warn'].includes(event.eventType)) {
            await postEventEmbed(
              event,
              localGroupUserEvent,
              'unban',
              ButtonStyle.Success,
              group.LoggerTextChannel?.WARNMEMBER,
              group
            )
          } else if (['group.instance.create'].includes(event.eventType)) {
            await postEventEmbed(
              event,
              localGroupUserEvent,
              'unban',
              ButtonStyle.Success,
              group.LoggerTextChannel?.WORLDCREATEMEMBER,
              group
            )
          } else if (['group.instance.close'].includes(event.eventType)) {
            await postEventEmbed(
              event,
              localGroupUserEvent,
              'unban',
              ButtonStyle.Success,
              group.LoggerTextChannel?.WORLDCLOSEMEMBER,
              group
            )
          } else if (['group.user.ban'].includes(event.eventType)) {
            await postEventEmbed(
              event,
              localGroupUserEvent,
              'ban',
              ButtonStyle.Danger,
              group.LoggerTextChannel?.BANMEMBER,
              group
            )
          } else if (
            ['group.post.create', 'group.post.delete'].includes(event.eventType)
          ) {
            await postEventEmbed(
              event,
              localGroupUserEvent,
              'ban',
              ButtonStyle.Danger,
              group.LoggerTextChannel?.ANNOUNCEMENT,
              group
            )
          } else if (
            ['group.request.create', 'group.request.reject'].includes(
              event.eventType
            )
          ) {
            await postEventEmbed(
              event,
              localGroupUserEvent,
              'req',
              ButtonStyle.Danger,
              group.reqnotify?.REQCHANNEL,
              group
            )
          }

          const analyticsAction = mapEventTypeToAction(event.eventType)
          const analyticsUserId = extractEventUserId(event)
          if (
            analyticsAction &&
            analyticsUserId &&
            canAutoShareAnalytics(group)
          ) {
            await trackGlobalAnalytics({
              vrcUserId: analyticsUserId,
              action: analyticsAction,
              group,
              guildId: profileGuildId,
              guildName:
                client.guilds.cache.get(profileGuildId)?.name ||
                profileGuildId ||
                'Unknown Guild',
              sharedByDiscordId: 'system',
              sharedByDiscordTag: 'AutoShare',
              mode: 'auto'
            })
          }
        }
      }
    } catch (err) {
      console.error('Error fetching audit logs:', err)
    }
  }

  // Run setup and start checking for updates (every 30s)
  setInterval(checkForUpdates, 60000)

  // Button interactions (ban/unban)
  client.on('interactionCreate', async interaction => {
    if (!isInteractionForProfile(interaction)) return
    if (!interaction.isButton()) return

    try {
      if (interaction.customId.startsWith('acceptreq://')) {
        const { group, userId: user } = decodeTarget(
          interaction.customId,
          'acceptreq'
        )
        if (!(await hasAccess(interaction.user.id, 'requester', group))) {
          return await interaction.reply({
            content: `You do not have access to this command.`,
            ephemeral: false
          })
        }
        if (!group?.groupid) {
          return interaction.reply({
            content: 'Group context missing for this action.',
            ephemeral: true
          })
        }
        const data = await api.RespondGroupJoinRequest(
          group.groupid,
          user,
          `accept`,
          group.groupName || group.groupid
        )
        await interaction.reply({
          content: `User has been Accepted.`,
          ephemeral: false
        })
      } else if (interaction.customId.startsWith('rejectreq://')) {
        const { group, userId: user } = decodeTarget(
          interaction.customId,
          'rejectreq'
        )
        if (!(await hasAccess(interaction.user.id, 'requester', group))) {
          return await interaction.reply({
            content: `You do not have access to this command.`,
            ephemeral: false
          })
        }
        if (!group?.groupid) {
          return interaction.reply({
            content: 'Group context missing for this action.',
            ephemeral: true
          })
        }
        const data = await api.RespondGroupJoinRequest(
          group.groupid,
          user,
          `reject`,
          group.groupName || group.groupid
        )
        await interaction.reply({
          content: `User has been Rejected.`,
          ephemeral: false
        })
      } else if (interaction.customId.startsWith('ban://')) {
        const { group, userId: user } = decodeTarget(interaction.customId, 'ban')
        if (!(await hasAccess(interaction.user.id, 'ban', group))) {
          return await interaction.reply({
            content: `You do not have access to this command.`,
            ephemeral: false
          })
        }
        if (!group?.groupid) {
          return interaction.reply({
            content: 'Group context missing for this action.',
            ephemeral: true
          })
        }
        const data = await api.BanGroupUser(
          group.groupid,
          user,
          group.groupName || group.groupid
        )
        await interaction.reply({
          content: `User has been banned.`,
          ephemeral: false
        })
      } else if (interaction.customId.startsWith('unban://')) {
        const { group, userId: user } = decodeTarget(
          interaction.customId,
          'unban'
        )
        if (!(await hasAccess(interaction.user.id, 'unban', group))) {
          return await interaction.reply({
            content: `You do not have access to this command.`,
            ephemeral: false
          })
        }
        if (!group?.groupid) {
          return interaction.reply({
            content: 'Group context missing for this action.',
            ephemeral: true
          })
        }
        const data = await api.UnbanGroupUser(
          group.groupid,
          user,
          group.groupName || group.groupid
        )
        await interaction.reply({
          content: `User has been unbanned.`,
          ephemeral: false
        })
      } else if (interaction.customId.startsWith('vrcban_report://')) {
        const bannedUserId = interaction.customId.replace(
          'vrcban_report://',
          ''
        )
        const model = await ensureBanReportCacheModel(db)
        const saved = model
          ? await model.findOne({ where: { moderatorId: interaction.user.id } })
          : banReportCache.get(bannedUserId) || {
              userId: bannedUserId,
              reason: 'No reason provided'
            }
        const reasonText =
          saved?.reason || 'No reason provided (please add details).'
        const reportGroup = getGroup(cfg)
        const report = buildModerationReport({
          subject: `Ban report for ${bannedUserId}`,
          description: `${reasonText}\n\nReported by: ${reportGroup?.groupName || 'Unknown'} Group`,
          category: cfg?.helpdesk?.defaultModerationCategory || 'Other',
          target: bannedUserId,
          accountId: bannedUserId,
          attachments: attachmentsFromInteraction(interaction)
        })

        return safeReplyEphemeral(interaction, {
          content: [
            `VRChat requires you to be signed in to file a report, so submit this yourself:`,
            report.url,
            '',
            `**Subject**\n\`\`\`\n${report.subject}\n\`\`\``,
            `**Description**\n\`\`\`\n${report.description.slice(0, 1500)}\n\`\`\``
          ].join('\n')
        })
      } else if (interaction.customId.startsWith('settags')) {
        if (!(await hasAccess(interaction.user.id, 'tags', getGroup(cfg)))) {
          return await interaction.reply({
            content: `You do not have access to this command.`,
            ephemeral: false
          })
        }
        const thread = interaction.channel?.isThread?.()
          ? interaction.channel
          : null
        if (!thread)
          return interaction.reply({
            content: 'Open this from the event thread.',
            ephemeral: true
          })

        const names = await getPickerNamesForChannel(thread) // forum names or file fallback
        if (!names.length)
          return interaction.reply({
            content: 'No tags available.',
            ephemeral: true
          })

        // Build options & map slug->display name for this user+thread
        const map = new Map()
        const options = names.slice(0, 25).map(n => {
          const slug = slugify(n)
          map.set(slug, n)
          return { label: n, value: slug }
        })

        const menu = new StringSelectMenuBuilder()
          .setCustomId('tagpick-dynamic')
          .setPlaceholder('Select one or more tags')
          .setMinValues(0)
          .setMaxValues(Math.min(25, options.length))
          .addOptions(options)

        const saveBtn = new ButtonBuilder()
          .setCustomId('savetags-dynamic')
          .setLabel('Save')
          .setStyle(ButtonStyle.Primary)
        const cancelBtn = new ButtonBuilder()
          .setCustomId('canceltags-dynamic')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)

        const key = `${interaction.user.id}:${thread.id}`
        pendingTagCtx.set(key, { choices: [], map })

        return interaction.reply({
          content: 'Pick tags for this thread:',
          components: [
            new ActionRowBuilder().addComponents(menu),
            new ActionRowBuilder().addComponents(saveBtn, cancelBtn)
          ],
          ephemeral: true
        })
      } else if (interaction.customId.startsWith('reacted://')) {
        const { group, userId } = decodeTarget(interaction.customId, 'reacted')
        if (!(await hasAccess(interaction.user.id, 'reacted', group))) {
          return await interaction.reply({
            content: `You do not have access to this command.`,
            ephemeral: false
          })
        }
        const localGroupUserEvent = GroupUserEvent
        if (!localGroupUserEvent) {
          return await interaction.reply({
            content: 'Local group store not available.',
            ephemeral: true
          })
        }
        try {
          // Reset counters for this user in group-scoped GroupUserEvent
          const row = await localGroupUserEvent.findOne({ where: { userId } })
          if (row) {
            row.bans = 0
            row.unbans = 0
            row.kicks = 0
            row.warnings = 0
            row.joins = 0
            row.leaves = 0
            await row.save()
          } else {
            // ensure record exists with zeros
            await localGroupUserEvent.create({
              userId,
              bans: 0,
              unbans: 0,
              kicks: 0,
              warnings: 0,
              joins: 0,
              leaves: 0
            })
          }

          await interaction.reply({
            content: `All stats for **${userId}** were reset to 0.`,
            ephemeral: true
          })
        } catch (e) {
          console.error(e)
          await interaction.reply({
            content: 'Failed to reset stats.',
            ephemeral: true
          })
        }
      }
    } catch (e) {
      console.error(e)
      if (!interaction.replied) {
        await interaction.reply({ content: 'Action failed.', ephemeral: true })
      }
    }
  })

  client.on('interactionCreate', async interaction => {
    if (!isInteractionForProfile(interaction)) return
    if (!interaction.isStringSelectMenu()) return
    try {
      if (interaction.customId !== 'tagpick-dynamic') return

      const thread = interaction.channel?.isThread?.()
        ? interaction.channel
        : null
      if (!thread) {
        return await safeReplyEphemeral(interaction, {
          content: 'Open this from the event thread.'
        })
      }

      const key = `${interaction.user.id}:${thread.id}`
      const ctx = pendingTagCtx.get(key)
      if (!ctx) {
        return await safeReplyEphemeral(interaction, {
          content: 'Picker expired. Open it again.'
        })
      }

      ctx.choices = interaction.values || []
      pendingTagCtx.set(key, ctx)
      await safeReplyEphemeral(interaction, {
        content: `Selected ${ctx.choices.length} tag(s).`
      })
    } catch (e) {
      if (e?.code !== 10062 && e?.code !== 40060) console.error(e)
    }
  })

  client.on('interactionCreate', async interaction => {
    if (!isInteractionForProfile(interaction)) return
    if (!interaction.isButton()) return
    if (
      !['savetags-dynamic', 'canceltags-dynamic'].includes(interaction.customId)
    )
      return

    try {
      const thread = interaction.channel?.isThread?.()
        ? interaction.channel
        : null
      if (!thread) {
        return await safeReplyEphemeral(interaction, {
          content: 'Open this from the event thread.'
        })
      }

      const key = `${interaction.user.id}:${thread.id}`
      const ctx = pendingTagCtx.get(key)
      pendingTagCtx.delete(key)

      if (interaction.customId === 'canceltags-dynamic') {
        return await safeReplyEphemeral(interaction, {
          content: 'Tag selection cancelled.'
        })
      }

      const selectedNames = (ctx?.choices || [])
        .map(slug => ctx.map.get(slug))
        .filter(Boolean)
      if (!selectedNames.length) {
        // empty selection means clear
        const res = await resolveForumOrPseudo(thread, [])
        if (res.mode === 'forum') {
          await thread.setAppliedTags([])
          return await safeReplyEphemeral(interaction, {
            content: 'Cleared all forum tags.'
          })
        } else {
          await applyPseudoTags(thread, [])
          return await safeReplyEphemeral(interaction, {
            content: 'Cleared pseudo-tags.'
          })
        }
      }

      // Apply: forum if possible, otherwise pseudo
      const res = await resolveForumOrPseudo(thread, selectedNames)
      if (res.mode === 'forum') {
        try {
          await thread.setAppliedTags(res.ids)
          return await safeReplyEphemeral(interaction, {
            content: `Applied ${res.ids.length} forum tag(s).`
          })
        } catch (e) {
          console.error(e)
          return await safeReplyEphemeral(interaction, {
            content: 'Failed to apply forum tags.'
          })
        }
      } else {
        await applyPseudoTags(thread, selectedNames)
        return await safeReplyEphemeral(interaction, {
          content: `Applied pseudo-tags: ${selectedNames.join(', ')}`
        })
      }
    } catch (e) {
      if (e?.code !== 10062 && e?.code !== 40060) console.error(e)
    }
  })

  // expose anything you still import elsewhere
  return { checkForUpdates }
}
