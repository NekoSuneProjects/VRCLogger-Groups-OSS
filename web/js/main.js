var version = "1.0.0"; // Version of the application
document.title = `VRCLogger Monitor v${version}`;

// Predefined log container elements
const logsDivMain = document.getElementById("mainLogContent");
const logsDivJoinLeave = document.getElementById("joiningLeavingContent");
const logsDivModLogs = document.getElementById("moderationLogsContent");

const logsDivBlacklist = document.getElementById("detectKnownBlacklistContent");

const logsDivAvatarSwitch = document.getElementById("avatarSwitchContent");

const logsDivassets = document.getElementById("assetsContent");

function displayImageFullscreen(imageSrc) {
  const modal = document.createElement("div");
  modal.classList.add("image-modal");

  const modalContent = document.createElement("div");
  modalContent.classList.add("modal-content");

  const closeButton = document.createElement("button");
  closeButton.textContent = "X";
  closeButton.classList.add("close-button");
  closeButton.onclick = () => modal.remove();

  const fullImage = document.createElement("img");
  fullImage.src = imageSrc;
  fullImage.classList.add("full-image");

  modalContent.appendChild(closeButton);
  modalContent.appendChild(fullImage);
  modal.appendChild(modalContent);

  document.body.appendChild(modal);
}

const requestQueue = [];
let isProcessing = false;
const requestDelay = 10 * 1000; // 10 seconds delay

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;

  isProcessing = true;
  while (requestQueue.length > 0) {
    const printId = requestQueue.shift(); // Get the next request
    await fetchPrintImage(printId);
    await new Promise(resolve => setTimeout(resolve, requestDelay)); // Wait before next request
  }
  isProcessing = false;
}

async function fetchPrintImage(printId) {
  try {
    const apiUrl = await window.api.getApiEndpoint(); // Get API URL from main process
    const response = await fetch(`${apiUrl}/v5/games/api/vrchat/yoinker/getPrints/${printId}`, {
      headers: { Accept: "application/json" }
    });
    const data = await response.json();
    imageUrl = data.data.files.image;
    displayImage(imageUrl, "Print", Date.now(), data.data);
  } catch (error) {
    console.error("Error fetching print image:", error);
  }
}

function queueFetchPrintImage(printId) {
  requestQueue.push(printId);
}

// ✅ Process queue every 10 seconds
setInterval(async () => {
  if (requestQueue.length > 0) {
    const printId = requestQueue.shift(); // Get next request
    await fetchPrintImage(printId);
  }
}, requestDelay);

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-based
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

async function displayImage(url, type, timestamp, data) {
  const tableRow = document.createElement("tr");

  const typeCell = document.createElement("td");
  typeCell.textContent = type;

  const timestampCell = document.createElement("td");
  timestampCell.textContent = formatTimestamp(timestamp);

  const userIdCell = document.createElement("td");
  userIdCell.textContent = data[1] || data.ownerId;

  const displayNameCell = document.createElement("td");
  displayNameCell.textContent = data[2] || data.ownerName;

  const imageCell = document.createElement("td");
  if (url) {
    const image = document.createElement("img");
    image.src = url;
    image.title = data.assetId || "";
    image.classList.add("log-image");
    image.style.maxWidth = "50px"; // Reduce image size
    image.style.height = "50px"; // Maintain aspect ratio
    image.onclick = () => displayImageFullscreen(url);
    imageCell.appendChild(image);
  } else {
    imageCell.textContent = data.statusMessage
      ? `${data.statusMessage} (${data.assetId || "unknown"})`
      : data.assetId
      ? `No image available (${data.assetId})`
      : "No image available";
  }

  tableRow.appendChild(typeCell);
  tableRow.appendChild(timestampCell);
  tableRow.appendChild(userIdCell);
  tableRow.appendChild(displayNameCell);
  tableRow.appendChild(imageCell);

  const tableBody = document.getElementById("assetsTableBody");
  tableBody.prepend(tableRow); // Insert latest entries at the top

  const userId = data[1] || data.ownerId || "Uknown";
  const displayName = data[2] || data.ownerName || "Uknown";

  // Auto-scroll to the bottom
  tableBody.scrollTop = tableBody.scrollHeight;
}

