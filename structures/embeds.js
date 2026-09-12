const client = require("../index");
const Discord = require("discord.js");

/**
 * Easy to send errors because im lazy to do the same things :p
 * @param {String} text - Message which is need to send
 * @param {TextChannel} channel - A Channel to send error
 */

function templateEmbed() {
  return new Discord.EmbedBuilder()
    .setAuthor({
      name: client.user.username,
      iconURL: client.user.avatarURL({ size: 1024 })
    })
    .setColor(client.config.colorthemecode)
    .setFooter({
      text: client.config.embedcfg.discord.footer,
      iconURL: client.user.avatarURL({ size: 1024 })
    })
    .setTimestamp();
}

//----------------------------------------------------------------//
//                        ERROR MESSAGES                          //
//----------------------------------------------------------------//

// Normal error
const errNormal = async function (
  {
    embed: embed = templateEmbed(),
    error: error,
    type: type,
    content: content,
    components: components
  },
  interaction
) {
  embed.setTitle(`${client.emotes.normal.error}・Error!`);
  embed.setDescription(`Something went wrong!`);
  embed.addFields({ name: "💬┆Error comment", value: `\`\`\`${error}\`\`\`` });
  embed.setColor(client.config.embedcfg.colors.error);

  return sendEmbed(
    {
      embeds: [embed],
      content: content,
      components: components,
      type: type
    },
    interaction
  );
};

// Missing args
const errUsage = async function (
  {
    embed: embed = templateEmbed(),
    usage: usage,
    type: type,
    content: content,
    components: components
  },
  interaction
) {
  embed.setTitle(`${client.emotes.normal.error}・Error!`);
  embed.setDescription(`You did not provide the correct arguments`);
  embed.addFields({
    name: "💬┆Required arguments",
    value: `\`\`\`${usage}\`\`\``
  });
  embed.setColor(client.config.embedcfg.colors.error);

  return sendEmbed(
    {
      embeds: [embed],
      content: content,
      components: components,
      type: type
    },
    interaction
  );
};

// Missing perms

const errMissingPerms = async function (
  {
    embed: embed = templateEmbed(),
    perms: perms,
    type: type,
    content: content,
    components: components
  },
  interaction
) {
  embed.setTitle(`${client.emotes.normal.error}・Error!`);
  embed.setDescription(`You don't have the right permissions`);
  embed.addFields({
    name: "🔑┆Required Permission",
    value: `\`\`\`${perms}\`\`\``
  });
  embed.setColor(client.config.embedcfg.colors.error);

  return sendEmbed(
    {
      embeds: [embed],
      content: content,
      components: components,
      type: type
    },
    interaction
  );
};

// No bot perms

const errNoPerms = async function (
  {
    embed: embed = templateEmbed(),
    perms: perms,
    type: type,
    content: content,
    components: components
  },
  interaction
) {
  embed.setTitle(`${client.emotes.normal.error}・Error!`);
  embed.setDescription(`I don't have the right permissions`);
  embed.addFields({
    name: "🔑┆Required Permission",
    value: `\`\`\`${perms}\`\`\``
  });
  embed.setColor(client.config.embedcfg.colors.error);

  return sendEmbed(
    {
      embeds: [embed],
      content: content,
      components: components,
      type: type
    },
    interaction
  );
};

// Wait error

const errWait = async function (
  {
    embed: embed = templateEmbed(),
    time: time,
    type: type,
    content: content,
    components: components
  },
  interaction
) {
  embed.setTitle(`${client.emotes.normal.error}・Error!`);
  embed.setDescription(`You've already done this once`);
  embed.addFields({ name: "⏰┆Try again on", value: `<t:${time}:f>` });
  embed.setColor(client.config.embedcfg.colors.error);

  return sendEmbed(
    {
      embeds: [embed],
      content: content,
      components: components,
      type: type
    },
    interaction
  );
};

//----------------------------------------------------------------//
//                        SUCCES MESSAGES                         //
//----------------------------------------------------------------//

