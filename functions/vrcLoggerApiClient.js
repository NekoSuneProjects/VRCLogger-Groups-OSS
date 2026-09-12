const getConfig = require("./getConfig");
const { version } = require("../package.json");

const DEFAULT_HEADER_NAME = "vrclogger-api-key";
const LEGACY_DASHBOARD_URL = "https://vrcloggerpub.nekosunevr.co.uk";
const RETRY_STATUS_CODES = new Set([500, 502, 503, 504]);
const DASHBOARD_ERROR_STATUS_CODES = new Set([401, 403, 404, 429]);

class VrcLoggerApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "VrcLoggerApiError";
    this.status = status;
    this.data = data;
  }
}

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function trimSlashes(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

function stripDashboardApiSuffix(value) {
  const dashboardBaseUrl = trimTrailingSlash(value);

  if (!dashboardBaseUrl) {
    return "";
  }

  try {
    const url = new URL(dashboardBaseUrl);
    url.pathname = url.pathname
      .replace(/\/(?:client-api|api\/client|dashboard-api)$/i, "")
      .replace(/\/+$/g, "");
    url.search = "";
    url.hash = "";
    return trimTrailingSlash(url.toString());
  } catch {
    return dashboardBaseUrl
      .replace(/\/(?:client-api|api\/client|dashboard-api)$/i, "")
      .replace(/\/+$/g, "");
  }
}

function maskApiKey(apiKey) {
  const value = String(apiKey || "");
  return value ? `${value.slice(0, 8)}...` : "";
}

function normaliseHeaderName(headerName) {
  return String(headerName || DEFAULT_HEADER_NAME).trim() || DEFAULT_HEADER_NAME;
}

function buildApiUrl(baseUrl, route = "") {
  const base = trimTrailingSlash(baseUrl);
  const cleanRoute = trimSlashes(route);

  return cleanRoute ? `${base}/${cleanRoute}` : base;
}

function parseApiHeaderLine(headerLine) {
  const value = String(headerLine || "").trim();

  if (!value) {
    return {};
  }

  const separatorIndex = value.indexOf(":");
  if (separatorIndex === -1) {
    return { apiKey: value };
  }

  const headerName = value.slice(0, separatorIndex).trim();
  const apiKey = value.slice(separatorIndex + 1).trim();

  return {
    headerName: headerName || DEFAULT_HEADER_NAME,
    apiKey
  };
}

function isConfiguredApiKey(apiKey) {
  return Boolean(
    apiKey &&
      apiKey !== "ENTERYOURAUTOMODKEY" &&
      !String(apiKey).startsWith("ENTERYOUR")
  );
}

function hasApiKey(apiConfig) {
  const apiKey = apiConfig && apiConfig.apiKey;

  return isConfiguredApiKey(apiKey);
}

async function getFetch() {
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }

  const nodeFetch = await import("node-fetch");
  return nodeFetch.default;
}

