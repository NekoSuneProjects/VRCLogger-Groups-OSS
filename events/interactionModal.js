// events/interactionModal.js
const i18n = require('i18n')
i18n.setLocale('en')
const { Sequelize, DataTypes } = require('sequelize')
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js')
const { createVrchatApi } = require('../utils/vrchat.js')
const { getGroup } = require('../lib/vrcGroup')
const {
  buildModerationReport,
  attachmentsFromInteraction
} = require('../utils/vrchatHelpDesk')
const { normalizeVrcUserInput } = require('../utils/vrcUserId')

// Cache ban context per moderator so the follow-up report button can reuse the reason/user id
const banReportCache = new Map()

// Persist ban report context so we can reuse it after the modal flow
let BanReportCacheModel = null
async function ensureBanReportCacheModel (db) {
  if (BanReportCacheModel) return BanReportCacheModel
  const sequelize = db?.sequelize
  if (!sequelize) return null
  BanReportCacheModel = sequelize.define('BanReportCache', {
    moderatorId: { type: DataTypes.STRING, primaryKey: true },
    bannedUserId: { type: DataTypes.STRING },
    reason: { type: DataTypes.TEXT }
  }, { tableName: 'BanReportCache', timestamps: false })
  await BanReportCacheModel.sync()
  db.BanReportCache = BanReportCacheModel
  return BanReportCacheModel
}