window.addEventListener("message", (event) => {
  console.log("Received message:", event.data); // Debugging log
  let logElement;
  
  switch (event.data.type) {
    case "mainlog":
      if (!logsDivMain) {
        console.error("logsDivMain is null");
        return;
      }
      logElement = document.createElement("p");
      logElement.innerHTML = event.data.message;
      logsDivMain.appendChild(logElement);
      logsDivMain.scrollTop = logsDivMain.scrollHeight;
      break;

    case "joinleavelog":
      if (!logsDivJoinLeave) {
        console.error("logsDivJoinLeave is null");
        return;
      }
      logElement = document.createElement("p");
      logElement.innerHTML = event.data.message;
      logsDivJoinLeave.appendChild(logElement);
      logsDivJoinLeave.scrollTop = logsDivJoinLeave.scrollHeight;
      break;

    case "modlog":
      if (!logsDivModLogs) {
        console.error("logsDivModLogs is null");
        return;
      }
      logElement = document.createElement("p");
      logElement.innerHTML = event.data.message;
      logsDivModLogs.appendChild(logElement);
      logsDivModLogs.scrollTop = logsDivModLogs.scrollHeight;

      const printMatch = event.data.message.match(/API Requested print file\s+(prnt_[\w-]+)/);
      const stickerMatch = event.data.message.match(/\[?StickersManager\]?.*?User\s+(usr_[\w-]+)\s+\((.*?)\)\s+spawned\s+sticker\s+((?:file|inv)_[\w-]+)/);

      if (printMatch) {
        queueFetchPrintImage(printMatch[1]);
      } else if (stickerMatch) {
        fetchStickerImage(stickerMatch[3], stickerMatch[1], stickerMatch[2]);
      }
      break;

    case "avatarswitchlog":
      if (!logsDivAvatarSwitch) {
        console.error("logsDivAvatarSwitch is null");
        return;
      }
      logElement = document.createElement("p");
      logElement.innerHTML = event.data.message;
      logsDivAvatarSwitch.appendChild(logElement);
      logsDivAvatarSwitch.scrollTop = logsDivAvatarSwitch.scrollHeight;
      break;

    case "blacklistlog":
      if (!logsDivBlacklist) {
        console.error("logsDivBlacklist is null");
        return;
      }
      logElement = document.createElement("p");
      logElement.innerHTML = event.data.message;
      logsDivBlacklist.appendChild(logElement);
      logsDivBlacklist.scrollTop = logsDivBlacklist.scrollHeight;
      break;

    default:
      console.warn("Unknown log type:", event.data.type);
      break;
  }
});


const cacheOptions = {};
const directoriesOptions = {};
const vrcxOptions = {};
const toggleOptions = {};
const privacyandsafetyOptions = {};
const savedUserConfig = "";
const ApiKeysOptions = {};
const vrcLoggerApiOptions = {};
const vrcLoggerAuthorizedGroups = [];

const DEFAULT_VRCLOGGER_HEADER_NAME = "vrclogger-api-key";

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function maskApiKey(apiKey) {
  const value = String(apiKey || "");
  return value ? `${value.slice(0, 8)}...` : "";
}

function parseApiHeaderLine(headerLine) {
  const value = String(headerLine || "").trim();
  const separatorIndex = value.indexOf(":");

  if (!value) {
    return {};
  }

  if (separatorIndex === -1) {
    return { apiKey: value };
  }

  return {
    headerName: value.slice(0, separatorIndex).trim(),
    apiKey: value.slice(separatorIndex + 1).trim()
  };
}

function isConfiguredApiKey(apiKey) {
  return Boolean(
    apiKey &&
      apiKey !== "ENTERYOURAUTOMODKEY" &&
      !String(apiKey).startsWith("ENTERYOUR")
  );
}

