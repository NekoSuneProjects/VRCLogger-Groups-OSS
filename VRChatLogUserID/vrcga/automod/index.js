const fs = require("fs");
const {
  LOGSCLASS,
  VRCGAPICheckGroupsBLPLClass
} = require("../../../Configfiles/logsclass.js");
const { sendToWebhook } = require("../../../webhook/index.js");
const main = require("../../../main.js");

const Speaker = require("speaker");
const Volume = require("pcm-volume"); // Install with: npm install pcm-volume

const getConfig = require("../../../functions/getConfig"); // Import the getConfig function

const {
  fetchDashboardJson,
  getVrcLoggerApiConfig,
  hasApiKey
} = require("../../../functions/vrcLoggerApiClient");

const { SendNotification } = require("../../../functions/Notications.js");

async function initializeConfig() {
  const Config = {
    Toggle: {
      CheckAutoMod: await getConfig("Toggle.CheckAutoMod"),
      VRNotify: await getConfig("Toggle.VRNotify"),
      TTSAutoMod: await getConfig("Toggle.TTSAutoMod"),
      BOSAlert: await getConfig("Toggle.BOSAlert")
    },
  };
  return Config;
}

const {
  getDeviceVoices,
  SayDeviceVoices
} = require("../../../functions/TTS.js");

