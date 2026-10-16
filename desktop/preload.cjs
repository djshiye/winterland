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
  onWindowMode: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const listener = (_event, mode) => cb(mode);
    ipcRenderer.on('desktop:windowMode', listener);
    return () => {
      ipcRenderer.removeListener('desktop:windowMode', listener);
    };
  },
});
