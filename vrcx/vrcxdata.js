const fs = require("fs");
const { LOGSCLASS } = require("../Configfiles/logsclass.js");
const sqlite3 = require("sqlite3");
const main = require("../main.js");
const { fetchWithRetry } = require("../functions/vrcLoggerApiClient");

const getConfig = require("../functions/getConfig.js"); // Import the getConfig function

async function initializeConfig() {
  const Config = {
    vrcx: await getConfig("vrcx"),
    Toggle: {
      vrcxdata: await getConfig("Toggle.vrcxdata")
    }
  };
  return Config;
}

async function vrcxdata() {
  const Config = await initializeConfig(); // Fetch config settings from the database
  if (Config.Toggle.vrcxdata == true) {
    // World-Persistence get from vrcx data
    const apiUrl = "http://127.0.0.1:22500/vrcx/data/getall";
    const headers = {
      Accept: "application/json"
    };

    fetchWithRetry(apiUrl, { method: "GET", headers })
      .then(handleResponse)
      .then(handleData)
      .catch(handleError);

    function handleResponse(response) {
      if (!response.ok) {
        if (response.status === 404) {
          return {
            error: "vrcx - Warning is the vrcx is running?"
          };
        } else {
          console.log(`Failed to fetch data: ${response.status}`);
          throw new Error(`Failed to fetch data: ${response.status}`);
        }
      }
      return response.json();
    }

    function handleData(data) {
      if (data.error) {
        main.log(`vrcx - Warning there is no data`, "info", "joinleavelog");
        return;
      }
      main.log(
        `vrcx data - ${JSON.stringify(data.data, null, 2)}`,
        "info",
        "joinleavelog"
      );
    }

    function handleError(error) {
      console.error(error);
      LOGSCLASS.writeErrorToFile(error);
    }
  }
}

module.exports = {
  vrcxdata
};
