const { APIClientVRCGAavi } = require("../APIClient/APIClientVRCGAavi");
const fs = require("fs");
const path = require("path");
const os = require("os");

const main = require("../main");
const { Sequelize, DataTypes } = require("sequelize");
const { ErroravataruploadCLASS } = require("../Configfiles/logsclass.js");
const getVersion = require("../package.json"); // Import the getVersion function
const {
  fetchDashboardPublicJson,
  fetchWithRetry
} = require("../functions/vrcLoggerApiClient");
const { getUserCache } = require("../functions/localUserCache");

const processedFiles = new Set();
const counters = { ava: { success: 0, fail: 0 } };
let chokidarWatchPromise = null;

const AMP_PATH = path.join(os.tmpdir(), "VRChat", "VRChat", "amplitude.cache");

const getConfig = require("../functions/getConfig"); // Import the getConfig function

async function getChokidarWatch() {
  if (!chokidarWatchPromise) {
    chokidarWatchPromise = import("chokidar").then(module => {
      const watch = module.watch || module.default?.watch;

      if (typeof watch !== "function") {
        throw new Error("Unable to load chokidar watch function.");
      }

      return watch;
    });
  }

  return chokidarWatchPromise;
}

const appInstallPath = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  require("../package.json").name
);
const configDir = path.join(appInstallPath, "config");
const sqlitePath = path.join(configDir, "avatarid.sqlite");

// Setup Sequelize
const sequelize = new Sequelize("avatarid", "", "", {
  dialect: "sqlite",
  storage: sqlitePath,
  logging: false
});

const Avatars = sequelize.define(
  "Avatars",
  {
    id: { type: DataTypes.TEXT, primaryKey: true, unique: true }
  },
  { timestamps: false }
);

async function initializeConfig() {
  const Config = {
    Toggle: {
      VRNotify: await getConfig("Toggle.VRNotify"),
      TTSAutoMod: await getConfig("Toggle.TTSAutoMod"),
      BOSAlert: await getConfig("Toggle.BOSAlert"),
      Countersavi: await getConfig("Toggle.Countersavi"),
    },
  };
  return Config;
}

sequelize.sync().catch(err => console.error("Sequelize sync error:", err));

async function insertId(idValue) {
  try {
    const [avatar, created] = await Avatars.findOrCreate({
      where: { id: idValue }
    });
    if (created) {
      console.log(`Avatar ID ${idValue} inserted.`);
    } else {
      console.log(`Avatar ID ${idValue} already exists.`);
    }
  } catch (err) {
    console.error("Error inserting row:", err);
    ErroravataruploadCLASS.writeErrorToFile(err);
  }
}

function updateCounters(type, status) {
  if (status === "success") counters[type].success++;
  else if (status === "fail") counters[type].fail++;
}

async function checkthingtwo() {
  try {
    console.log("Watching amplitude cache...");
    let login = false;
    startPeriodicWatch(login, true);
  } catch (e) {
    console.error(e);
    ErroravataruploadCLASS.writeErrorToFile(e);
  }
}

function startPeriodicWatch(login, test) {
  setInterval(() => {
    console.log("Running periodic amplitude watcher...");
    watchPeriodically(login, test).catch(err =>
      console.error("Error in watchPeriodically:", err)
    );
  }, 1000);
}

async function watchPeriodically(login, test) {
  if (!test) return;

  const watch = await getChokidarWatch();
  const watcher = watch(AMP_PATH, {
    persistent: true,
    ignoreInitial: login
  });

  watcher.on(
    "change",
    throttle(async filePath => {
      console.log("Detected amplitude.cache change");

      try {
        const fileContent = await fs.promises.readFile(filePath, "utf8");
        const events = JSON.parse(fileContent);

        for (const event of events) {
          if (
            event.event_type === "Moderation_ShowUserAvatar" &&
            event.event_type === "Moderation_ResetShowUserAvatarToDefault"
          ) {
            const avatarinfo = {
              avatarId: event.event_properties.avatarId,
              targetUserId: event.event_properties.targetUserId,
              hostUserId: event.user_id
            };

            if (
              avatarinfo.avatarId &&
              avatarinfo.targetUserId &&
              !processedFiles.has(avatarinfo.avatarId)
            ) {
              processedFiles.add(avatarinfo.avatarId);

              console.log(
                `Found avatarId: ${avatarinfo.avatarId}, targetUserId: ${avatarinfo.targetUserId}`
              );

              updateCounters("ava", "success");
              await insertId(avatarinfo.avatarId);
              await putAvatars(avatarinfo);
            }
          }
        }
      } catch (error) {
        console.error("Error processing amplitude cache:", error);
        ErroravataruploadCLASS.writeErrorToFile(error);
        updateCounters("ava", "fail");
      }
    }, 500)
  );
}

