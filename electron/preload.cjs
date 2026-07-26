// Preload bridge exposed to the renderer. Context-isolation safe.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  remoteControl: {
    handleInput: (event) => {
      ipcRenderer.invoke('remote-control:input', event).catch(() => undefined);
    },
  },
});