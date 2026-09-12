const fs = require("fs");
const { PlayerClass } = require("../Configfiles/logsclass.js");
const main = require("../main");
const { upsertUserCache } = require("../functions/localUserCache");
const { resolveUserByDisplayName } = require("../functions/vrcLoggerApiClient");

// vrcga checkuser

// vrcga blacklist
const { blacklistvrcgajoined } = require("./vrcga/blacklist/index.js");

// vrcga automod
const { automoduservrcgajoined } = require("./vrcga/automod/index.js");

// vrcga usercache
const { usercacheuservrcgajoined } = require("./vrcga/usercache/index.js");

const Bottleneck = require("bottleneck");

const limiter = new Bottleneck({
  maxConcurrent: 1, // Process one request at a time
  minTime: 500, // Minimum 500ms between requests
});

// Some VRChat log lines carry a display name but no user id. Ask the dashboard's
// group member cache, which also matches names the user has since changed away
// from, so a rename does not lose the identity.
async function resolveMissingUserId(displayName) {
  try {
    const match = await resolveUserByDisplayName(displayName);
    if (!match?.userId) return null;

    if (match.historical) {
      main.log(
        `Resolved "${displayName}" to ${match.userId} via a previous display name (now "${match.displayName}")`,
        "info",
        "joinleavelog"
      );
    }
    return match.userId;
  } catch (error) {
    main.log(`Name lookup failed for "${displayName}": ${error.message}`, "info", "joinleavelog");
    return null;
  }
}

async function vrchatcheckUserConnection(displayname, cleanUser) {
  return limiter.schedule(async () => {
    const displayName = displayname;
    let userId = cleanUser;

    if (!userId || userId === "unknown") {
      userId = (await resolveMissingUserId(displayName)) || userId;
    }

    await upsertUserCache({ userId, displayName });

    const timestamp = Date.now() / 1000;
    const formattedLogMessage = `<t:${Math.round(
      timestamp
    )}:f> vrchat logs - User ${displayName} and ${userId} connected`;

    PlayerClass.writeplayerToFile(formattedLogMessage);

    blacklistvrcgajoined(displayName, userId);
    automoduservrcgajoined(displayName, userId);
    usercacheuservrcgajoined(displayName, userId);
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

}

module.exports = {
  vrchatcheckUserConnectionleft,
  vrchatcheckUserConnection
};
