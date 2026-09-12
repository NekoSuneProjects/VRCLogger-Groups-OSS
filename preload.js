window.addEventListener("DOMContentLoaded", () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text;
  };

  for (const dependency of ["chrome", "node", "electron"]) {
    replaceText(`${dependency}-version`, process.versions[dependency]);
  }
});

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  loadUserConfig: () => ipcRenderer.invoke("load-userconfig"),
  saveUserConfig: config => ipcRenderer.invoke("save-userconfig", config),
  loadConfig: () => ipcRenderer.invoke("load-config"),
  saveConfig: config => ipcRenderer.invoke("save-config", config),
  loadAssetsList: () => ipcRenderer.invoke("load-assetlist", config),
  saveAssetsList: (data) => ipcRenderer.invoke("save-assetlist", data),
  getApiEndpoint: () => ipcRenderer.invoke("get-api-endpoint"),
  getOverlayUrl: () => ipcRenderer.invoke("get-overlay-url"),
  testVrcLoggerApi: config => ipcRenderer.invoke("test-vrclogger-api", config)
});

contextBridge.exposeInMainWorld("appInfo", {
  getVersion: () => ipcRenderer.invoke("get-app-version")
});
