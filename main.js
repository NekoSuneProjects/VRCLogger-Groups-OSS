const { app, BrowserWindow, ipcMain } = require("electron");
const http = require("http");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const os = require("os");
const sequelize = require("./functions/configsqlite");
const Config = require("./models/Config");
const UserConfig = require("./models/UserConfig");
const getConfig = require("./functions/getConfig"); // Import the getConfig function
const {
  fetchDashboardJson,
  getDashboardBaseUrl,
  getVrcLoggerApiConfig,
  testDashboardConnection
} = require("./functions/vrcLoggerApiClient");
const { version } = require("./package.json"); // Adjust the path as needed
const { VRCAssetsLoggerJSONCLASS } = require("./Configfiles/logsclass.js");

const overlayState = {
  worldName: "",
  worldId: "",
  location: "",
  instanceId: "",
  localVrchatUsername: "",
  localVrchatUserId: "",
  discordDisplayName: "",
  updatedAt: null
};
let overlayServer = null;
let overlayServerUrl = "";
let overlayWorldLookupKey = "";

async function resolveOverlayWorld() {
  const location = overlayState.location;
  const worldId = overlayState.worldId;
  const lookupKey = location || worldId;

  if (!lookupKey || lookupKey === overlayWorldLookupKey) {
    return;
  }

  overlayWorldLookupKey = lookupKey;

  try {
    const params = location
      ? `location=${encodeURIComponent(location)}`
      : `worldId=${encodeURIComponent(worldId)}`;
    const data = await fetchDashboardJson(`/api/client/world?${params}`, {
      throwOnApiStatus: false
    });
    const world = data && (data.world || data.data || data);
    const worldName =
      world &&
      (world.name || world.worldName || world.displayName || world.title);

    if (worldName && (overlayState.location || overlayState.worldId) === lookupKey) {
      overlayState.worldName = worldName;
      overlayState.updatedAt = new Date().toISOString();
    }
  } catch (error) {
    console.warn(`OBS overlay world lookup failed: ${error.message}`);
  }
}

function updateOverlayState(partial) {
  Object.assign(overlayState, partial, { updatedAt: new Date().toISOString() });

  if (partial && (partial.location || partial.worldId)) {
    resolveOverlayWorld();
  }
}