async function automoduservrcgajoined(displayName, userId) {
  const Config = await initializeConfig(); // Fetch config settings from the database
  if (Config.Toggle.CheckAutoMod == true) {
    const apiConfig = await getVrcLoggerApiConfig();

    if (!hasApiKey(apiConfig))
      return main.log(
        "Enter your VRC Logger API key in Settings",
        "info",
        "blacklistlog"
      );

    if (!userId) {
      return; // or throw an error, depending on your requirements
    }

    fetchDashboardJson(`/api/client/automod/check/${encodeURIComponent(userId)}`, {
      apiConfig,
      throwOnApiStatus: false
    })
      .then(handleData)
      .catch(handleError);

    function handleResponse(response) {
      if (!response.ok) {
        if (response.status === 403) {
          return {
            status: 403,
            error: `API vrclogger AutoMod check - Requires ApiKey, Please Contact NekoSuneVR for ApiKey Access`
          };
        } else if (response.status === 401) {
          return {
            status: 401,
            error: `API vrclogger AutoMod check - Invalid ApiKey, Please check or contact NekoSuneVR`
          };
        } else if (response.status === 404) {
          return {
            status: 404,
            error: `API vrclogger AutoMod check - Warning User ${displayName} not found in any blacklist`
          };
        } else {
          console.log(
            `API vrclogger AutoMod check Failed to fetch data: ${response.status}`
          );
          throw new Error(
            `API vrclogger AutoMod check Failed to fetch data: ${response.status}`
          );
        }
      }
      return response.json();
    }

    function handleData(data) {
      if (data.status == 429) {
        main.log(
          `API vrclogger AutoMod check - ${data.message}`,
          "info",
          "blacklistlog"
        );
        const message = `API vrclogger AutoMod check - ${data.message}`;
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
        return; // or send a message to the webhook saying the user is not found
      }

      if (data.status == 404) {
        const message = `API vrclogger AutoMod check - Warning User ${displayName} not found in banned any blacklist`;
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
        return; // or send a message to the webhook saying the user is not found
      }

      if (data.status == 502) {
        const message = `API vrclogger AutoMod check - Warning User ${displayName} not found in banned any blacklist`;
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
        return; // or send a message to the webhook saying the user is not found
      }

      if (data.status == 403) {
        main.log(
          `API vrclogger AutoMod check - Invalid API key, Please Check APIKEY Correct`,
          "info",
          "blacklistlog"
        );
        const message = `API vrclogger AutoMod check - Invalid API key, Please Check APIKEY Correct`;
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
        return; // or send a message to the webhook saying the user is not found
      }

      if (data.status == 401) {
        main.log(
          `API vrclogger AutoMod check - Please enter Your API key, To Get APIKEY, Contact NekoSuneVR`,
          "info",
          "blacklistlog"
        );
        const message = `API vrclogger AutoMod check - Please enter Your API key, To Get APIKEY, Contact NekoSuneVR`;
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
        return; // or send a message to the webhook saying the user is not found
      }

      if (data.blacklisted === true) {
        const type = [];
        if (data.cyberbully) type.push("Cyberbully");
        if (data.crasher) type.push("Crasher");
        if (data.ripper) type.push("Ripper");
        if (data.troll) type.push("Troll");
        if (data.racism) type.push("Racism");
        if (data.clients) type.push("Clients");
        if (data.underaged) type.push("Underaged");

        let groupDetails = "";
        if (data.groups && Array.isArray(data.groups)) {
          groupDetails = data.groups
            .map(group => {
              const groupType = [];
              if (group.hostile) groupType.push("Hostile");
              if (group.crasher) groupType.push("Crasher");
              if (group.hateraid) groupType.push("Hateraid");
              if (group.ripper) groupType.push("Ripper");
              if (group.clients) groupType.push("Clients");
              if (group.troll) groupType.push("Troll");

              return `Group: ${group.name} (Reason: ${group.reason ||
                "Not specified"}, Type: ${groupType.join(", ") ||
                "Not specified"})`;
            })
            .join(", ");
        } else {
          groupDetails = "No group data available";
        }

        const Type = type.join(", ");
        const message = `API VRClogger - AutoMod ALERT: User ${data.displayName} connected. Reason: ${data.reason}, Type: ${Type}. This user has been blacklisted since ${data.date}, groups: ${groupDetails}`;
        const tts = `AutoMod ALERT: User ${data.displayName} connected. Reason: ${data.reason}, Type: ${Type}. This user has been blacklisted`;

        // Play alert for hostile or crasher users
        const isHostileOrCrasher = ["Crasher", "Clients"].some(keyword =>
          Type.includes(keyword)
        );

        if (Config.Toggle.VRNotify == true) {
          SendNotification("VRCLogger AutoMod Mode", tts, null);
        }

        if (Config.Toggle.BOSAlert) {
          if (isHostileOrCrasher) {
            async function PlayAudioAlert(volumeLevel = 0.5) {
              // Ensure volumeLevel is between 0.0 and 1.0
              if (volumeLevel < 0 || volumeLevel > 1) {
                console.error("Volume level must be between 0.0 and 1.0");
                return;
              }

              // Create a writable stream for the speaker
              const speaker = new Speaker({
                channels: 2, // Number of audio channels (stereo)
                bitDepth: 16, // Bit depth (16-bit audio)
                sampleRate: 44100 // Sample rate (44.1kHz)
              });

              // Create a volume control stream
              const volume = new Volume();
              volume.setVolume(volumeLevel); // Set the desired volume level (e.g., 0.5 for 50%)

              // Read the WAV file from the filesystem
              const fileStream = fs.createReadStream("./assets/alert.wav");

              // Pipe the wav file data through the volume control, then to the speaker
              fileStream.pipe(volume).pipe(speaker);

              // Event listener to log once audio finishes
              speaker.on("close", () => {
                console.log("Audio finished playing.");
              });

              // Handle errors
              fileStream.on("error", err => {
                console.error("Error reading file:", err);
              });
            }

            PlayAudioAlert(0.1);

            // Delay TTS execution if enabled
            if (Config.Toggle.TTSAutoMod === true) {
              setTimeout(() => {
                getDeviceVoices().then(list11 => {
                  SayDeviceVoices(tts, list11[0]);
                });
              }, 2500); // Adjust the delay time (in milliseconds) to match the duration of your alert audio
            }
          }
        } else if (Config.Toggle.TTSAutoMod === true) {
          getDeviceVoices().then(list11 => {
            SayDeviceVoices(tts, list11[0]);
          });
        }

        main.log(message, "info", "blacklistlog");
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
        sendToWebhook(message);
      } else if (data.watchlist === true) {
        const type = [];
        if (data.cyberbully) type.push("Cyberbully");
        if (data.crasher) type.push("Crasher");
        if (data.ripper) type.push("Ripper");
        if (data.troll) type.push("Troll");
        if (data.racism) type.push("Racism");
        if (data.clients) type.push("Clients");
        if (data.underaged) type.push("Underaged");

        let groupDetails = "";
        if (data.groups && Array.isArray(data.groups)) {
          groupDetails = data.groups
            .map(group => {
              const groupType = [];
              if (group.hostile) groupType.push("Hostile");
              if (group.crasher) groupType.push("Crasher");
              if (group.hateraid) groupType.push("Hateraid");
              if (group.ripper) groupType.push("Ripper");
              if (group.clients) groupType.push("Clients");
              if (group.troll) groupType.push("Troll");

              return `Group: ${group.name} (Reason: ${group.reason ||
                "Not specified"}, Type: ${groupType.join(", ") ||
                "Not specified"})`;
            })
            .join(", ");
        } else {
          groupDetails = "No group data available";
        }

        const Type = type.join(", ");
        const message = `API VRClogger - AutoMod Warning: User ${data.displayName} connected. Reason: ${data.reason}, Type: ${Type}. This user has been on the Watchlist since ${data.date}, groups: ${groupDetails}`;
        const tts = `Warning: User ${data.displayName} connected. Reason: ${data.reason}, Type: ${Type}. This user has been on the Watchlist`;

        // Play alert for hostile or crasher users
        const isHostileOrCrasher = ["Crasher", "Clients"].some(keyword =>
          Type.includes(keyword)
        );

        if (Config.Toggle.VRNotify == true) {
          SendNotification("VRCLogger AutoMod Mode", tts, null);
        }

        if (Config.Toggle.BOSAlert) {
          if (isHostileOrCrasher) {
            async function PlayAudioAlert(volumeLevel = 0.5) {
              // Ensure volumeLevel is between 0.0 and 1.0
              if (volumeLevel < 0 || volumeLevel > 1) {
                console.error("Volume level must be between 0.0 and 1.0");
                return;
              }

              // Create a writable stream for the speaker
              const speaker = new Speaker({
                channels: 2, // Number of audio channels (stereo)
                bitDepth: 16, // Bit depth (16-bit audio)
                sampleRate: 44100 // Sample rate (44.1kHz)
              });

              // Create a volume control stream
              const volume = new Volume();
              volume.setVolume(volumeLevel); // Set the desired volume level (e.g., 0.5 for 50%)

              // Read the WAV file from the filesystem
              const fileStream = fs.createReadStream("./assets/alert.wav");

              // Pipe the wav file data through the volume control, then to the speaker
              fileStream.pipe(volume).pipe(speaker);

              // Event listener to log once audio finishes
              speaker.on("close", () => {
                console.log("Audio finished playing.");
              });

              // Handle errors
              fileStream.on("error", err => {
                console.error("Error reading file:", err);
              });
            }

            PlayAudioAlert(0.1);

            // Delay TTS execution if enabled
            if (Config.Toggle.TTSAutoMod === true) {
              setTimeout(() => {
                getDeviceVoices().then(list11 => {
                  SayDeviceVoices(tts, list11[0]);
                });
              }, 2500); // Adjust the delay time (in milliseconds) to match the duration of your alert audio
            }
          }
        } else if (Config.Toggle.TTSAutoMod === true) {
          getDeviceVoices().then(list11 => {
            SayDeviceVoices(tts, list11[0]);
          });
        }

        main.log(message, "info", "blacklistlog");
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
        sendToWebhook(message);
      } else {
        var message = `API vrclogger AutoMod check - User ${displayName} not Found! in Blacklist`;
        main.log(
          `API vrclogger AutoMod check - User ${displayName} not Found! in Blacklist`,
          "info",
          "blacklistlog"
        );
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
      }
    }
  }

  function handleError(error) {
    console.error(error);
    const message = `API vrclogger automod check ${error}`;
    LOGSCLASS.writeErrorToFile(message);
  }
}

