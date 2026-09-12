const {
  EmbedBuilder,
  PermissionFlagsBits,
  ApplicationCommandType,
  ApplicationCommandOptionType
} = require("discord.js");

const { createVrchatApi } = require("../../utils/vrchat");
const { normalizeVrcUserInput } = require("../../utils/vrcUserId");

module.exports = {
  name: "vrccheck",
  description: "Lookup VRChat Account",
  type: ApplicationCommandType.ChatInput,
  toggleOff: false,
  developersOnly: true,
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
      name: "user",
      description: "VRChat user id or profile URL",
      type: ApplicationCommandOptionType.String,
      required: true
    }
  ],

  run: async (client, interaction) => {
    const input = interaction.options.getString("user");

    if (!(await client.state.fns.hasAccess(interaction.user.id, "userlookup"))) {
      return interaction.reply({
        content: "You do not have access to this command.",
        ephemeral: true
      });
    }

    const atuser = normalizeVrcUserInput(input);
    if (!atuser) {
      return interaction.reply({
        content:
          "Invalid input. Use a VRChat user id (`usr_...` or custom id) or a profile URL.",
        ephemeral: true
      });
    }

    const api = createVrchatApi(client.config || {});

    try {
      const json = await api.GetUsersAPI(atuser);
      if (json.status !== 200 || !json.data) {
        const embed = new EmbedBuilder()
          .setColor("#ff0000")
          .setTitle("Not Valid Account")
          .setDescription("Profile not found in backend response.");
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      const {
        displayName,
        id,
        pronouns,
        date_joined,
        ageVerified,
        currentAvatarThumbnailImageUrl,
        badges,
        bioLinks,
        tags
      } = json.data;

      const badgesList =
        badges && badges.length
          ? badges
              .map(
                b =>
                  `- **${b.badgeName}** (${b.showcased ? "Showcased" : "Hidden"})`
              )
              .join("\n")
          : "None";
      const bioLinksList =
        bioLinks && bioLinks.length ? bioLinks.join("\n") : "None";

      const hasVRCPlus = tags?.includes("system_supporter");

      const embed = new EmbedBuilder()
        .setColor("#00ffff")
        .setTitle("Found Profile")
        .setDescription("Matching profile found.")
        .setThumbnail(currentAvatarThumbnailImageUrl || null)
        .addFields(
          { name: "VRChat Name", value: displayName || "Unknown", inline: true },
          { name: "VRChat User ID", value: id || atuser, inline: false },
          { name: "Pronouns", value: pronouns || "Unknown", inline: true },
          { name: "Date Joined", value: date_joined || "Unknown", inline: true },
          {
            name: "Age Verification",
            value:
              typeof ageVerified === "boolean"
                ? ageVerified
                  ? "Verified"
                  : "Not Verified"
                : "Unknown",
            inline: true
          },
          { name: "VRC+", value: hasVRCPlus ? "Yes" : "No", inline: true },
          { name: "Badges", value: badgesList, inline: false },
          { name: "Bio Links", value: bioLinksList, inline: false }
        );

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    } catch (err) {
      console.error("VRChat API error:", err);
      return interaction.reply({
        content: "Something went wrong while fetching VRChat data.",
        ephemeral: true
      });
    }
  }
};