function startOverlayServer(port = 37841) {
  if (overlayServer) {
    return overlayServerUrl;
  }

  overlayServer = http.createServer((req, res) => {
    if (req.url === "/overlay/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(overlayState));
      return;
    }

    if (req.url === "/" || req.url === "/overlay") {
      const overlayPath = path.join(__dirname, "web", "obs-overlay.html");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fsSync.readFileSync(overlayPath, "utf8"));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  overlayServer.listen(port, "127.0.0.1");
  overlayServerUrl = `http://127.0.0.1:${port}/overlay`;
  return overlayServerUrl;
}

// Get the path where the app is installed
ipcMain.handle("get-user-data-path", () => {
  return app.getPath("userData");
});

// Function to check if the SQLite database exists
async function doesDatabaseExist() {
  const pkgjn = require("./package.json");
  const dbPath = path.join(
    process.env.HOME || process.env.USERPROFILE,
    "AppData",
    "Roaming",
    pkgjn.name,
    "config",
    "config.sqlite"
  );

  try {
    await fs.access(dbPath, fs.constants.F_OK); // Check if file exists
    return true; // Database exists
  } catch (error) {
    return false; // Database does not exist
  }
}

// Function to initialize the database and setup initial configurations
async function initializeDatabase() {
  try {
    const dbExists = await doesDatabaseExist();

    if (!dbExists) {
      console.log("Database does not exist. Creating initial configuration.");
      await sequelize.authenticate(); // Ensure DB connection works
      await sequelize.sync(); // Initialize SQLite DB
      await setupInitialConfig();
    } else {
      console.log("Database exists. Checking for missing configuration keys...");
      await sequelize.authenticate(); // Ensure DB connection works
      await sequelize.sync({ alter: true }); // Apply any missing columns safely
      await migrateConfig(); // Ensure missing keys are added
    }
  } catch (error) {
    console.error("Error initializing the database:", error);
  }
}
async function saveAssetRecursively(obj) {
  await VRCAssetsLoggerJSONCLASS.writeAssetLogToFile(obj);
}

// Recursively save each key-value pair from the config object to the database
async function saveConfigRecursively(obj, parentKey = "") {
  try {
    for (const [key, value] of Object.entries(obj)) {
      const currentKey = parentKey ? `${parentKey}.${key}` : key;

      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        // If the value is a nested object, recursively call the function
        await saveConfigRecursively(value, currentKey);
      } else {
        // Otherwise, save the value in the database with its unique keyid
        await Config.upsert({
          keyid: currentKey,
          value: JSON.stringify(value) // Save the value as a JSON string
        });
        //console.log(
        //    `Configuration for '${currentKey}' saved successfully.`
        //);
      }
    }
  } catch (error) {
    console.error("Error saving configuration:", error);
  }
}

// Load all configurations and reconstruct the nested JSON structure
async function loadConfig() {
  try {
    const configEntries = await Config.findAll();
    const configObject = {};

    // Reconstruct the config object from the database entries
    for (const entry of configEntries) {
      const keys = entry.keyid.split(".");
      let current = configObject;

      // Traverse through each level and build the nested structure
      keys.forEach((key, index) => {
        if (index === keys.length - 1) {
          current[key] = JSON.parse(entry.value); // Set the final value
        } else {
          current[key] = current[key] || {};
          current = current[key];
        }
      });
    }

    return configObject;
  } catch (error) {
    console.error("Error loading configuration:", error);
    return {};
  }
}

async function migrateConfig() {
  try {
    const currentConfig = await loadConfig(); // Load existing DB config
    const defaultConfig = await getDefaultConfig(); // Get the default config structure

    await updateMissingKeys(defaultConfig, currentConfig);
    await migrateDashboardBaseUrlConfig();
    await removeUnusedKeys();
  } catch (error) {
    console.error("Error migrating configuration:", error);
  }
}

async function migrateDashboardBaseUrlConfig() {
  const dashboardBaseUrl = await getConfig("VRCLoggerApi.dashboardBaseUrl");
  const dashboardEndpointUrl = await getConfig("VRCLoggerApi.dashboardEndpointUrl");

  if (!dashboardBaseUrl && dashboardEndpointUrl) {
    await Config.upsert({
      keyid: "VRCLoggerApi.dashboardBaseUrl",
      value: JSON.stringify(dashboardEndpointUrl)
    });
  }
}

async function updateMissingKeys(defaultConfig, currentConfig, parentKey = "") {
  for (const [key, defaultValue] of Object.entries(defaultConfig)) {
    const currentKey = parentKey ? `${parentKey}.${key}` : key;

    if (
      typeof defaultValue === "object" &&
      defaultValue !== null &&
      !Array.isArray(defaultValue)
    ) {
      // If it's a nested object, recurse into it
      await updateMissingKeys(defaultValue, currentConfig[key] || {}, currentKey);
    } else {
      // Check if key exists in the current config
      const existingValue = await getConfig(currentKey);

      if (existingValue === null) {
        console.log(`Adding missing key: ${currentKey} with default value.`);

        await Config.upsert({
          keyid: currentKey,
          value: JSON.stringify(defaultValue)
        });
      }
    }
  }
}

async function removeUnusedKeys() {
  try {
    const currentConfig = await loadConfig(); // Load existing config from DB
    const defaultConfig = await getDefaultConfig(); // Get the default config structure

    // Flatten both configs to a list of keys
    const defaultKeys = new Set(flattenKeys(defaultConfig));
    const currentKeys = flattenKeys(currentConfig);

    for (const key of currentKeys) {
      if (!defaultKeys.has(key)) {
        console.log(`Removing unused key: ${key}`);
        await Config.destroy({ where: { keyid: key } }); // Remove from DB
      }
    }
  } catch (error) {
    console.error("Error removing unused keys:", error);
  }
}

// Helper function to flatten keys into an array
function flattenKeys(obj, parentKey = "") {
  let keys = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = parentKey ? `${parentKey}.${key}` : key;

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      keys = keys.concat(flattenKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }

  return keys;
}

// Function to get the default configuration structure
async function getDefaultConfig() {
  const baseDir = path.join(
    os.homedir(),
    "AppData",
    "LocalLow",
    "VRChat",
    "VRChat"
  );

  let cachePath = null;
  let configvrc = {};

  const vrcconfigPath = path.join(baseDir, "config.json");

  try {
    const configFile = await fs.readFile(vrcconfigPath, "utf8");
    configvrc = JSON.parse(configFile);
  } catch (error) {
    console.error(`Error loading VRChat config: ${error}`);
  }

  if (configvrc?.cache_directory) {
    cachePath = path.join(configvrc.cache_directory, "Cache-WindowsPlayer");
  } else {
    cachePath = path.join(baseDir, "Cache-WindowsPlayer");
  }

  return {
    cache: { cacheDirectory: cachePath },
    Directories: { LogDirectory: baseDir },
    vrcx: {
      db: path.join(os.homedir(), "AppData", "Roaming", "VRCX", "VRCX.sqlite3")
    },
    Toggle: {
      vrcxdata: false,
      Countersavi: false,
      Countersvrca: true,
      AviSwitch: true,
      AviLogger: false,
      CheckGroupsBL: false,
      VRNotify: false,
      CheckAutoMod: false,
      CheckUser: false,
      TTSBL: false,
      TTSAutoMod: false,
      BOSAlert: false,
      vrcx: false,
      CheckUserCache: false,
      assetslogger: true,
      AviAnalysisStats: true
    },
    PrivacyandSafety: { videoplayerinfo: true, ipgrabber: true },
    VRCLoggerApi: {
      dashboardBaseUrl: "",
      apiKey: "",
      headerName: "vrclogger-api-key",
      groupId: ""
    },
    ApiKeys: {
      Auto_Mod_Check: "",
      ApiEndpointUrL: ""
    }
  };
}

// Function to set up initial configuration in the database
async function setupInitialConfig() {
  // Save configuration to the SQLite database
  const defaultConfig = await getDefaultConfig();
  await saveConfigRecursively(defaultConfig);
}

// Load all configurations and reconstruct the nested JSON structure
async function loadConfig() {
  try {
    const configEntries = await Config.findAll();
    const configObject = {};

    // Reconstruct the config object from the database entries
    for (const entry of configEntries) {
      const keys = entry.keyid.split(".");
      let current = configObject;

      // Traverse through each level and build the nested structure
      keys.forEach((key, index) => {
        if (index === keys.length - 1) {
          current[key] = JSON.parse(entry.value); // Set the final value
        } else {
          current[key] = current[key] || {};
          current = current[key];
        }
      });
    }

    return configObject;
  } catch (error) {
    console.error("Error loading configuration:", error);
    return {};
  }
}

// Usage examples
ipcMain.handle("load-config", async () => {
  return await loadConfig();
});

ipcMain.handle("save-config", async (event, config) => {
  await saveConfigRecursively(config);
});

ipcMain.handle("save-assetlist", async (event, config) => {
  await saveAssetRecursively(config);
});

// Listen for API config request from renderer
ipcMain.handle("get-api-endpoint", async () => {
  const config = await getVrcLoggerApiConfig();
  return getDashboardBaseUrl(config);
});

ipcMain.handle("get-overlay-url", async () => {
  return overlayServerUrl || startOverlayServer();
});

ipcMain.handle("test-vrclogger-api", async (event, apiConfig) => {
  try {
    const result = await testDashboardConnection(apiConfig);
    updateOverlayState({
      discordDisplayName: result.key && result.key.displayName
    });
    return result;
  } catch (error) {
    return {
      ok: false,
      status: error.status || 500,
      message: error.message
    };
  }
});

// Function to load `userid` from the database
async function loadUserId() {
  try {
    const config = await UserConfig.findOne();
    return config ? config.userid : null;
  } catch (error) {
    console.error(`Error loading UserID from database: ${error}`);
    return null;
  }
}

// Function to save `userid` in the database
async function saveUserId(userid) {
  try {
    // Check if there's already a config row in the table
    const existingConfig = await UserConfig.findOne();

    if (existingConfig) {
      // If found, update the `userid` field
      existingConfig.userid = userid;
      await existingConfig.save();
    } else {
      // If not found, create a new row with the `userid`
      const existingUserID = await UserConfig.findOne({
        where: { userid: "YOURIDHERE" }
      });
      if (!existingUserID) {
        await UserConfig.create({ userid });
      }
    }

    console.log("UserID saved successfully.");
  } catch (error) {
    console.error(`Error saving UserID to database: ${error}`);
  }
}

// IPC handler to load `userid` from the database
ipcMain.handle("load-userconfig", async () => {
  const userid = await loadUserId();
  return userid;
});

// IPC handler to save `userid` to the database
ipcMain.handle("save-userconfig", async (event, userid) => {
  await saveUserId(userid.userid);
});

ipcMain.handle("get-app-version", () => {
  return version;
});

let logQueue = [];

// Function to create the main window
function createWindow(callback) {
  const window = new BrowserWindow({
    width: 1070,
    height: 800,
    icon: path.join(__dirname, "assets", "icon.ico"), // Path to your icon file
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, // Secure context isolation
      enableRemoteModule: false,
      nodeIntegration: false // Avoid Node.js integration in renderer process
    }
  });

  window.loadFile(path.join(__dirname, "web", "index.html"));

  // Pass version using webContents
  window.webContents.on("did-finish-load", () => {
    window.webContents.send("app-version", version);
  });

  const didFinishLoadHandler = () => {
    try {
      callback(window);
      // Remove the listener after it's used
      window.webContents.removeListener(
        "did-finish-load",
        didFinishLoadHandler
      );
    } catch (error) {
      console.error("Error during did-finish-load:", error);
    }
  };

  window.webContents.on("did-finish-load", didFinishLoadHandler);
}

// Function to log messages to the renderer process
function log(message, level = "info", type = "mainlog") {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    const window = windows[0];
    window.webContents.executeJavaScript(`
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    type: '${type}',
                    message: \`${message}\`,
                    level: '${level}'
                }
            }));
        `);
  } else {
    logQueue.push({ message, level, type });
  }
}

app.on("ready", async () => {
  try {
    await initializeDatabase();
    startOverlayServer();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for DB setup

    createWindow(window => {
      logQueue.forEach(logItem =>
        log(logItem.message, logItem.level, logItem.type)
      );
      logQueue = [];
    });
  } catch (error) {
    console.error("Error during app ready:", error);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    try {
      await initializeDatabase();
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for DB setup

      createWindow(window => {
        logQueue.forEach(logItem =>
          log(logItem.message, logItem.level, logItem.type)
        );
        logQueue = [];
      });
    } catch (error) {
      console.error("Error during app activation:", error);
    }
  }
});

module.exports = {
  log,
  updateOverlayState
};