function getInitialVrcLoggerApiConfig(savedConfig) {
  const legacyApiKeys = savedConfig.ApiKeys || {};
  const current = savedConfig.VRCLoggerApi || {};
  const legacyApiKey = isConfiguredApiKey(legacyApiKeys.Auto_Mod_Check)
    ? legacyApiKeys.Auto_Mod_Check
    : "";

  return {
    dashboardBaseUrl: current.dashboardBaseUrl || current.dashboardEndpointUrl || legacyApiKeys.ApiEndpointUrL || "",
    apiKey: current.apiKey || legacyApiKey || "",
    headerName: current.headerName || DEFAULT_VRCLOGGER_HEADER_NAME,
    groupId: current.groupId || ""
  };
}

function getVrcLoggerApiConfigFromInputs() {
  const headerLine = document.getElementById("vrcLoggerHeaderLine");
  const parsedHeader = parseApiHeaderLine(headerLine ? headerLine.value : "");

  vrcLoggerApiOptions.dashboardBaseUrl = trimTrailingSlash(
    document.getElementById("vrcLoggerDashboardBaseUrl").value
  );
  vrcLoggerApiOptions.headerName =
    parsedHeader.headerName ||
    vrcLoggerApiOptions.headerName ||
    DEFAULT_VRCLOGGER_HEADER_NAME;
  vrcLoggerApiOptions.apiKey = parsedHeader.apiKey || vrcLoggerApiOptions.apiKey || "";
  const groupSelect = document.getElementById("vrcLoggerGroupId");
  if (groupSelect) {
    vrcLoggerApiOptions.groupId = groupSelect.value;
  }

  if (headerLine) {
    headerLine.value = "";
  }

  return vrcLoggerApiOptions;
}

// Show warning modal with a custom message
function showWarningModal(message) {
  document.getElementById("warningModalBody").textContent = message;
  const warningModal = new bootstrap.Modal(
    document.getElementById("warningModal")
  );

  warningModal.show(); /* Show the modal */
}

// Load configuration from main process
async function loadConfig() {
  try {
    const savedConfig = await window.api.loadConfig();

    // Ensure proper merging of configuration data
    Object.assign(toggleOptions, savedConfig.Toggle || {});
    Object.assign(ApiKeysOptions, savedConfig.ApiKeys || {});
    Object.assign(vrcLoggerApiOptions, getInitialVrcLoggerApiConfig(savedConfig));
    Object.assign(privacyandsafetyOptions, savedConfig.PrivacyandSafety || {});
    Object.assign(vrcxOptions, savedConfig.vrcx || {});
    Object.assign(directoriesOptions, savedConfig.Directories || {});
    Object.assign(cacheOptions, savedConfig.cache || {});

    renderVrcLoggerApiOptions();
    renderOverlayUrl();
    renderSafetyToggleOptions();
    renderToggleOptions();
  } catch (error) {
    console.error("Failed to load config:", error);
  }
}

// Save configuration to main process
async function saveConfig() {
  const config = {
    cache: cacheOptions,
    Directories: directoriesOptions,
    vrcx: vrcxOptions,
    Toggle: toggleOptions,
    PrivacyandSafety: privacyandsafetyOptions,
    VRCLoggerApi: vrcLoggerApiOptions,
    ApiKeys: ApiKeysOptions
  };

  try {
    await window.api.saveConfig(config);
    console.log("Configuration saved.");
  } catch (error) {
    console.error("Failed to save config:", error);
  }
}

// Initial rendering
function init() {
  loadConfig();
}

// Safety Toggle options rendering
function renderSafetyToggleOptions() {
  const toggleSafetyOptionsDiv = document.getElementById("safetytoggleOptions");
  toggleSafetyOptionsDiv.innerHTML = ""; // Clear existing content
  Object.keys(privacyandsafetyOptions).forEach(key => {
    const isChecked = privacyandsafetyOptions[key];
    toggleSafetyOptionsDiv.innerHTML += `
<div class="form-check form-switch">
    <input class="form-check-input" type="checkbox" id="${key}" ${isChecked
      ? "checked"
      : ""} onchange="updateSafetyToggleOptions('${key}')">
    <label class="form-check-label" for="${key}">${key}</label>
</div>
`;
  });
}