function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

async function fetchUserCacheData(userId) {
  try {
    return await getUserCache(userId);
  } catch (error) {
    console.log("External Logger Error:", error.message);
    return null;
  }
}

async function putAvatars(jsonData) {
  const crasherUser = APIClientVRCGAavi.CrasherAvatar.find(
    user => user.avatarId === jsonData.avatarId
  );

  const ripperUser = APIClientVRCGAavi.RipperAvatar.find(
    user => user.avatarId === jsonData.avatarId
  );

  if (crasherUser) {
    const userCacheData = await fetchUserCacheData(jsonData.targetUserId);
    if (userCacheData) {
      main.log(
        `API - [Crasher] Warning: User ${userCacheData.displayName} (${jsonData.targetUserId}) is wearing a known crasher avatar flagged on ${crasherUser.date.toLocaleString()}`,
        "info",
        "modlog"
      );
    } else {
      main.log(
        `API - [Crasher] Warning: User ${jsonData.targetUserId} is wearing a known crasher avatar flagged on ${crasherUser.date.toLocaleString()}`,
        "info",
        "modlog"
      );
    }
  }

  if (ripperUser) {
    const userCacheData = await fetchUserCacheData(jsonData.targetUserId);
    if (userCacheData) {
      main.log(
        `API - [Ripper] Warning: User ${userCacheData.displayName} (${jsonData.targetUserId}) is wearing a known ripped avatar flagged on ${ripperUser.date.toLocaleString()}`,
        "info",
        "modlog"
      );
    } else {
      main.log(
        `API - [Ripper] Warning: User (${jsonData.targetUserId}) is wearing a known ripped avatar flagged on ${ripperUser.date.toLocaleString()} (userCacheData not found)`,
        "info",
        "modlog"
      );
    }
  }

  try {
    const domains = await fetchDashboardPublicJson("/domains.json");
    const internalUrls = domains.Internal.map(entry => entry.url);

    const ids = JSON.stringify({
      id: jsonData.avatarId,
      userid: jsonData.hostUserId
    });
    const headers = {
      "Content-Type": "application/json",
      Cache: "no-cache",
      "User-Agent": `VRCLogger-Project-Darkstar-Client/${getVersion.version}`
    };

    for (const url of internalUrls) {
      for (let i = 0; i < 1; i++) {
        // Retry up to 1 times
        try {
          const response = await fetchWithRetry(url, {
            method: "POST",
            headers: headers,
            credentials: "same-origin",
            body: ids
          }, 1);

          if (!response.ok) {
            console.error(
              `Error in putAvatars: ${response.statusText} for URL: ${url}`
            );
            const mgserror = `Error in putAvatars: ${response.statusText} for URL: ${url}`;
            ErroravataruploadCLASS.writeErrorToFile(mgserror);
            continue; // Move to the next URL
          }

          const body = await response.json();

          if (body.status.status !== 200) {
            console.error(
              `Error in putAvatars: Unexpected status code: ${body.status
                .status} for URL: ${url}`
            );
            const mgserror = `Error in putAvatars: Unexpected status code: ${body
              .status.status} for URL: ${url}`;
            ErroravataruploadCLASS.writeErrorToFile(mgserror);
            continue; // Move to the next URL
          }
          break; // Break out of the retry loop on success
        } catch (err) {
          console.error(`Error in putAvatars: ${err.message} for URL: ${url}`);
          ErroravataruploadCLASS.writeErrorToFile(err);
          if (i < 2) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before retrying
          }
        }
      }
    }
  } catch (err) {
    console.error(`Error in putAvatars: ${err.message}`);
    ErroravataruploadCLASS.writeErrorToFile(err);
    ErroravataruploadCLASS.writeErrorToFile(err.message);
  }
}

module.exports = {
  putAvatars,
  checkthingtwo
};
