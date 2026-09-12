const fs = require("fs");
const { LOGSCLASS } = require("../../../Configfiles/logsclass.js");
const sqlite3 = require("sqlite3");
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
      CheckUser: await getConfig("Toggle.CheckUser"),
      VRNotify: await getConfig("Toggle.VRNotify"),
      TTSBL: await getConfig("Toggle.TTSBL"),
      BOSAlert: await getConfig("Toggle.BOSAlert")
    },
  };
  return Config;
}

const {
  getDeviceVoices,
  SayDeviceVoices
} = require("../../../functions/TTS.js");

async function blacklistvrcgajoined(displayName, userId) {
  const Config = await initializeConfig(); // Fetch config settings from the database

  if (Config.Toggle.CheckUser == true) {
    const apiConfig = await getVrcLoggerApiConfig();

    if (!hasApiKey(apiConfig)) {
      return main.log(
        "Enter your VRC Logger API key in Settings",
        "info",
        "blacklistlog"
      );
    }

    if (!userId) {
      return; // or throw an error, depending on your requirements
    }

    fetchDashboardJson(`/api/client/check/${encodeURIComponent(userId)}`, {
      apiConfig,
      throwOnApiStatus: false
    })
      .then(handleData)
      .catch(handleError);

    function handleResponse(response) {
      if (!response.ok) {
        if (response.status === 404) {
          return {
            status: 404,
            error: `404`
          };
        } else {
          console.log(`API vrclogger Failed to fetch data: ${response.status}`);
          throw new Error(
            `API vrclogger Failed to fetch data: ${response.status}`
          );
        }
      }
      return response.json();
    }

    function handleData(data) {
      if (data.blacklisted === true) {
        const type = [];
        if (data.cyberbully) type.push("Cyberbully");
        if (data.crasher) type.push("Crasher");
        if (data.ripper) type.push("Ripper");
        if (data.troll) type.push("Troll");
        if (data.clients) type.push("Clients");
        if (data.banned) type.push("Banned");
        if (data.racism) type.push("Racism");
        if (data.underaged) type.push("Underaged");

        const Type = type.join(", ") || "No flags"; // Default to "No flags" if empty

        const displayName = data.displayName || "Unknown User";
        const reason = data.reason || "No reason provided";
        const date = data.date || "Unknown date";
        const message = `API VRClogger - ALERT: User ${displayName} connected. Reason: ${reason}, Type: ${Type}. This user has been blacklisted since ${date}`;
        const tts = `ALERT: User ${data.displayName} connected. Reason: ${data.reason}, Type: ${Type}. This user has been blacklisted`;

        // Play alert for hostile or crasher users
        const isHostileOrCrasher = ["Crasher", "Clients"].some(keyword =>
          Type.includes(keyword)
        );

        if (Config.Toggle.VRNotify == true) {
          SendNotification("VRCLogger", tts, null);
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
            if (Config.Toggle.TTSBL === true) {
              setTimeout(() => {
                getDeviceVoices().then(list11 => {
                  SayDeviceVoices(tts, list11[0]);
                });
              }, 2500); // Adjust the delay time (in milliseconds) to match the duration of your alert audio
            }
          }
        } else if (Config.Toggle.TTSBL === true) {
          getDeviceVoices().then(list11 => {
            SayDeviceVoices(tts, list11[0]);
          });
        }

        main.log(message, "info", "blacklistlog");
      } else if (data.watchlist === true) {
        const type = [];
        if (data.cyberbully) type.push("Cyberbully");
        if (data.crasher) type.push("Crasher");
        if (data.ripper) type.push("Ripper");
        if (data.troll) type.push("Troll");
        if (data.clients) type.push("Clients");
        if (data.banned) type.push("Banned");
        if (data.racism) type.push("Racism");
        if (data.underaged) type.push("Underaged");

        const Type = type.join(", ") || "No flags"; // Default to "No flags" if empty

        const displayName = data.displayName || "Unknown User";
        const reason = data.reason || "No reason provided";
        const date = data.date || "Unknown date";
        const message = `API VRClogger - Warning: User ${displayName} connected. Reason: ${reason}, Type: ${Type}. This user has been on the Watchlist since ${date}`;
        const tts = `Warning: User ${data.displayName} connected. Reason: ${data.reason}, Type: ${Type}. This user has been on the Watchlist`;

        // Play alert for hostile or crasher users
        const isHostileOrCrasher = ["Crasher", "Clients"].some(keyword =>
          Type.includes(keyword)
        );

        if (Config.Toggle.VRNotify == true) {
          SendNotification("VRCLogger", tts, null);
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
            if (Config.Toggle.TTSBL === true) {
              setTimeout(() => {
                getDeviceVoices().then(list11 => {
                  SayDeviceVoices(tts, list11[0]);
                });
              }, 2500); // Adjust the delay time (in milliseconds) to match the duration of your alert audio
            }
          }
        } else if (Config.Toggle.TTSBL === true) {
          getDeviceVoices().then(list11 => {
            SayDeviceVoices(tts, list11[0]);
          });
        }

        main.log(message, "info", "blacklistlog");
      }
    }

    function handleError(error) {
      console.error(error);
      LOGSCLASS.writeErrorToFile(error);
    }
  }
}

module.exports = {
  blacklistvrcgajoined
};
