const {
  XSOverlay,
  OVRToolkit,
  WindowsNotifications
} = require("vrnotications");

const {
  checkOVRToolkit,
  checkXSOverlay,
  checkSteamVR
} = require("./checkProcesses");

let notificationQueue = [];

let intervalId = null;

function SendNotification(title, text, image = null) {
  notificationQueue.push({ title, text, image });
  startInterval();
}

function playNextInQueue() {
  if (notificationQueue.length === 0) return; // No more items in the queue
  const { title, text, image } = notificationQueue.shift(); // Dequeue the next item
  SendAlert(title, text, image);
}

function startInterval() {
  if (intervalId) return; // Interval already started
  intervalId = setInterval(playNextInQueue, 30000); // Play next notification every 5 seconds
}

function stopInterval() {
  if (!intervalId) return; // Interval not started
  clearInterval(intervalId);
  intervalId = null;
}

async function SendAlert(title, text, image = null) {
  const isOVRToolkitRunning = await checkOVRToolkit();
  const isXSOverlayRunning = await checkXSOverlay();
  const isSteamVRRunning = await checkSteamVR();

  if (isSteamVRRunning) {
    if (isOVRToolkitRunning) {
      const ovrToolkit = new OVRToolkit();
      ovrToolkit.sendNotification(title, text);
    } else if (isXSOverlayRunning) {
      const xsOverlay = new XSOverlay();
      xsOverlay.sendNotification({
        title: title,
        content: text
      });
    } else {
      const windowsNotifications = new WindowsNotifications();
      windowsNotifications.sendNotification(title, text, image);
    }
  } else {
    const windowsNotifications = new WindowsNotifications();
    windowsNotifications.sendNotification(title, text, image);
  }
}

module.exports = {
  SendNotification
};
