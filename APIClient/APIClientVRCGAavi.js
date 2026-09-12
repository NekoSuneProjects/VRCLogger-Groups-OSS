const { LOGSCLASS } = require("../Configfiles/logsclass.js");
const { fetchDashboardPublicJson } = require("../functions/vrcLoggerApiClient");

class APIClientVRCGAavi {
  static CrasherAvatar = [];
  static RipperAvatar = [];

  static async downloadJson(route) {
    try {
      return await fetchDashboardPublicJson(route);
    } catch (error) {
      LOGSCLASS.writeErrorToFile(error);
      console.log(`vrclogger dl error stack: ${error}`);
      throw error;
    }
  }

  static async fetchListsBlackList() {
    try {
      const blacklistAvisData = await this.downloadJson(
        "/v5/games/api/vrchat/yoinker/avatarblacklist"
      );

      if (blacklistAvisData.error) {
        return blacklistAvisData.error;
      }

      // Clear existing data in the arrays
      this.CrasherAvatar = [];
      this.RipperAvatar = [];

      if (blacklistAvisData && blacklistAvisData.length > 0) {
        for (const user of blacklistAvisData) {
          if (user.crasher) {
            this.CrasherAvatar.push({
              displayName: user.displayName,
              avatarId: user.avatarId,
              userId: user.userId,
              date: user.date
            });
          }

          if (user.ripper) {
            this.RipperAvatar.push({
              displayName: user.displayName,
              avatarId: user.avatarId,
              userId: user.userId,
              date: user.date
            });
          }
        }
      }
    } catch (error) {
      LOGSCLASS.writeErrorToFile(error);
      console.log(`vrclogger list error stack: ${error}`);
    }
  }
}

module.exports = {
  APIClientVRCGAavi
};
