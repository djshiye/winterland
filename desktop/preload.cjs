/**
 * Preload script: exposes the small `window.winterlandDesktop` bridge to the game (contract: src/platform/desktop.ts).
 * It runs sandboxed with contextIsolation, so only `require('electron')` is available here. The main process
 * (desktop/main.cjs) owns the window and validates everything it receives.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('winterlandDesktop', {
  version: String(ipcRenderer.sendSync('desktop:version') ?? ''),
  getWindowMode: () => ipcRenderer.invoke('desktop:getWindowMode'),
  setWindowMode: (mode) => {
    ipcRenderer.send('desktop:setWindowMode', mode);
  },
  quit: () => {
    ipcRenderer.send('desktop:quit');
  },
  // 0.9.8 in-game updater (desktop/updater.cjs); the main process checks every request comes from the game page.
  updates: {
    info: () => ipcRenderer.invoke('update:info'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    cancel: () => {
      ipcRenderer.send('update:cancel');
    },
    install: () => ipcRenderer.invoke('update:install'),
    openPage: () => {
      ipcRenderer.send('update:openPage');
    },
    onProgress: (cb) => {
      if (typeof cb !== 'function') return () => {};
      const listener = (_event, p) => cb({ got: Number(p?.got) || 0, total: Number(p?.total) || 0 });
      ipcRenderer.on('update:progress', listener);
      return () => {
        ipcRenderer.removeListener('update:progress', listener);
      };
    },
  },
  onWindowMode: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const listener = (_event, mode) => cb(mode);
    ipcRenderer.on('desktop:windowMode', listener);
    return () => {
      ipcRenderer.removeListener('desktop:windowMode', listener);
    };
  },
});
