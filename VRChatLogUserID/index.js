const fs = require("fs");
const { PlayerClass } = require("../Configfiles/logsclass.js");
const { sendToWebhook } = require("../webhook/index.js");
const main = require("../main");
const { upsertUserCache } = require("../functions/localUserCache");

// vrcga checkuser
const getConfig = require("../functions/getConfig"); // Import the getConfig function

async function initializeConfig() {
  const Config = {
    Toggle: {
      globaltoggle: await getConfig("Toggle.globaltoggle")
    }
  };
  return Config;
}
// vrcga blacklist
const { blacklistvrcgajoined, blacklistvrcgajoinedGlobal } = require("./vrcga/blacklist/index.js");

// vrcga automod
const { automoduservrcgajoined, automoduservrcgajoinedGlobal } = require("./vrcga/automod/index.js");

// vrcga usercache
const { usercacheuservrcgajoined, usercacheuservrcgajoinedGlobal } = require("./vrcga/usercache/index.js");

const Bottleneck = require("bottleneck");

const limiter = new Bottleneck({
  maxConcurrent: 1, // Process one request at a time
  minTime: 500, // Minimum 500ms between requests
});

async function vrchatcheckUserConnection(displayname, cleanUser) {
  return limiter.schedule(async () => {
    const Config = await initializeConfig(); // Fetch config settings from the database
    const displayName = displayname;
    const userId = cleanUser;
    await upsertUserCache({ userId, displayName });

    const timestamp = Date.now() / 1000;
    const formattedLogMessage = `<t:${Math.round(
      timestamp
    )}:f> vrchat logs - User ${displayName} and ${userId} connected`;

    PlayerClass.writeplayerToFile(formattedLogMessage);

    blacklistvrcgajoined(displayName, userId);
    automoduservrcgajoined(displayName, userId);
    usercacheuservrcgajoined(displayName, userId);

    if (Config.Toggle.globaltoggle) {
      blacklistvrcgajoinedGlobal(displayName, userId);
      automoduservrcgajoinedGlobal(displayName, userId);
      usercacheuservrcgajoinedGlobal(displayName, userId);
    }
  });
}

async function vrchatcheckUserConnectionleft(displayname, cleanUser) {
  const displayName = displayname;
  const userId = cleanUser;

  const timestamp = Date.now() / 1000;
  formattedLogMessage = `<t:${Math.round(
    timestamp
  )}:f> vrchat logs - User ${displayName} and ${userId} disconnected`;

  PlayerClass.writeplayerToFile(formattedLogMessage);

  main.log(
    `User ID: ${userId}, Display Name: ${displayName} disconnected`,
    "info",
    "joinleavelog"
  );

  const message = `vrchat logs - ${displayName} and ${userId} disconnected`;

  sendToWebhook(message);
}

module.exports = {
  vrchatcheckUserConnectionleft,
  vrchatcheckUserConnection
};
