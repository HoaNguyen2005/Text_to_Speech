const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  isDesktop: true,
  getStatus: () => ipcRenderer.invoke('desktop:get-status'),
  restartServices: () => ipcRenderer.invoke('desktop:restart-services'),
  setupRuntime: () => ipcRenderer.invoke('desktop:setup-runtime'),
  warmupCloud: () => ipcRenderer.invoke('desktop:warmup-cloud'),
  onStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop:status', listener);
    return () => ipcRenderer.removeListener('desktop:status', listener);
  },
});