async function getVrcLoggerApiConfig(overrides = {}) {
  const configuredApi = {
    dashboardBaseUrl: await getConfig("VRCLoggerApi.dashboardBaseUrl"),
    dashboardEndpointUrl: await getConfig("VRCLoggerApi.dashboardEndpointUrl"),
    apiKey: await getConfig("VRCLoggerApi.apiKey"),
    headerName: await getConfig("VRCLoggerApi.headerName"),
    groupId: await getConfig("VRCLoggerApi.groupId")
  };
  const legacyApiKeys = {
    ApiEndpointUrL: await getConfig("ApiKeys.ApiEndpointUrL"),
    Auto_Mod_Check: await getConfig("ApiKeys.Auto_Mod_Check"),
    Auto_Mod_Check_Global: await getConfig("ApiKeys.Auto_Mod_Check_Global")
  };
  const legacyApiKey =
    isConfiguredApiKey(legacyApiKeys.Auto_Mod_Check)
      ? legacyApiKeys.Auto_Mod_Check
      : isConfiguredApiKey(legacyApiKeys.Auto_Mod_Check_Global)
        ? legacyApiKeys.Auto_Mod_Check_Global
        : "";
  const cleanConfiguredApi = Object.fromEntries(
    Object.entries(configuredApi).filter(([, value]) => value != null && value !== "")
  );

  const merged = {
    dashboardBaseUrl: "",
    apiKey: legacyApiKey || "",
    headerName: DEFAULT_HEADER_NAME,
    groupId: "",
    ...cleanConfiguredApi,
    ...overrides
  };

  merged.headerName = normaliseHeaderName(merged.headerName);
  merged.dashboardBaseUrl = stripDashboardApiSuffix(
    merged.dashboardBaseUrl ||
      merged.dashboardEndpointUrl ||
      legacyApiKeys.ApiEndpointUrL ||
      LEGACY_DASHBOARD_URL
  );
  merged.groupId = String(merged.groupId || "").trim();
  if (merged.groupId && !/^grp_[\w-]+$/.test(merged.groupId)) {
    merged.groupId = "";
  }

  delete merged.dashboardEndpointUrl;

  return merged;
}

function getDashboardBaseUrl(apiConfig) {
  const dashboardBaseUrl = stripDashboardApiSuffix(
    apiConfig && (apiConfig.dashboardBaseUrl || apiConfig.dashboardEndpointUrl)
  );

  if (!dashboardBaseUrl) {
    return LEGACY_DASHBOARD_URL;
  }

  return dashboardBaseUrl;
}

function createApiHeaders(apiConfig, extraHeaders = {}, includeApiKey = true) {
  const headers = {
    Accept: "application/json",
    "User-Agent": `VRCLogger-Project-Darkstar-Client/${version}`,
    ...extraHeaders
  };

  if (includeApiKey && apiConfig && apiConfig.apiKey) {
    headers[normaliseHeaderName(apiConfig.headerName)] = apiConfig.apiKey;
  }

  return headers;
}

function getJsonErrorMessage(data, fallbackMessage) {
  if (!data || typeof data !== "object") {
    return fallbackMessage;
  }

  return data.error || data.detail || data.message || fallbackMessage;
}

