const { contextBridge, ipcRenderer } = require('electron');

const config = (() => {
  try {
    return ipcRenderer.sendSync('desktop:get-config');
  } catch {
    return null;
  }
})();

contextBridge.exposeInMainWorld('desktopApp', {
  isDesktop: true,
  config,
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
  synthesizeLocal: (payload, onProgress) => {
    const listener = typeof onProgress === 'function'
      ? (_event, progress) => {
          if (!payload?.jobId || progress?.jobId === payload.jobId) onProgress(progress);
        }
      : null;
    if (listener) ipcRenderer.on('desktop:synthesis-progress', listener);
    return ipcRenderer.invoke('desktop:synthesize-local', payload).finally(() => {
      if (listener) ipcRenderer.removeListener('desktop:synthesis-progress', listener);
    });
  },
});