function renderVrcLoggerApiOptions() {
  const apikeysOptionsDiv = document.getElementById("apikeysOptions");
  apikeysOptionsDiv.innerHTML = ""; // Clear existing content
  const groupSelectHtml = vrcLoggerAuthorizedGroups.length
    ? `
<div class="mb-3">
  <label for="vrcLoggerGroupId" class="form-label">Authorized Group</label>
  <select class="form-select" id="vrcLoggerGroupId" onchange="updateVrcLoggerApiOptions()">
    <option value="">Default group from API key</option>
    ${vrcLoggerAuthorizedGroups.map(group => `
      <option value="${escapeHtml(group.id || "")}" ${vrcLoggerApiOptions.groupId === group.id ? "selected" : ""}>
        ${escapeHtml(group.name || "Unknown Group")} (${escapeHtml(group.id || "unknown")})
      </option>
    `).join("")}
  </select>
</div>`
    : "";
  apikeysOptionsDiv.innerHTML = `
<div class="mb-3">
  <label for="vrcLoggerDashboardBaseUrl" class="form-label">Dashboard URL</label>
  <input type="url" class="form-control" id="vrcLoggerDashboardBaseUrl" value="${escapeHtml(
    vrcLoggerApiOptions.dashboardBaseUrl
  )}" placeholder="https://your-dashboard.example.com" onchange="updateVrcLoggerApiOptions()">
</div>
<div class="mb-3">
  <label for="vrcLoggerHeaderLine" class="form-label">API Header Line</label>
  <input type="password" class="form-control" id="vrcLoggerHeaderLine" placeholder="vrclogger-api-key: copied-key-from-dashboard" onchange="updateVrcLoggerApiOptions()">
  <div class="form-text text-white-50">Saved key: ${escapeHtml(maskApiKey(vrcLoggerApiOptions.apiKey))}</div>
</div>
${groupSelectHtml}
<button type="button" class="btn btn-primary" onclick="testVrcLoggerApiConnection()">Test Connection</button>
<div id="vrcLoggerApiStatus" class="small mt-3 text-white-50"></div>
`;
}

// Update API key option
function updateApikeyOption(key) {
  ApiKeysOptions[key] = document.getElementById(key).value;
  saveConfig(); // Save configuration after updating API key
}

function updateVrcLoggerApiOptions() {
  getVrcLoggerApiConfigFromInputs();
  saveConfig();
}

async function testVrcLoggerApiConnection() {
  const statusElement = document.getElementById("vrcLoggerApiStatus");
  const apiConfig = getVrcLoggerApiConfigFromInputs();
  statusElement.textContent = "Testing connection...";

  await saveConfig();

  try {
    const result = await window.api.testVrcLoggerApi(apiConfig);
    if (!result.ok) {
      statusElement.textContent = `Connection failed: ${result.message}`;
      return;
    }

    vrcLoggerAuthorizedGroups.splice(
      0,
      vrcLoggerAuthorizedGroups.length,
      ...(Array.isArray(result.authorizedGroups) ? result.authorizedGroups : [])
    );
    const selectedGroupIsAuthorized = vrcLoggerAuthorizedGroups.some(
      group => group.id === vrcLoggerApiOptions.groupId
    );
    if (
      (!vrcLoggerApiOptions.groupId || !selectedGroupIsAuthorized) &&
      result.group &&
      result.group.id
    ) {
      vrcLoggerApiOptions.groupId = result.group.id;
      await saveConfig();
    }
    renderVrcLoggerApiOptions();

    const permissions = result.key && Array.isArray(result.key.permissions)
      ? result.key.permissions.join(", ")
      : "none";
    const authorizedGroups = Array.isArray(result.authorizedGroups)
      ? result.authorizedGroups.map(group => `${group.name || "Unknown"} (${group.id || "unknown"})`).join(", ")
      : "none";
    const selectedGroup =
      vrcLoggerAuthorizedGroups.find(group => group.id === vrcLoggerApiOptions.groupId) ||
      result.group ||
      {};
    const guildName = result.guild && result.guild.name || result.guildName || "Unknown";
    const refreshedStatusElement = document.getElementById("vrcLoggerApiStatus");
    refreshedStatusElement.innerHTML = `
Connection OK. Discord Server: ${escapeHtml(guildName)} (${escapeHtml(result.guildId || "unknown")})
<br>Selected Group: ${escapeHtml(selectedGroup.name || "Unknown")} (${escapeHtml(selectedGroup.id || "unknown")})
<br>Authorized Groups: ${escapeHtml(authorizedGroups)}
<br>Discord User: ${escapeHtml(result.key && result.key.displayName || "unknown")} (${escapeHtml(result.key && result.key.userId || "unknown")})
<br>Role: ${escapeHtml(result.key && result.key.role || "unknown")}
<br>Admin: ${result.key && result.key.isAdmin ? "yes" : "no"}
<br>Permissions: ${escapeHtml(permissions)}
<br>Key: ${escapeHtml(result.maskedApiKey)}
`;
  } catch (error) {
    statusElement.textContent = `Connection failed: ${error.message}`;
  }
}

