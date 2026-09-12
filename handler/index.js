// handler.js
const { glob } = require("glob");
const { promisify } = require("util");
const globPromise = promisify(glob);
const chalk = require("chalk");
const { Collection } = require("discord.js");

module.exports = async (client, config, state) => {
  // Attach config & runtime stores BEFORE loading anything else
  client.config = config;
  client.emotes = require("../config/emojis.json");
  client.botsettings = require("../config/discordbotcfg.json");
  client.tags = require("../config/tags.json");
  client.cooldowns = client.cooldowns || new Map();
  client.slashCommands = client.slashCommands || new Collection();

  // ———————————————[Events that self-attach]———————————————
  // If you still have legacy events that call client.on inside the file without exporting a function,
  // you can enable the next two lines. Prefer the function-style (below) when possible.
  // const eventFiles = await globPromise(`${process.cwd()}/events/*.legacy.js`);
  // eventFiles.map((value) => require(value));

  // ———————————————[Events]———————————————
  const eventFiles = await globPromise(`${process.cwd()}/events/*.js`);
  for (const file of eventFiles) {
    const init = require(file);
    if (typeof init !== "function") continue;

    init(client, state);
  }

  // ———————————————[Slash Commands]———————————————
  const slashCommands = await globPromise(
    `${process.cwd()}/SlashCommands/*/*.js`
  );

  const arrayOfSlashCommands = [];
  slashCommands.map((value) => {
    const file = require(value);
    if (!file?.name) return;
    const splitted = value.split("/");
    const directory = splitted[splitted.length - 2];
    const properties = { directory, ...file };
    client.slashCommands.set(file.name, properties);

    if (["MESSAGE", "USER"].includes(file.type)) delete file.description;
    arrayOfSlashCommands.push(file);
  });

  client.on("ready", async () => {
    const guildId = String(client.config.TestingServerID || "").trim();
    const guild =
      (guildId && client.guilds.cache.get(guildId)) ||
      (guildId ? await client.guilds.fetch(guildId).catch(() => null) : null);

    if (!guild) {
      console.log(chalk.gray("—————————————————————————————————"));
      console.log(
        chalk.white("["), chalk.red.bold("AntiCrash"), chalk.white("]"),
        chalk.gray(" : "),
        chalk.white.bold("Couldn't Find ServerID to set the Slash Cmds")
      );
      console.log(chalk.gray("—————————————————————————————————"));
      console.log(
        chalk.cyan("Set ") +
          chalk.red("TestingServerID") +
          chalk.cyan(" in ") +
          chalk.red.underline("config/settings.json") +
          chalk.cyan(" to the Discord server this bot serves, then invite the bot to it.")
      );
      return;
    }

    // This bot serves exactly one Discord server, so register commands to it
    // directly - guild commands apply instantly, with no global propagation delay.
    await guild.commands.set(arrayOfSlashCommands);

    // Drop leftover global commands from earlier multi-server builds.
    await client.application.commands.set([]).catch(() => {});
  });
};