async function automoduservrcgajoinedGlobal(displayName, userId) {
  const Config = await initializeConfig(); // Fetch config settings from the database
  if (Config.Toggle.CheckAutoMod == true) {
    const apiConfig = await getVrcLoggerApiConfig();

    if (!hasApiKey(apiConfig))
      return main.log(
        "Enter your VRC Logger API key in Settings",
        "info",
        "blacklistlog"
      );

    if (!userId) {
      return; // or throw an error, depending on your requirements
    }

    fetchDashboardJson(`/api/client/automod/check/${encodeURIComponent(userId)}`, {
      apiConfig,
      throwOnApiStatus: false
    })
      .then(handleData)
      .catch(handleError);

    function handleResponse(response) {
      if (!response.ok) {
        if (response.status === 403) {
          return {
            status: 403,
            error: `Global API vrclogger AutoMod check - Requires ApiKey, Please Contact NekoSuneVR for ApiKey Access`
          };
        } else if (response.status === 401) {
          return {
            status: 401,
            error: `Global API vrclogger AutoMod check - Invalid ApiKey, Please check or contact NekoSuneVR`
          };
        } else if (response.status === 404) {
          return {
            status: 404,
            error: `Global API vrclogger AutoMod check - Warning User ${displayName} not found in any blacklist`
          };
        } else {
          console.log(
            `Global API vrclogger AutoMod check Failed to fetch data: ${response.status}`
          );
          throw new Error(
            `Global API vrclogger AutoMod check Failed to fetch data: ${response.status}`
          );
        }
      }
      return response.json();
    }

    function handleData(data) {
      if (data.status == 429) {
        main.log(
          `Global API vrclogger AutoMod check - ${data.message}`,
          "info",
          "blacklistlog"
        );
        const message = `Global API vrclogger AutoMod check - ${data.message}`;
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
        return; // or send a message to the webhook saying the user is not found
      }

      if (data.status == 404) {
        const message = `Global API vrclogger AutoMod check - Warning User ${displayName} not found in banned any blacklist`;
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
        return; // or send a message to the webhook saying the user is not found
      }

      if (data.status == 502) {
        const message = `Global API vrclogger AutoMod check - Warning User ${displayName} not found in banned any blacklist`;
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
        return; // or send a message to the webhook saying the user is not found
      }

      if (data.status == 403) {
        main.log(
          `Global API vrclogger AutoMod check - Invalid API key, Please Check APIKEY Correct`,
          "info",
          "blacklistlog"
        );
        const message = `Global API vrclogger AutoMod check - Invalid API key, Please Check APIKEY Correct`;
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
        return; // or send a message to the webhook saying the user is not found
      }

      if (data.status == 401) {
        main.log(
          `Global API vrclogger AutoMod check - Please enter Your API key, To Get APIKEY, Contact NekoSuneVR`,
          "info",
          "blacklistlog"
        );
        const message = `Global API vrclogger AutoMod check - Please enter Your API key, To Get APIKEY, Contact NekoSuneVR`;
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
        return; // or send a message to the webhook saying the user is not found
      }

      if (data.blacklisted === true) {
        const type = [];
        if (data.cyberbully) type.push("Cyberbully");
        if (data.crasher) type.push("Crasher");
        if (data.ripper) type.push("Ripper");
        if (data.troll) type.push("Troll");
        if (data.racism) type.push("Racism");
        if (data.clients) type.push("Clients");
        if (data.underaged) type.push("Underaged");

        let groupDetails = "";
        if (data.groups && Array.isArray(data.groups)) {
          groupDetails = data.groups
            .map(group => {
              const groupType = [];
              if (group.hostile) groupType.push("Hostile");
              if (group.crasher) groupType.push("Crasher");
              if (group.hateraid) groupType.push("Hateraid");
              if (group.ripper) groupType.push("Ripper");
              if (group.clients) groupType.push("Clients");
              if (group.troll) groupType.push("Troll");

              return `Group: ${group.name} (Reason: ${group.reason ||
                "Not specified"}, Type: ${groupType.join(", ") ||
                "Not specified"})`;
            })
            .join(", ");
        } else {
          groupDetails = "No group data available";
        }

        const Type = type.join(", ");
        const message = `API VRClogger - AutoMod ALERT: User ${data.displayName} connected. Reason: ${data.reason}, Type: ${Type}. This user has been blacklisted since ${data.date}, groups: ${groupDetails}`;
        const tts = `AutoMod ALERT: User ${data.displayName} connected. Reason: ${data.reason}, Type: ${Type}. This user has been blacklisted`;

        // Play alert for hostile or crasher users
        const isHostileOrCrasher = ["Crasher", "Clients"].some(keyword =>
          Type.includes(keyword)
        );

        if (Config.Toggle.VRNotify == true) {
          SendNotification("VRCLogger AutoMod Mode", tts, null);
        }

        if (Config.Toggle.BOSAlert) {
          if (isHostileOrCrasher) {
            async function PlayAudioAlert(volumeLevel = 0.5) {
              // Ensure volumeLevel is between 0.0 and 1.0
              if (volumeLevel < 0 || volumeLevel > 1) {
                console.error("Volume level must be between 0.0 and 1.0");
                return;
              }

              // Create a writable stream for the speaker
              const speaker = new Speaker({
                channels: 2, // Number of audio channels (stereo)
                bitDepth: 16, // Bit depth (16-bit audio)
                sampleRate: 44100 // Sample rate (44.1kHz)
              });

              // Create a volume control stream
              const volume = new Volume();
              volume.setVolume(volumeLevel); // Set the desired volume level (e.g., 0.5 for 50%)

              // Read the WAV file from the filesystem
              const fileStream = fs.createReadStream("./assets/alert.wav");

              // Pipe the wav file data through the volume control, then to the speaker
              fileStream.pipe(volume).pipe(speaker);

              // Event listener to log once audio finishes
              speaker.on("close", () => {
                console.log("Audio finished playing.");
              });

              // Handle errors
              fileStream.on("error", err => {
                console.error("Error reading file:", err);
              });
            }

            PlayAudioAlert(0.1);

            // Delay TTS execution if enabled
            if (Config.Toggle.TTSAutoMod === true) {
              setTimeout(() => {
                getDeviceVoices().then(list11 => {
                  SayDeviceVoices(tts, list11[0]);
                });
              }, 2500); // Adjust the delay time (in milliseconds) to match the duration of your alert audio
            }
          }
        } else if (Config.Toggle.TTSAutoMod === true) {
          getDeviceVoices().then(list11 => {
            SayDeviceVoices(tts, list11[0]);
          });
        }

        main.log(message, "info", "blacklistlog");
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
        sendToWebhook(message);
      } else if (data.watchlist === true) {
        const type = [];
        if (data.cyberbully) type.push("Cyberbully");
        if (data.crasher) type.push("Crasher");
        if (data.ripper) type.push("Ripper");
        if (data.troll) type.push("Troll");
        if (data.racism) type.push("Racism");
        if (data.clients) type.push("Clients");
        if (data.underaged) type.push("Underaged");

        let groupDetails = "";
        if (data.groups && Array.isArray(data.groups)) {
          groupDetails = data.groups
            .map(group => {
              const groupType = [];
              if (group.hostile) groupType.push("Hostile");
              if (group.crasher) groupType.push("Crasher");
              if (group.hateraid) groupType.push("Hateraid");
              if (group.ripper) groupType.push("Ripper");
              if (group.clients) groupType.push("Clients");
              if (group.troll) groupType.push("Troll");

              return `Group: ${group.name} (Reason: ${group.reason ||
                "Not specified"}, Type: ${groupType.join(", ") ||
                "Not specified"})`;
            })
            .join(", ");
        } else {
          groupDetails = "No group data available";
        }

        const Type = type.join(", ");
        const message = `API VRClogger - AutoMod Warning: User ${data.displayName} connected. Reason: ${data.reason}, Type: ${Type}. This user has been on the Watchlist since ${data.date}, groups: ${groupDetails}`;
        const tts = `Warning: User ${data.displayName} connected. Reason: ${data.reason}, Type: ${Type}. This user has been on the Watchlist`;

        // Play alert for hostile or crasher users
        const isHostileOrCrasher = ["Crasher", "Clients"].some(keyword =>
          Type.includes(keyword)
        );

        if (Config.Toggle.VRNotify == true) {
          SendNotification("VRCLogger AutoMod Mode", tts, null);
        }

        if (Config.Toggle.BOSAlert) {
          if (isHostileOrCrasher) {
            async function PlayAudioAlert(volumeLevel = 0.5) {
              // Ensure volumeLevel is between 0.0 and 1.0
              if (volumeLevel < 0 || volumeLevel > 1) {
                console.error("Volume level must be between 0.0 and 1.0");
                return;
              }

              // Create a writable stream for the speaker
              const speaker = new Speaker({
                channels: 2, // Number of audio channels (stereo)
                bitDepth: 16, // Bit depth (16-bit audio)
                sampleRate: 44100 // Sample rate (44.1kHz)
              });

              // Create a volume control stream
              const volume = new Volume();
              volume.setVolume(volumeLevel); // Set the desired volume level (e.g., 0.5 for 50%)

              // Read the WAV file from the filesystem
              const fileStream = fs.createReadStream("./assets/alert.wav");

              // Pipe the wav file data through the volume control, then to the speaker
              fileStream.pipe(volume).pipe(speaker);

              // Event listener to log once audio finishes
              speaker.on("close", () => {
                console.log("Audio finished playing.");
              });

              // Handle errors
              fileStream.on("error", err => {
                console.error("Error reading file:", err);
              });
            }

            PlayAudioAlert(0.1);

            // Delay TTS execution if enabled
            if (Config.Toggle.TTSAutoMod === true) {
              setTimeout(() => {
                getDeviceVoices().then(list11 => {
                  SayDeviceVoices(tts, list11[0]);
                });
              }, 2500); // Adjust the delay time (in milliseconds) to match the duration of your alert audio
            }
          }
        } else if (Config.Toggle.TTSAutoMod === true) {
          getDeviceVoices().then(list11 => {
            SayDeviceVoices(tts, list11[0]);
          });
        }

        main.log(message, "info", "blacklistlog");
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
        sendToWebhook(message);
      } else {
        var message = `API vrclogger AutoMod check - User ${displayName} not Found! in Blacklist`;
        main.log(
          `Global API vrclogger AutoMod check - User ${displayName} not Found! in Blacklist`,
          "info",
          "blacklistlog"
        );
        VRCGAPICheckGroupsBLPLClass.writeModerationToFile(message);
      }
    }
  }

  function handleError(error) {
    console.error(error);
    const message = `Global API vrclogger automod check ${error}`;
    LOGSCLASS.writeErrorToFile(message);
  }
}

module.exports = {
  automoduservrcgajoined,
  automoduservrcgajoinedGlobal
};