module.exports = (client, runtimeState = {}) => {
  const config = client.config || {}
  const profileGuildId = String(config?.TestingServerID || '')
  const api = createVrchatApi(config)
  async function safeReplyEphemeral (interaction, payload) {
    try {
      if (interaction.deferred || interaction.replied) {
        return await interaction.followUp({ ...payload, ephemeral: true })
      }
      return await interaction.reply({ ...payload, ephemeral: true })
    } catch (err) {
      if (err?.code === 10062 || err?.code === 40060) return null
      throw err
    }
  }
  const resolveModalGroup = () => getGroup(config)

  const {
    GroupEvents,
    GroupUserEvent,
    VRCBlacklist,
    VRCAVIBlacklist,
    ApiKey,
    VRCBLQueue,
    VRCStaffList,
    VRCBlacklistGroups
  } = runtimeState.db || {}

  if (!VRCBLQueue || !VRCStaffList) {
    return
  }

  // expose helpers to other modules via client.state if you need
  client.state.models = {
    GroupEvents,
    GroupUserEvent,
    VRCBlacklist,
    VRCAVIBlacklist,
    ApiKey,
    VRCBLQueue,
    VRCStaffList,
    VRCBlacklistGroups
  }

  // Modal state has to survive separate Discord interactions:
  // modal submit -> select menu -> confirm button.
  const cache = {
    modal: {},
    tags: {}
  }
  const aviCache = {
    modal: {},
    tags: {}
  }
  function clearBlacklistModal (userId) {
    delete cache.modal[userId]
    delete cache.tags[userId]
  }
  function clearAvatarBlacklistModal (userId) {
    delete aviCache.modal[userId]
    delete aviCache.tags[userId]
  }

  // ——— Helpers ———
  async function getActiveStaffIds () {
    const activeStaff = await VRCStaffList.findAll({
      attributes: ['userId'],
      where: { active: true }
    })
    return activeStaff.map(s => s.userId)
  }

  async function getUserRole (userId) {
    const user = await VRCStaffList.findOne({
      where: { userId, active: true },
      attributes: ['role']
    })

    return user ? user.role : null
  }

  async function hasAccess (userId, actionName) {
    const defaultGroup = getGroup(config)
    const allowedRoles =
      defaultGroup?.ACCESS?.[actionName] ||
      config?.VRCAPI?.ACCESS?.[actionName]
    if (!allowedRoles) return false // action not defined

    const userRole = await getUserRole(userId)
    if (!userRole) return false // user not found

    return allowedRoles.includes(userRole.toLowerCase())
  }

  async function hasAccessForGroup (userId, actionName, group) {
    const allowedRoles =
      group?.ACCESS?.[actionName] || config?.VRCAPI?.ACCESS?.[actionName]
    if (!allowedRoles) return false
    const userRole = await getUserRole(userId)
    if (!userRole) return false
    return allowedRoles.includes(userRole.toLowerCase())
  }

  const BLACKLIST_ADMIN_ROLES = ['owner', 'co-owner', 'admin']
  const USER_BLACKLIST_ROLES = [
    ...BLACKLIST_ADMIN_ROLES,
    'mod',
    'trainee',
    'it-tech'
  ]

  async function getNormalizedStaffRole (userId) {
    return String(await getUserRole(userId) || '').trim().toLowerCase()
  }

  function isBlacklistAdminRole (role) {
    return BLACKLIST_ADMIN_ROLES.includes(String(role || '').toLowerCase())
  }

  function ownsBlacklistRow (row, userId) {
    const id = String(userId || '')
    return [row?.createdBy, row?.updatedBy, row?.moderator, row?.archivedBy]
      .some(value => String(value || '') === id)
  }

  function addToQueue (groupId, groupName, userId, actions) {
    return VRCBLQueue.create({ groupId, groupName, userId, actions }).catch(
      console.error
    )
  }

  function VRCBanGroupUserWrap (groupId, userId, groupName) {
    return new Promise(resolve => {
      setTimeout(() => {
        api.BanGroupUser(groupId, userId, groupName).then(data => {
          console.log(data)
          resolve(`User ${userId} banned from group ${groupId}`)
        })
      }, 1000)
    })
  }

  function VRCUnBanGroupUserWrap (groupId, userId, groupName) {
    return new Promise(resolve => {
      setTimeout(() => {
        api.UnbanGroupUser(groupId, userId, groupName).then(data => {
          console.log(data)
          resolve(`User ${userId} unbanned from group ${groupId}`)
        })
      }, 1000)
    })
  }

  function executeNext () {
    VRCBLQueue.findOne().then(item => {
      if (!item) return
      const fn =
        item.actions === 'ban' ? VRCBanGroupUserWrap : VRCUnBanGroupUserWrap
      fn(item.groupId, item.userId, item.groupName)
        .then(() => item.destroy())
        .catch(console.error)
    })
  }

  setInterval(executeNext, 10000)

  // ——— Modal submit handlers (unchanged logic, just using closures) ———
  client.on('interactionCreate', async interaction => {
    if (
      profileGuildId &&
      String(interaction.guildId || '') !== profileGuildId
    ) {
      return
    }

    // Only process modals, menus, and buttons here
    if (
      !(
        interaction.isModalSubmit() ||
        interaction.isStringSelectMenu() ||
        interaction.isButton()
      )
    )
      return

    // =========================
    // MODAL SUBMITTED
    // =========================
    if (
      interaction.isModalSubmit() &&
      interaction.customId === 'vrcuserblacklist'
    ) {
      try {
        const user = interaction.user.id
        const role = await getNormalizedStaffRole(user)
        if (!USER_BLACKLIST_ROLES.includes(role)) {
          return interaction.reply({
            content: 'You do not have access to this command.',
            ephemeral: true
          })
        }

        const toggle = interaction.fields
          .getTextInputValue('togglesdel')
          .trim()
          .toLowerCase()
        const userID = normalizeVrcUserInput(
          interaction.fields.getTextInputValue('userid').trim()
        )
        if (!userID) {
          return interaction.reply({
            content:
              'Invalid VRChat user input. Use `usr_...`, custom user id, or a VRChat profile URL.',
            ephemeral: true
          })
        }
        const displayName =
          interaction.fields.getTextInputValue('displayname')?.trim() || null
        const reason =
          interaction.fields.getTextInputValue('reason')?.trim() || null

        // Save into memory cache
        cache.modal[user] = { toggle, userID, displayName, reason }

        // Build tag dropdown
        const tagMenu = new StringSelectMenuBuilder()
          .setCustomId('vrcbl_tags')
          .setPlaceholder('Select blacklist tags...')
          .setMinValues(0)
          .setMaxValues(6)
          .addOptions([
            { label: 'Clients', value: 'CLIENTS' },
            { label: 'Troll', value: 'TROLL' },
            { label: 'Ripper', value: 'RIPPER' },
            { label: 'Crasher', value: 'CRASHER' },
            { label: 'Underage', value: 'UNDERAGE' },
            { label: 'Racism', value: 'RACISM' },
            { label: 'Community', value: 'COMMUNITY' },
            { label: 'Affiliated', value: 'AFFILIATED' },
            { label: 'BOS', value: 'BOS' },
            { label: 'Nuisance', value: 'NUISANCE' },
            { label: 'Watchlist', value: 'WATCHLIST' },
            { label: 'Unknown', value: 'UNKNOWN' }
          ])

        const confirmBtn = new ButtonBuilder()
          .setCustomId('vrcbl_confirm')
          .setLabel('Save Blacklist Entry')
          .setStyle(ButtonStyle.Success)

        const cancelBtn = new ButtonBuilder()
          .setCustomId('vrcbl_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Danger)

        return interaction.reply({
          content: `Select blacklist tags for **${displayName || userID}**:`,
          components: [
            new ActionRowBuilder().addComponents(tagMenu),
            new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)
          ],
          ephemeral: true
        })
      } catch (err) {
        console.error('Modal Error:', err)
        return interaction.reply({
          content: '❌ Error occurred.',
          ephemeral: true
        })
      }
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId === 'vrcaviblacklist'
    ) {
      const role = await getNormalizedStaffRole(interaction.user.id)
      if (!isBlacklistAdminRole(role)) {
        return interaction.reply({
          content: 'You do not have access to this command.',
          ephemeral: true
        })
      }

      const toggle = interaction.fields
        .getTextInputValue('togglesdel')
        .trim()
        .toLowerCase()
      const avatarId = interaction.fields.getTextInputValue('avatarid').trim()
      const userId = normalizeVrcUserInput(
        interaction.fields.getTextInputValue('userid').trim()
      )
      if (!userId) {
        return interaction.reply({
          content:
            'Invalid VRChat user input. Use `usr_...`, custom user id, or a VRChat profile URL.',
          ephemeral: true
        })
      }
      const reason =
        interaction.fields.getTextInputValue('reason')?.trim() || null

      aviCache.modal[interaction.user.id] = {
        toggle,
        avatarId,
        userId,
        reason
      }

      // TYPE SELECT for avatars
      const typeSelect = new StringSelectMenuBuilder()
        .setCustomId('vrcavi_type')
        .setPlaceholder('Select avatar blacklist type')
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('Ripper')
            .setValue('RIPPER'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Crasher')
            .setValue('CRASHER'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Underage')
            .setValue('UNDERAGE'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Racism')
            .setValue('RACISM'),
          new StringSelectMenuOptionBuilder()
            .setLabel('GangMonkey')
            .setValue('GANGMONKEY'),
          new StringSelectMenuOptionBuilder().setLabel('BOS').setValue('BOS'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Nuisance')
            .setValue('NUISANCE'),
          new StringSelectMenuOptionBuilder()
            .setLabel('WatchList')
            .setValue('WATCHLIST'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Unknown')
            .setValue('UNKNOWN')
        )

      // TAG SELECT
      const tagLabels = [
        'Ripper',
        'Crasher',
        'Client Use',
        'Underage',
        'Troll',
        'Offensive',
        'Stolen Assets',
        'NSFW',
        'GangMonkey',
        'Anti-Fur',
        'Racism',
        'BOS',
        'Other'
      ]

      const tagOptions = tagLabels.map(label =>
        new StringSelectMenuOptionBuilder().setLabel(label).setValue(label)
      )

      const tagSelect = new StringSelectMenuBuilder()
        .setCustomId('vrcavi_tags')
        .setPlaceholder('Select tags')
        .setMinValues(0)
        .setMaxValues(6)
        .addOptions(tagOptions)

      const confirmBtn = new ButtonBuilder()
        .setCustomId('vrcavi_confirm')
        .setLabel('Save Avatar Blacklist')
        .setStyle(ButtonStyle.Success)

      const cancelBtn = new ButtonBuilder()
        .setCustomId('vrcavi_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)

      return interaction.reply({
        content: `Select avatar blacklist type + tags:`,
        components: [
          new ActionRowBuilder().addComponents(typeSelect),
          new ActionRowBuilder().addComponents(tagSelect),
          new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)
        ],
        ephemeral: true
      })
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith('vrcbanuser')
    ) {
      try {
        const targetGroup = resolveModalGroup()
        const allowed = await hasAccessForGroup(
          interaction.user.id,
          'ban',
          targetGroup
        )
        if (!allowed) {
          return interaction.reply({
            content: 'You do not have access to this command.',
            ephemeral: true
          })
        }
        if (!targetGroup?.groupid) {
          return interaction.reply({
            content: 'No VRChat group configured for this server.',
            ephemeral: true
          })
        }

        const rawUserId = interaction.fields.getTextInputValue('userid').trim()
        const userId = normalizeVrcUserInput(rawUserId)
        if (!userId) {
          return interaction.reply({
            content:
              'Invalid VRChat user input. Use `usr_...`, custom user id, or a VRChat profile URL.',
            ephemeral: true
          })
        }
        const reasonField = interaction.fields.fields?.get('reason')
        const banReason = reasonField?.value?.trim() || 'No reason provided'

        await addToQueue(
          targetGroup.groupid,
          targetGroup.groupName || targetGroup.groupid,
          userId,
          'ban'
        )

        try {
          const model = await ensureBanReportCacheModel(runtimeState.db)
          if (model) {
            await model.upsert({ moderatorId: interaction.user.id, bannedUserId: userId, reason: banReason })
          } else {
            banReportCache.set(interaction.user.id, { userId, reason: banReason })
          }
        } catch (err) {
          console.error('Failed to persist ban report cache', err)
        }

        return interaction.reply({
          content: `Queued ban for **${userId}**.`,
          ephemeral: true
        })
      } catch (err) {
        console.error('Modal Error:', err)
        return interaction.reply({
          content: 'Error occurred while queuing ban.',
          ephemeral: true
        })
      }
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith('vrcunbanuser')
    ) {
      try {
        const targetGroup = resolveModalGroup()
        const allowed = await hasAccessForGroup(
          interaction.user.id,
          'unban',
          targetGroup
        )
        if (!allowed) {
          return interaction.reply({
            content: 'You do not have access to this command.',
            ephemeral: true
          })
        }
        if (!targetGroup?.groupid) {
          return interaction.reply({
            content: 'No VRChat group configured for this server.',
            ephemeral: true
          })
        }

        const rawUserId = interaction.fields.getTextInputValue('userid').trim()
        const userId = normalizeVrcUserInput(rawUserId)
        if (!userId) {
          return interaction.reply({
            content:
              'Invalid VRChat user input. Use `usr_...`, custom user id, or a VRChat profile URL.',
            ephemeral: true
          })
        }

        await addToQueue(
          targetGroup.groupid,
          targetGroup.groupName || targetGroup.groupid,
          userId,
          'unban'
        )

        return interaction.reply({
          content: `Queued unban for **${userId}**.`,
          ephemeral: true
        })
      } catch (err) {
        console.error('Modal Error:', err)
        return interaction.reply({
          content: 'Error occurred while queuing unban.',
          ephemeral: true
        })
      }
    }

    // =========================
    // TAG SELECTION
    // =========================
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'vrcbl_tags') {
        if (!cache.modal[interaction.user.id]) {
          return safeReplyEphemeral(interaction, {
            content: 'User blacklist modal expired. Please run the command again.'
          })
        }
        cache.tags[interaction.user.id] = interaction.values
      }

      if (interaction.customId === 'vrcavi_type') {
        const modalData = aviCache.modal[interaction.user.id]
        if (!modalData) {
          return safeReplyEphemeral(interaction, {
            content: 'Avatar blacklist modal expired. Please run the command again.'
          })
        }
        modalData.type = interaction.values[0]
      }

      if (interaction.customId === 'vrcavi_tags') {
        if (!aviCache.modal[interaction.user.id]) {
          return safeReplyEphemeral(interaction, {
            content: 'Avatar blacklist modal expired. Please run the command again.'
          })
        }
        aviCache.tags[interaction.user.id] = interaction.values
      }

      return safeReplyEphemeral(interaction, {
        content: `Selected tags: **${interaction.values.join(', ')}**`
      })
    }

    // =========================
    // CANCEL / REPORT BUTTONS
    // =========================
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('vrcban_report://')) {
        const bannedUserId = interaction.customId.replace(
          'vrcban_report://',
          ''
        )
        const model = await ensureBanReportCacheModel(runtimeState.db)
        const saved = model ? await model.findOne({ where: { moderatorId: interaction.user.id } }) : (banReportCache.get(interaction.user.id) || {})
        const reasonText =
          saved.reason || 'No reason provided (please add details).'
        const report = buildModerationReport({
          subject: `Ban report for ${bannedUserId}`,
          description: `${reasonText}\n\nReported by: ${config.VRCAPI?.groupName || 'Unknown'} Group`,
          category: config.helpdesk?.defaultModerationCategory || 'Other',
          target: bannedUserId,
          accountId: bannedUserId,
          attachments: attachmentsFromInteraction(interaction)
        })

        return safeReplyEphemeral(interaction, {
          content: [
            'VRChat requires you to be signed in to file a report, so submit this yourself:',
            report.url,
            '',
            `**Subject**\n\`\`\`\n${report.subject}\n\`\`\``,
            `**Description**\n\`\`\`\n${report.description.slice(0, 1500)}\n\`\`\``
          ].join('\n')
        })
      }

      if (interaction.customId === 'vrcbl_cancel') {
        clearBlacklistModal(interaction.user.id)
        return interaction.reply({
          content: '??O Blacklist entry cancelled.',
          ephemeral: true
        })
      }

      if (interaction.customId === 'vrcavi_cancel') {
        clearAvatarBlacklistModal(interaction.user.id)
        return interaction.reply({
          content: '??O Blacklist entry cancelled.',
          ephemeral: true
        })
      }
    }

    // =========================
    // CONFIRM BUTTON — SAVE TO DATABASE
    // =========================
    if (interaction.isButton()) {
      if (interaction.customId === 'vrcbl_confirm') {
        const user = interaction.user.id
        const modalData = cache.modal[user]
        const tags = cache.tags[user] || []

        if (!modalData) {
          return interaction.reply({
            content: '❌ Missing modal data. Please try again.',
            ephemeral: true
          })
        }

        const { toggle, userID, displayName, reason } = modalData

        const VALID_TYPES = [
          'CLIENTS',
          'TROLL',
          'RIPPER',
          'CRASHER',
          'UNDERAGE',
          'RACISM',
          'COMMUNITY',
          'AFFILIATED',
          'BOS',
          'NUISANCE',
          'UNKNOWN',
          'WATCHLIST'
        ]

        const detectedType =
          tags.find(t => VALID_TYPES.includes(t)) || 'UNKNOWN'

        const role = await getNormalizedStaffRole(user)
        const canEditAnyBlacklist = isBlacklistAdminRole(role)
        let existing = await VRCBlacklist.findOne({ where: { userID } })

        // REMOVE
        if (toggle === 'remove') {
          if (!existing) {
            return interaction.reply({
              content: `User **${userID}** is not blacklisted.`,
              ephemeral: true
            })
          }

          if (!canEditAnyBlacklist && !ownsBlacklistRow(existing, user)) {
            return interaction.reply({
              content: 'You can only delete user blacklist rows you created.',
              ephemeral: true
            })
          }

          existing.blacklisted = false
          existing.archived = true
          existing.archivedAt = new Date()
          existing.archivedBy = user
          existing.updatedBy = user
          await existing.save()
          clearBlacklistModal(user)

          return interaction.reply({
            content: `🟩 Removed **${
              existing.displayName || userID
            }** from blacklist.`,
            ephemeral: true
          })
        }

        // ADD or UPDATE
        if (existing) {
          if (!canEditAnyBlacklist) {
            if (existing.blacklisted || !ownsBlacklistRow(existing, user)) {
              return interaction.reply({
                content: 'This user already has a blacklist row you cannot edit.',
                ephemeral: true
              })
            }
          }

          existing.displayName = displayName || existing.displayName
          existing.reason = reason || existing.reason
          existing.tags = tags
          existing.type = detectedType
          existing.moderator = interaction.user.id
          existing.blacklisted = true
          existing.archived = false
          existing.archivedAt = null
          existing.archivedBy = null
          existing.updatedBy = user
          existing.date = new Date()

          await existing.save()
          clearBlacklistModal(user)

          return interaction.reply({
            content: `🔄 Updated blacklist entry for **${
              existing.displayName || userID
            }**.\nTags: **${tags.join(', ')}**`,
            ephemeral: true
          })
        }

        // CREATE
        await VRCBlacklist.create({
          displayName,
          userID,
          reason,
          tags,
          type: detectedType,
          moderator: interaction.user.id,
          createdBy: user,
          updatedBy: user,
          blacklisted: true
        })
        clearBlacklistModal(user)

        return interaction.reply({
          content: `✅ Added **${
            displayName || userID
          }** to blacklist.\nTags: **${tags.join(', ')}**`,
          ephemeral: true
        })
      }

      if (interaction.customId === 'vrcavi_confirm') {
        const user = interaction.user.id
        const role = await getNormalizedStaffRole(user)
        if (!isBlacklistAdminRole(role)) {
          return interaction.reply({
            content: 'You do not have access to avatar blacklists.',
            ephemeral: true
          })
        }

        const data = aviCache.modal[user]
        const tags = aviCache.tags[user] || []

        if (!data) {
          return interaction.reply({
            content: '❌ Missing avatar blacklist data.',
            ephemeral: true
          })
        }

        const { toggle, avatarId, userId, reason, type } = data

        // Check existing entry
        const existing = await VRCAVIBlacklist.findOne({ where: { avatarId } })

        // REMOVE
        if (toggle === 'remove') {
          if (!existing) {
            return interaction.reply({
              content: `⚠️ Avatar \`${avatarId}\` is not in blacklist.`,
              ephemeral: true
            })
          }

          existing.blacklisted = false
          existing.archived = true
          existing.archivedAt = new Date()
          existing.archivedBy = user
          existing.updatedBy = user
          await existing.save()
          clearAvatarBlacklistModal(user)

          return interaction.reply({
            content: `🟩 Avatar \`${avatarId}\` removed from blacklist.`,
            ephemeral: true
          })
        }

        // ADD / UPDATE
        const typeValue = type || 'UNKNOWN'

        const entryPayload = {
          displayName: null,
          userId,
          avatarId,
          reason,
          type: typeValue,
          tags,
          moderator: interaction.user.id,
          createdBy: existing?.createdBy || user,
          updatedBy: user,
          blacklisted: true,
          archived: false,
          archivedAt: null,
          archivedBy: null,
          date: new Date()
        }

        if (existing) {
          await existing.update(entryPayload)
          clearAvatarBlacklistModal(user)

          return interaction.reply({
            content: `🔄 Updated avatar blacklist entry for \`${avatarId}\`.\nType: **${typeValue}**`,
            ephemeral: true
          })
        }

        await VRCAVIBlacklist.create(entryPayload)
        clearAvatarBlacklistModal(user)

        return interaction.reply({
          content: `✅ Added avatar \`${avatarId}\` to blacklist.\nType: **${typeValue}**`,
          ephemeral: true
        })
      }
    }
  })

  // Save callable helpers so commands can reach them via the module export or via client if you like
  runtimeState.fns = {
    getActiveStaffIds,
    addToQueue,
    getUserRole,
    hasAccess
  }
}