async function renderOverlayUrl() {
  const overlayUrl = document.getElementById("overlayUrl");
  if (!overlayUrl) return;
  const url = await window.api.getOverlayUrl();
  overlayUrl.textContent = url;
}

function getStickerRoute(stickerId, ownerId) {
  return String(stickerId || "").startsWith("inv_") && ownerId
    ? `/v5/games/api/vrchat/yoinker/getSticker/${encodeURIComponent(ownerId)}/${encodeURIComponent(stickerId)}`
    : `/v5/games/api/vrchat/yoinker/getSticker/${encodeURIComponent(stickerId)}`;
}

function findImageUrl(value, depth = 0) {
  if (!value || depth > 5) return "";
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) ? value : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageUrl(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";

  const direct =
    value.imageUrl ||
    value.url ||
    value.files?.image ||
    value.metadata?.imageUrl ||
    value.data?.files?.image ||
    value.data?.imageUrl ||
    value.data?.metadata?.imageUrl;

  if (direct) return direct;

  for (const nested of Object.values(value)) {
    const found = findImageUrl(nested, depth + 1);
    if (found) return found;
  }

  return "";
}

function getStickerImageUrl(data) {
  return findImageUrl(data);
}

async function fetchStickerImage(stickerId, ownerId, ownerName) {
  const route = getStickerRoute(stickerId, ownerId);
  try {
    const apiUrl = await window.api.getApiEndpoint();
    const response = await fetch(`${apiUrl}${route}`, {
      headers: { Accept: "application/json" }
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.message || data?.error || `Sticker request failed: ${response.status}`);
    }
    const imageUrl = getStickerImageUrl(data);
    displayImage(imageUrl || "", "Sticker", Date.now(), {
      ownerId,
      ownerName,
      assetId: stickerId,
      statusMessage: imageUrl ? "" : `No imageUrl returned from ${route}`
    });
  } catch (error) {
    console.error("Error fetching sticker image:", error);
    displayImage("", "Sticker", Date.now(), {
      ownerId,
      ownerName,
      assetId: stickerId,
      statusMessage: `${error.message} (${route})`
    });
  }
}

// Update safety toggle options
function updateSafetyToggleOptions(key) {
  privacyandsafetyOptions[key] = document.getElementById(key).checked;
  saveConfig();
}

// Toggle options rendering
function renderToggleOptions() {
  const toggleOptionsDiv = document.getElementById("toggleOptions");
  toggleOptionsDiv.innerHTML = ""; // Clear existing content
  const hiddenToggles = new Set([
    "isEmbed",
    "Counters",
    "Countersavi",
    "Countersvrca"
  ]);
  Object.keys(toggleOptions).filter(key => !hiddenToggles.has(key)).forEach(key => {
    const isChecked = toggleOptions[key];
    toggleOptionsDiv.innerHTML += `
<div class="form-check form-switch">
    <input class="form-check-input" type="checkbox" id="${key}" ${isChecked
      ? "checked"
      : ""} onchange="updateToggleOptions('${key}')">
    <label class="form-check-label" for="${key}">${key}</label>
</div>
`;
  });
}

// Update toggle options
function updateToggleOptions(key) {
  toggleOptions[key] = document.getElementById(key).checked;
  saveConfig();
}
