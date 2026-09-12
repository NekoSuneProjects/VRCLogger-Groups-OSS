const fs = require("fs");
const path = require("path");

class LOGSCLASS {
  static async writeErrorToFile(error) {
    const { logpath } = require("./config.js");
    const errorlog = path.join(logpath, "error.log");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(errorlog, `${timestamp} - ${error}\n`);
  }
}
class ErroravataruploadCLASS {
  static async writeErrorToFile(error) {
    const { logpath } = require("./config.js");
    const errorlog = path.join(logpath, "erroravatarupload.log");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(errorlog, `${timestamp} - ${error}\n`);
  }
}

class ModClass {
  static async writeModerationToFile(formattedLogMessage) {
    const { logpath } = require("./config.js");
    const Moderationlog = path.join(logpath, "Moderation_new.log");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(Moderationlog, `${timestamp} - ${formattedLogMessage}\n`);
  }
}

class ModResetShowUserAvatarClass {
  static async writeModerationResetShowUserAvatarToFile(formattedLogMessage) {
    const { logpath } = require("./config.js");
    const Moderationlog = path.join(
      logpath,
      "Moderation_ResetShowUserAvatar.log"
    );
    const timestamp = new Date().toISOString();
    fs.appendFileSync(Moderationlog, `${timestamp} - ${formattedLogMessage}\n`);
  }
}

class VRCGAPICheckGroupsBLPLClass {
  static async writeModerationToFile(message) {
    const { logpath } = require("./config.js");
    const CheckGroupsBLPLlog = path.join(logpath, "CheckGroupsBLPL.log");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(CheckGroupsBLPLlog, `${timestamp} - ${message}\n`);
  }
}

class UIPageShown {
  static async writeModerationToFile(formattedLogMessage) {
    const { logpath } = require("./config.js");
    const UIPageShownlog = path.join(logpath, "UIPageShown.log");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(
      UIPageShownlog,
      `${timestamp} - ${formattedLogMessage}\n`
    );
  }
}

class AVISwitchingClass {
  static async writeModerationToFile(formattedLogMessage) {
    const { logpath } = require("./config.js");
    const AviSwitchinglog = path.join(logpath, "AviSwitching.log");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(
      AviSwitchinglog,
      `${timestamp} - ${formattedLogMessage}\n`
    );
  }
}

class PlayerClass {
  static async writeplayerToFile(formattedLogMessage) {
    const { logpath } = require("./config.js");
    const playerlog = path.join(logpath, "player.log");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(playerlog, `${timestamp} - ${formattedLogMessage}\n`);
  }
}

class VRCGAPICheckUsersBLPLClass {
  static async writeModerationToFile(message) {
    const { logpath } = require("./config.js");
    const CheckUserBLPL = path.join(logpath, "CheckUserBLPL.log");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(CheckUserBLPL, `${timestamp} - ${message}\n`);
  }
}

class VRCAssetsLoggerCSVCLASS {
  static async writeAssetLogToFile(url, type, timestamp, data) {
    const { logpath } = require("./config.js");
    const errorlog = path.join(logpath, "assetlog.csv");
    const userId = data[1] || data.ownerId;
    const displayName = data[2] || data.ownerName;
    const logEntry = `${type},${timestamp},${userId},${displayName},${url}\n`;
    fs.appendFileSync(errorlog, logEntry);
  }
}

class VRCAssetsLoggerJSONCLASS {
  static async writeAssetLogToFile(data) {
    const { logpath } = require("./config.js");
    const logFileJSON = path.join(logpath, "assetlog.json");
    // Read existing logs
    fs.readFile(logFileJSON, "utf8", (err, content) => {
      const logs = err ? [] : JSON.parse(content || "[]");

      // Append new log entry
      logs.push(data);

      // Save JSON file with the updated logs
      fs.writeFile(logFileJSON, JSON.stringify(logs, null, 2), (err) => {
          if (err) console.error("Error saving JSON log:", err);
      });
    });
  }
}


module.exports = {
  LOGSCLASS,
  ErroravataruploadCLASS,
  PlayerClass,
  ModClass,
  UIPageShown,
  AVISwitchingClass,
  VRCGAPICheckGroupsBLPLClass,
  VRCGAPICheckUsersBLPLClass,
  ModResetShowUserAvatarClass,
  VRCAssetsLoggerJSONCLASS,
  VRCAssetsLoggerCSVCLASS
};
