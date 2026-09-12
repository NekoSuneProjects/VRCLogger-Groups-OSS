const main = require("../main.js");
const { fetchDashboardPublicJson } = require("../functions/vrcLoggerApiClient");

const SAFETY_LIST_CACHE_TTL_MS = 10 * 60 * 1000;

let cachedIpGrabberDomains = null;
let safetyListCacheExpiresAt = 0;

function normaliseDomain(domain) {
  return String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "");
}

async function loadIpGrabberDomains() {
  const now = Date.now();

  if (cachedIpGrabberDomains && safetyListCacheExpiresAt > now) {
    return cachedIpGrabberDomains;
  }

  const safetyList = await fetchDashboardPublicJson("/safetyjson.json");
  const domains = Array.isArray(safetyList.ipgrabber_domains)
    ? safetyList.ipgrabber_domains
    : [];

  cachedIpGrabberDomains = new Set(domains.map(normaliseDomain).filter(Boolean));
  safetyListCacheExpiresAt = now + SAFETY_LIST_CACHE_TTL_MS;

  return cachedIpGrabberDomains;
}

function getHostnameFromUrl(url) {
  try {
    return normaliseDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

function extractDomainFromLog(log) {
  const directUrlMatch = log.match(/https?:\/\/[^\s'",)]+/i);
  if (directUrlMatch) {
    return getHostnameFromUrl(directUrlMatch[0]);
  }

  const resolvingUrlMatch = log.match(/Attempting to resolve URL '([^']+)'/i);
  if (resolvingUrlMatch) {
    return getHostnameFromUrl(resolvingUrlMatch[1]);
  }

  return null;
}

function extractRequestedBy(log) {
  const requestedByMatch = log.match(/\brequested by\s+(.+)$/i);
  if (!requestedByMatch) {
    return null;
  }

  const displayName = requestedByMatch[1].trim().replace(/[,'"]+$/g, "");
  const timestampRegex = /^\d{2}:\d{2}:\d{2}$/;

  return displayName && !timestampRegex.test(displayName) ? displayName : null;
}

function getCurrentLogDate() {
  return new Date().toISOString().replace("T", " ").split(".")[0];
}

function createAlertMessage(displayName, domain) {
  const currentDate = getCurrentLogDate();
  const actor = displayName ? `User ${displayName}` : "Someone in Lobby";

  return `vrchat log - ${currentDate} [HIGH ALERT] - [IP-GRABBER] Warning: ${actor} used an IP grabber domain (${domain}) in the world!`;
}

async function IpGrabbedAlert(log) {
  try {
    const domain = extractDomainFromLog(log);

    if (!domain) {
      return;
    }

    const ipGrabberDomains = await loadIpGrabberDomains();
    if (!ipGrabberDomains.has(domain)) {
      return;
    }

    const alertMessage = createAlertMessage(extractRequestedBy(log), domain);
    main.log(alertMessage, "info", "modlog");
  } catch (err) {
    console.error(`Error in IpGrabbedAlert: ${err.message}`);
  }
}

module.exports = {
  IpGrabbedAlert
};