function appendQueryParam(route, key, value) {
  if (!value || new RegExp(`(?:\\?|&)${key}=`).test(route)) {
    return route;
  }

  return `${route}${route.includes("?") ? "&" : "?"}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function appendSelectedGroupId(route, apiConfig, options = {}) {
  if (options.includeGroupId === false || !apiConfig || !apiConfig.groupId) {
    return route;
  }

  const normalizedRoute = `/${trimSlashes(route)}`.toLowerCase();

  if (
    !normalizedRoute.startsWith("/api/client/") ||
    normalizedRoute.startsWith("/api/client/bootstrap")
  ) {
    return route;
  }

  return appendQueryParam(route, "groupId", apiConfig.groupId);
}

async function parseJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function shouldThrowApiError(data, response, apiType, throwOnApiStatus) {
  if (!response.ok && throwOnApiStatus) {
    return true;
  }

  if (!data || typeof data !== "object") {
    return false;
  }

  if (apiType === "dashboard") {
    if (!throwOnApiStatus) {
      return false;
    }

    return Boolean(
      data.error ||
        data.detail ||
        data.message && Number(data.status) >= 400 ||
        Number(data.status) >= 400 ||
        response.status >= 400
    );
  }

  return (
    throwOnApiStatus &&
    (DASHBOARD_ERROR_STATUS_CODES.has(Number(data.status)) ||
      Number(data.status) >= 500)
  );
}

async function fetchApiJson(baseUrl, route = "", options = {}) {
  const {
    apiConfig: providedConfig,
    apiType = "proxy",
    body,
    headers,
    includeApiKey = true,
    method = "GET",
    throwOnApiStatus = apiType === "dashboard"
  } = options;

  const apiConfig = providedConfig || (await getVrcLoggerApiConfig());
  const requestHeaders = createApiHeaders(apiConfig, headers, includeApiKey);
  const fetchImpl = await getFetch();
  const response = await fetchImpl(buildApiUrl(baseUrl, route), {
    method,
    headers: requestHeaders,
    body,
    redirect: "follow"
  });
  let data = await parseJsonResponse(response);

  if (!response.ok && data == null) {
    data = { status: response.status, message: response.statusText };
  }

  if (shouldThrowApiError(data, response, apiType, throwOnApiStatus)) {
    throw new VrcLoggerApiError(
      getJsonErrorMessage(data, `VRC Logger API request failed: ${response.status}`),
      data && data.status ? data.status : response.status,
      data
    );
  }

  if (!response.ok && data && typeof data === "object" && data.status == null) {
    data.status = response.status;
  }

  return data;
}

async function fetchDashboardJson(route, options = {}) {
  const apiConfig = options.apiConfig || (await getVrcLoggerApiConfig());
  const dashboardBaseUrl = getDashboardBaseUrl(apiConfig);

  if (!dashboardBaseUrl) {
    throw new VrcLoggerApiError(
      "Dashboard URL is not configured.",
      400,
      null
    );
  }

  return fetchApiJson(dashboardBaseUrl, appendSelectedGroupId(route, apiConfig, options), {
    ...options,
    apiConfig,
    apiType: "dashboard",
    throwOnApiStatus:
      options.throwOnApiStatus === undefined ? true : options.throwOnApiStatus
  });
}

async function fetchDashboardPublicJson(route, options = {}) {
  const apiConfig = options.apiConfig || (await getVrcLoggerApiConfig());

  return fetchApiJson(getDashboardBaseUrl(apiConfig), route, {
    ...options,
    apiConfig,
    apiType: "public",
    includeApiKey: false,
    throwOnApiStatus: options.throwOnApiStatus || false
  });
}

async function fetchWithRetry(url, options, retries = 10, delayMs = 5 * 1000) {
  try {
    const fetchImpl = await getFetch();
    const response = await fetchImpl(url, options);

    if (RETRY_STATUS_CODES.has(response.status) && retries > 0) {
      console.warn(`Received ${response.status}. Retrying in ${delayMs} ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return fetchWithRetry(url, options, retries - 1, delayMs * 2);
    }

    return response;
  } catch (error) {
    if (retries > 0) {
      console.warn(`Fetch error. Retrying in ${delayMs} ms...`, error.message);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return fetchWithRetry(url, options, retries - 1, delayMs * 2);
    }

    throw error;
  }
}

async function testDashboardConnection(overrides = {}) {
  const apiConfig = await getVrcLoggerApiConfig(overrides);
  const data = await fetchDashboardJson("/api/client/bootstrap", {
    apiConfig,
    includeGroupId: false
  });

  return {
    ok: true,
    status: data && data.status,
    message: data && data.message,
    guildId: data && data.guildId,
    guild: data && data.guild,
    group: data && data.group,
    authorizedGroups: data && data.authorizedGroups,
    dashboardEndpointUrl: data && data.dashboardEndpointUrl,
    clientApiBase: data && data.clientApiBase,
    clientScopePath: data && data.clientScopePath,
    key: data && {
      userId: data.key && data.key.userId,
      displayName: data.key && data.key.displayName,
      role: data.key && data.key.role,
      isAdmin: data.key && data.key.isAdmin,
      permissions: data.key && data.key.permissions
    },
    maskedApiKey: maskApiKey(apiConfig.apiKey)
  };
}

module.exports = {
  DEFAULT_HEADER_NAME,
  LEGACY_DASHBOARD_URL,
  VrcLoggerApiError,
  buildApiUrl,
  createApiHeaders,
  fetchApiJson,
  fetchDashboardJson,
  fetchDashboardPublicJson,
  fetchWithRetry,
  getDashboardBaseUrl,
  getVrcLoggerApiConfig,
  hasApiKey,
  maskApiKey,
  parseApiHeaderLine,
  testDashboardConnection
};
