const main = require("../main.js");
const getConfig = require("./getConfig"); // Import the getConfig function

const {
  fetchDashboardJson,
  getVrcLoggerApiConfig,
  hasApiKey
} = require("./vrcLoggerApiClient");

function formatSize(sizeInBytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  while (sizeInBytes >= 1024 && index < units.length - 1) {
    sizeInBytes /= 1024;
    index++;
  }
  return sizeInBytes.toFixed(2) + " " + units[index];
}

async function initializeConfig() {
  const Config = {
    Toggle: {
      AviAnalysisStats: await getConfig("Toggle.AviAnalysisStats")
    },
  };
  return Config;
}

let queue = []; // The queue to hold the file IDs and versions
let isProcessing = false; // Flag to track if processing is in progress

// Function to add items to the queue
function fetchVRChatAnalysisStats(fileid, fileversion) {
  queue.push({ fileid, fileversion });
  processQueue();
}

// Function to process the queue
async function processQueue() {
  // If already processing, wait until the current process finishes
  if (isProcessing) {
    console.log('Currently processing, will try again later.');
    return;
  }

  // If the queue is empty, do nothing
  if (queue.length === 0) {
    //console.log('No requests to process.');
    return;
  }

  // Set the flag to indicate processing is in progress
  isProcessing = true;

  // Dequeue the first request
  const { fileid, fileversion } = queue.shift();

  try {
    // Process the file request
    await fetchVRChatAnalysisStatsAPI(fileid, fileversion);
  } catch (error) {
    console.error('Error processing file:', error);
  } finally {
    // Reset the flag and wait for the next one
    isProcessing = false;
    console.log('Finished processing, waiting for the next request.');
    
    // Wait for 1 minute before processing the next request
    setTimeout(processQueue, 60000);
  }
}

function formatTimestamp() {
    const timestamp = Math.round(Date.now() / 1000);
  
    // Create a Date object from the timestamp
    const date = new Date(timestamp * 1000); // Convert to milliseconds
  
    // Extract the day, month, year, hours, minutes, and seconds
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
  
    // Format the date in dd/mm/yyyy hh:mm:ss
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  }
  
  // Example usage:
  const formattedDate = formatTimestamp();
  console.log(formattedDate);
  

async function fetchVRChatAnalysisStatsAPI(fileid, fileversion) {
  const Config = await initializeConfig(); // Fetch config settings from the database

  if (Config.Toggle.AviAnalysisStats == true) {
    const apiConfig = await getVrcLoggerApiConfig();

    if (!hasApiKey(apiConfig)) {
      return main.log(
        "Enter your VRC Logger API key in Settings",
        "info",
        "blacklistlog"
      );
    }

    if (!fileid) {
      return;
    }

    const urlencoded = new URLSearchParams();
    urlencoded.append("fileId", `${fileid}`);
    urlencoded.append("fileVersion", `${fileversion}`);

    fetchDashboardJson("/safety/avataranalysis", {
      apiConfig,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: urlencoded
    })
      .then(handleData)
      .catch(handleError);

    function handleData(data) {
      if (!data || data.status === 401 || data.status === 403 || data.status === 429 || data.status === 500) {
        const message = `API vrclogger avatar analysis - ${data && (data.message || data.error) || "Request failed"}`;
        main.log(message, "info", "blacklistlog");
        LOGSCLASS.writeErrorToFile(message);
        return;
      }

      const timestamp = formatTimestamp();
      // Format sizes
      const fileSize = formatSize(data.data.fileSize);
      const uncompressedSize = formatSize(data.data.uncompressedSize);

      // Create the message for logging
      const avatarStats = data.data.avatarStats;
      const message = JSON.stringify({
        event: "avatarStats",
        fileId: fileid,
        fileVersion: fileversion,
        timestamp,
        fileSize,
        uncompressedSize,
        performanceRating: data.data.performanceRating,
        avatarStats
      });

      main.log(message, "info", "avatarlog");
    }

    function handleError(error) {
      console.error(error);
      LOGSCLASS.writeErrorToFile(error);
    }
  }
}

module.exports = {
  fetchVRChatAnalysisStats
};
