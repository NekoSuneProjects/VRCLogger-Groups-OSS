const pkgjn = require("../package.json");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { Sequelize } = require("sequelize");
const Config = require("../models/Config"); // Adjust the path as necessary
const UserConfig = require("../models/UserConfig"); // Adjust the path as necessary

const { LOGSCLASS } = require("../Configfiles/logsclass.js");

// Get the path where the app is installed
const appInstallPath = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  pkgjn.name
);

const logDir = path.join(appInstallPath, "log");
const configDir = path.join(appInstallPath, "config");

// Function to fetch the configuration from SQLite
async function fetchConfig() {
  try {
    const configs = await Config.findAll();
    const configObject = {};

    configs.forEach(config => {
      configObject[config.keyid] = JSON.parse(config.value);
    });

    return configObject; // Return the full configuration object
  } catch (error) {
    console.error("Error fetching config:", error);
    LOGSCLASS.writeErrorToFile(`Error fetching config: ${error}`);
    throw error; // Re-throw the error for handling later
  }
}

// Function to fetch the user ID from SQLite
async function fetchUserId() {
  try {
    const userIdEntry = await UserConfig.findOne();
    return userIdEntry ? userIdEntry.userId : null; // Return the userId or null if not found
  } catch (error) {
    console.error("Error fetching user ID:", error);
    LOGSCLASS.writeErrorToFile(`Error fetching user ID: ${error}`);
    throw error; // Re-throw the error for handling later
  }
}

// Asynchronous function to gather all configurations and user ID
async function initializeConfigAndUser() {
  const config = await fetchConfig();
  const userId = await fetchUserId();

  return { config, userId };
}

module.exports = {
  initializeConfigAndUser, // Export the initialization function
  configdir: configDir,
  logpath: logDir
};
