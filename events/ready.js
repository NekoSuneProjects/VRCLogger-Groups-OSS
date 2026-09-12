// events/ready.js
const chalk = require("chalk");
const { version: discordjsVersion, ActivityType } = require("discord.js");

// pull a lazy models accessor (initialized by interactionModal initializer)
const initFunExt = require("../utils/funt-ext.js");

module.exports = (client) => {
  client.on("ready", async () => {
    const cfg = client.config || {};
    const supportGuildId = cfg.TestingServerID;
    const profile = client.state?.profile || { config: cfg, db: client.state?.db };

    initFunExt(client, profile);

    let blCount = 0;
    let aviCount = 0;
    let groupCount = 0;
    try {
      blCount = await profile.db.VRCBlacklist.count();
      aviCount = await profile.db.VRCAVIBlacklist.count();
      groupCount = await profile.db.VRCBlacklistGroups.count();
    } catch (err) {
      console.error("Failed counting blacklist stats:", err.message);
    }

    let GuildChis = client.guilds.cache.get(supportGuildId);
    let ChannelChis = GuildChis?.channels?.cache?.get(
      cfg.VRCAPI?.LoggerTextChannel?.JOINMEMBER
    );

    console.log("");
    console.log(chalk.red.bold("———————————————[Ready MSG]———————————————"));

    if (!ChannelChis) {
      console.log("");
      console.log(chalk.red.bold("——————————[SERVER CHECK]——————————"));
      console.log(
        chalk.gray(
          `[Checking Support Server]: CHECKING BOT IN SUPPORT SERVER\n[Discord] A matching channel could not be found. Please check your DISCORD_SERVERID and DISCORD_CHANNELID environment variables.`
        )
      );
    } else {
      console.log("");
      console.log(chalk.red.bold("——————————[SERVER CHECK]——————————"));
      console.log(
        chalk.gray(
          `[Checking Support Server]: CHECKING BOT IN SUPPORT SERVER\n[Discord] ${client.user.username} Discord BOT Ready`
        )
      );
      client.botReady = true;
    }

    const supportServer = client.guilds.cache.get(String(supportGuildId));
    if (!supportServer) console.log("");

    // ———————————————[Status]———————————————
    console.log(`Logged in as ${client.user.username} - (${client.user.id})`);
    console.log("Ready to go!");
    console.log("--------------------------------------------------");

    // Initial presence
    client.user.setPresence({
      activities: [{ name: `STARTING UP...`, type: ActivityType.Watching }],
      status: "dnd"
    });

    // rotating presences
    const totalMembers = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
    const presences = [
      { name: `/help || BanLogger Rebuild by NekoSuneVR`, delay: 0 },
      {
        name: `/help || We have Over ${blCount} Blacklisted Users | ${aviCount} Banned Avatars || ${groupCount} Blacklisted Groups`,
        delay: 30000
      },
      { name: `/help || NekoSuneVR is Best Developer`, delay: 40000 },
      {
        name: `/help || Connected: ${client.guilds.cache.size} ${client.guilds.cache.size > 1 ? "Servers" : "Server"}`,
        delay: 50000
      },
      {
        name: `/help || Surving: ${totalMembers} ${totalMembers > 1 ? "Users," : "User,"}`,
        delay: 60000
      },
      { name: `/help || BOT Version: ${require("../package.json").version} (ALPHA)`, delay: 70000 }
    ];

    // IMPORTANT: pass a function to setInterval (don’t call immediately)
    setInterval(() => {
      presences.forEach((presence) => {
        setTimeout(() => {
          client.user.setPresence({
            activities: [{ name: presence.name, type: ActivityType.Watching }],
            status: "dnd"
          });
        }, presence.delay);
      });
    }, 80000);

    // ———————————————[Ready MSG]———————————————
    console.log("");
    console.log(chalk.red.bold("——————————[BOT DETAILS]——————————"));
    console.log(chalk.gray("Connected To"), chalk.yellow(`${client.user.tag}`));
    console.log(
      chalk.white("Watching"),
      chalk.red(`${totalMembers}`),
      chalk.white(`${totalMembers > 1 ? "Users," : "User,"}`),
      chalk.red(`${client.guilds.cache.size}`),
      chalk.white(`${client.guilds.cache.size > 1 ? "Servers," : "Server,"}`)
    );

    console.log(
      chalk.red(`${blCount}`), chalk.white(`Blacklisted Users`), chalk.white("||"),
      chalk.red(`${aviCount}`), chalk.white(`Blacklisted Avatars`), chalk.white("||"),
      chalk.red(`${groupCount}`), chalk.white(`Blacklisted Groups`)
    );

    console.log(
      chalk.white(`Prefix:` + chalk.red(` /`)),
      chalk.white("||"),
      chalk.red(`${client.slashCommands?.size || 0}`),
      chalk.white(`Slash Commands`)
    );
    console.log(chalk.white(`Support-Server: `) + chalk.red(`${supportServer?.name || "None"}`));
    console.log("");
    console.log(chalk.red.bold("——————————[Statistics]——————————"));
    console.log(
      chalk.gray(
        `Discord.js Version: ${discordjsVersion}\nRunning on Node ${process.version} on ${process.platform} ${process.arch}`
      )
    );
    console.log(
      chalk.gray(
        `Memory: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB RSS\n` +
        `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`
      )
    );
  });
};
