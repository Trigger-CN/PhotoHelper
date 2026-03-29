const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("photoApi", {
  selectDirectory: (title) => ipcRenderer.invoke("select-directory", title),
  scanDirectory: (dirPath) => ipcRenderer.invoke("scan-directory", dirPath),
  getPreview: (filePath) => ipcRenderer.invoke("get-preview", filePath),
  getPhotoInfo: (filePath) => ipcRenderer.invoke("get-photo-info", filePath),
  copyFiles: (payload) => ipcRenderer.invoke("copy-files", payload),
  onCopyProgress: (listener) => {
    const handler = (_, data) => listener(data)
    ipcRenderer.on("copy-progress", handler)
    return () => {
      ipcRenderer.removeListener("copy-progress", handler)
    }
  },
  readFileBuffer: (filePath) => ipcRenderer.invoke("read-file-buffer", filePath),
  savePreviewCache: (payload) => ipcRenderer.invoke("save-preview-cache", payload),
  decodeRawPreview: (filePath) => ipcRenderer.invoke("decode-raw-preview", filePath),
  loadConfig: () => ipcRenderer.invoke("load-config"),
  saveConfig: (config) => ipcRenderer.invoke("save-config", config)
})
