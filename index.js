const { Client, GatewayIntentBits, Partials } = require("discord.js");
const chalk = require("chalk");
const { loadConfig, attachConfig } = require("./lib/appConfig");
const { startDashboard } = require("./lib/dashboard");

const logger = console;

const CLIENT_OPTIONS = {
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [
    Partials.User,
    Partials.Channel,
    Partials.GuildMember,
    Partials.Message,
    Partials.Reaction,
    Partials.GuildScheduledEvent,
    Partials.ThreadMember
  ]
};

const client = new Client(CLIENT_OPTIONS);

async function startBot() {
  try {
    const loaded = await loadConfig();
    const profile = attachConfig(client, loaded);

    require("./handler")(client, profile.config, { profile, db: profile.db });

    client.on("ready", () => {
      logger.info(
        `Bot logged in as ${client.user.tag} ` +
          `(server: ${profile.guildId}, group: ${profile.config.VRCAPI.groupid})`
      );
    });

    await client.login(loaded.token);

    startDashboard({ loaded, client, defaultPort: 3434 });
  } catch (error) {
    logger.error(`Startup failed: ${error.message}`);
    process.exit(1);
  }
}

startBot();

// ———————————————[Error Handling]———————————————
process.on("unhandledRejection", (reason, p) => {

   if (reason === "Error [INTERACTION_ALREADY_REPLIED]: The reply to this interaction has already been sent or deferred.") return;

   console.log(chalk.gray("—————————————————————————————————"));
   console.log(
      chalk.white("["),
      chalk.red.bold("AntiCrash"),
      chalk.white("]"),
      chalk.gray(" : "),
      chalk.white.bold("Unhandled Rejection/Catch")
   );
   console.log(chalk.gray("—————————————————————————————————"));
   console.log(reason, p);
});
process.on("uncaughtException", (err, origin) => {
   console.log(chalk.gray("—————————————————————————————————"));
   console.log(
      chalk.white("["),
      chalk.red.bold("AntiCrash"),
      chalk.white("]"),
      chalk.gray(" : "),
      chalk.white.bold("Uncaught Exception/Catch")
   );
   console.log(chalk.gray("—————————————————————————————————"));
   console.log(err, origin);
});

/*process.on("multipleResolves", (type, promise, reason) => {

   if (reason === "Error: Cannot perform IP discovery - socket closed") return;
   if (reason === "AbortError: The operation was aborted") return;

   console.log(chalk.gray("—————————————————————————————————"));
   console.log(
      chalk.white("["),
      chalk.red.bold("AntiCrash"),
      chalk.white("]"),
      chalk.gray(" : "),
      chalk.white.bold("Multiple Resolves")
   );
   console.log(chalk.gray("—————————————————————————————————"));
   console.log(type, promise, reason);
});*/

module.exports = client;
