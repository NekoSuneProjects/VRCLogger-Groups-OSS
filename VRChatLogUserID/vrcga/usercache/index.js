const {
  LOGSCLASS,
  VRCGAPICheckUsersBLPLClass
} = require("../../../Configfiles/logsclass.js");
const main = require("../../../main.js");

const getConfig = require("../../../functions/getConfig"); // Import the getConfig function

const {
  getUserCache,
  upsertUserCache
} = require("../../../functions/localUserCache");

async function initializeConfig() {
  const Config = {
    Toggle: {
      CheckUserCache: await getConfig("Toggle.CheckUserCache"),
    },
  };
  return Config;
}

async function usercacheuservrcgajoined(displayName, userId) {
  const Config = await initializeConfig(); // Fetch config settings from the database

  if (Config.Toggle.CheckUserCache == true) {
    if (!userId) {
      return; // or throw an error, depending on your requirements
    }

    upsertUserCache({ userId, displayName })
      .then(() => getUserCache(userId))
      .then(handleData)
      .catch(handleError);

    function handleResponse(response) {
      if (!response.ok) {
        if (response.status === 403) {
          return {
            status: 403,
            error: `API vrclogger user cache - Requires ApiKey, Please Contact NekoSuneVR for ApiKey Access`
          };
        } else if (response.status === 401) {
          return {
            status: 401,
            error: `API vrclogger user cache - Invalid ApiKey, Please check or contact NekoSuneVR`
          };
        } else if (response.status === 404) {
          console.log(
            `API vrclogger user cache - Warning User ${displayName} not found in banned users list`
          );
        } else {
          console.log(
            `API vrclogger user cache Failed to fetch data: ${response.status}`
          );
          throw new Error(
            `API vrclogger user cache  Failed to fetch data: ${response.status}`
          );
        }
      }
      return response.json();
    }

    function handleData(data) {
      if (data.status == 429) {
        main.log(
          `API vrclogger user cache - ${data.message}`,
          "info",
          "blacklistlog"
        );
        const message = `API vrclogger user cache - ${data.message}`;
        VRCGAPICheckUsersBLPLClass.writeModerationToFile(message);
        return;
      }
      if (data.status == 404) {
        const message = `API vrclogger user cache - Warning User ${userId} not found in any database`;
        VRCGAPICheckUsersBLPLClass.writeModerationToFile(message);
        return;
      }

      if (data.status == 403) {
        main.log(
          `API vrclogger user cache - Invalid API key, Please Check APIKEY Correct`,
          "info",
          "blacklistlog"
        );
        const message = `API vrclogger user cache - Invalid API key, Please Check APIKEY Correct`;
        VRCGAPICheckUsersBLPLClass.writeModerationToFile(message);
        return;
      }

      if (data.status == 401) {
        main.log(
          `API vrclogger user cache - Please enter Your API key, To Get APIKEY, Contact NekoSuneVR`,
          "info",
          "blacklistlog"
        );
        const message = `API vrclogger user cache - Please enter Your API key, To Get APIKEY, Contact NekoSuneVR`;
        VRCGAPICheckUsersBLPLClass.writeModerationToFile(message);
        return;
      }

      if (data.status == 200) {
        let message;

        if (data.bio) {
          message = `API vrclogger user cache - Cached User Found ${data.displayName} connected userID: ${data.userID} and Bio: ${data.bio} and Date-joined: ${data.dateJoined} and Last-Platform: ${data.lastPlatform}`;
        } else {
          message = `API vrclogger user cache - Cached User Found ${data.displayName} connected userID: ${data.userID} and Date-joined: ${data.dateJoined} and Last-Platform: ${data.lastPlatform}`;
        }

        main.log(
          message,
          "info",
          "blacklistlog"
        );
        VRCGAPICheckUsersBLPLClass.writeModerationToFile(message);
      } else if (data) {
        const message = `API vrclogger user cache - Cached User Found ${data.displayName} connected userID: ${data.userId} and Last Seen: ${data.lastSeenAt}`;
        main.log(message, "info", "blacklistlog");
        VRCGAPICheckUsersBLPLClass.writeModerationToFile(message);
      }
    }

    function handleError(error) {
      console.error(error);
      const message = `API vrclogger user cache ${error}`;
      LOGSCLASS.writeErrorToFile(message);
    }
  }
}

module.exports = {
  usercacheuservrcgajoined
};
