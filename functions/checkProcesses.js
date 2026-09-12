const findProcess = require("find-process");

async function checkProcess(processName) {
  try {
    const list = await findProcess("name", processName);
    return list.length > 0;
  } catch (error) {
    console.error("Error finding process:", error);
    return false;
  }
}

async function checkOVRToolkit() {
  return checkProcess("OVRToolkit");
}

async function checkXSOverlay() {
  return checkProcess("XSOverlay");
}

async function checkSteamVR() {
  return checkProcess("SteamVR");
}

module.exports = { checkOVRToolkit, checkXSOverlay, checkSteamVR };
