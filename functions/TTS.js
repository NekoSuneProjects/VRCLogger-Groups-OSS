const fs = require("fs");
const path = require("path");
const player = require("play-sound")((opts = {}));
const say = require("say");

const { LOGSCLASS } = require("../Configfiles/logsclass.js");

let ttsQueue = [];
let isProcessing = false; // Lock to prevent overlapping TTS processes
let musicMetadataPromise = null;

async function getMusicMetadata() {
  if (!musicMetadataPromise) {
    musicMetadataPromise = import("music-metadata");
  }

  return musicMetadataPromise;
}

function getDeviceVoices() {
  return new Promise(resolve => {
    say.getInstalledVoices((err, voice) => {
      return resolve(voice);
    });
  });
}

function SayDeviceVoices(text, model) {
  ttsQueue.push({ text, model });
  processQueue();
}

async function processQueue() {
  if (isProcessing || ttsQueue.length === 0) return; // Return if already processing or queue is empty
  isProcessing = true; // Acquire lock

  const { text, model } = ttsQueue.shift(); // Dequeue the next item

  try {
    await speakText(text, model); // Process the current TTS request
  } catch (err) {
    console.error("Error processing TTS:", err);
    LOGSCLASS.writeErrorToFile(`Error processing TTS: ${err}`);
  } finally {
    isProcessing = false; // Release lock
    if (ttsQueue.length > 0) {
      processQueue(); // Process next in queue
    }
  }
}

function speakText(text, model) {
  return new Promise(resolve => {
    say.speak(text, model, 0.9, () => {
      resolve(); // Resolve the promise once speech is done
    });
  });
}

async function playAndDeleteAudio(base64Audio) {
  try {
    // Decode the Base64 data
    const audioBuffer = Buffer.from(base64Audio, "base64");

    // Define the output path
    const outputPath = path.join(__dirname, "output.mp3");

    // Write the decoded audio data to a file
    await fs.promises.writeFile(outputPath, audioBuffer);

    // Extract metadata to get the duration
    const mm = await getMusicMetadata();
    const metadata = await mm.parseFile(outputPath);
    const duration = metadata.format.duration * 1000; // duration in milliseconds

    // Play the audio file
    await new Promise((resolve, reject) => {
      player.play(outputPath, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // Delete the file after playback
    setTimeout(() => {
      fs.unlink(outputPath, err => {
        if (err) {
          console.error("TTS Error deleting file:", err);
          LOGSCLASS.writeErrorToFile(`TTS Error deleting file: ${err}`);
        } else {
          console.log("TTS File deleted successfully.");
        }
      });
    }, duration);
  } catch (err) {
    console.error("TTS Error processing audio:", err);
    LOGSCLASS.writeErrorToFile(`TTS Error processing audio: ${err}`);
  }
}

module.exports = {
  getDeviceVoices,
  SayDeviceVoices
};