// Normal succes
const succNormal = async function (
  {
    embed: embed = templateEmbed(),
    text: text,
    fields: fields,
    type: type,
    content: content,
    components: components
  },
  interaction
) {
  embed.setTitle(`${client.emotes.normal.check}・Success!`);
  embed.setDescription(`${text}`);
  embed.setColor(client.config.colorthemecode);

  if (fields) embed.addFields(fields);

  return sendEmbed(
    {
      embeds: [embed],
      content: content,
      components: components,
      type: type
    },
    interaction
  );
};

//----------------------------------------------------------------//
//                        BASIC MESSAGES                          //
//----------------------------------------------------------------//

// Default
const embed = async function (
  {
    embed: embed = templateEmbed(),
    title: title,
    desc: desc,
    color: color,
    image: image,
    author: author,
    url: url,
    footer: footer,
    thumbnail: thumbnail,
    fields: fields,
    content: content,
    components: components,
    type: type
  },
  interaction
) {
  if (interaction.guild == undefined) interaction.guild = { id: "0" };

  if (title) embed.setTitle(title);
  if (desc && desc.length >= 2048)
    embed.setDescription(desc.substr(0, 2044) + "...");
  else if (desc) embed.setDescription(desc);
  if (image) embed.setImage(image);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (fields) embed.addFields(fields);
  if (author) embed.setAuthor(author);
  if (url) embed.setURL(url);
  if (footer) embed.setFooter({ text: footer });
  if (color) embed.setColor(color);
  return sendEmbed(
    {
      embeds: [embed],
      content: content,
      components: components,
      type: type
    },
    interaction
  );
};

const simpleEmbed = async function (
  {
    title: title,
    desc: desc,
    color: color,
    image: image,
    author: author,
    thumbnail: thumbnail,
    fields: fields,
    url: url,
    content: content,
    components: components,
    type: type
  },
  interaction
) {
  let embed = new Discord.EmbedBuilder().setColor(client.config.colorthemecode);

  if (title) embed.setTitle(title);
  if (desc && desc.length >= 2048)
    embed.setDescription(desc.substr(0, 2044) + "...");
  else if (desc) embed.setDescription(desc);
  if (image) embed.setImage(image);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (fields) embed.addFields(fields);
  if (author) embed.setAuthor(author[0], author[1]);
  if (url) embed.setURL(url);
  if (color) embed.setColor(color);

  return sendEmbed(
    {
      embeds: [embed],
      content: content,
      components: components,
      type: type
    },
    interaction
  );
};

async function sendEmbed(
  { embeds: embeds, content: content, components: components, type: type },
  interaction
) {
  if (type && type.toLowerCase() == "edit") {
    return await interaction
      .edit({
        embeds: embeds,
        content: content,
        components: components,
        fetchReply: true
      })
      .catch((e) => {});
  } else if (type && type.toLowerCase() == "editreply") {
    return await interaction
      .editReply({
        embeds: embeds,
        content: content,
        components: components,
        fetchReply: true
      })
      .catch((e) => {});
  } else if (type && type.toLowerCase() == "reply") {
    return await interaction
      .reply({
        embeds: embeds,
        content: content,
        components: components,
        fetchReply: true
      })
      .catch((e) => {});
  } else if (type && type.toLowerCase() == "update") {
    return await interaction
      .update({
        embeds: embeds,
        content: content,
        components: components,
        fetchReply: true
      })
      .catch((e) => {});
  } else if (type && type.toLowerCase() == "ephemeraledit") {
    return await interaction
      .editReply({
        embeds: embeds,
        content: content,
        components: components,
        fetchReply: true,
        ephemeral: true
      })
      .catch((e) => {});
  } else if (type && type.toLowerCase() == "ephemeral") {
    return await interaction
      .reply({
        embeds: embeds,
        content: content,
        components: components,
        fetchReply: true,
        ephemeral: true
      })
      .catch((e) => {});
  } else {
    return await interaction
      .send({
        embeds: embeds,
        content: content,
        components: components,
        fetchReply: true
      })
      .catch((e) => {});
  }
}

module.exports = {
  errNormal,
  errUsage,
  errMissingPerms,
  errNoPerms,
  errWait,
  succNormal,
  embed,
  simpleEmbed
};
