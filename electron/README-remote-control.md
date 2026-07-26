# OS-level remote control (Electron)

When packaged with Electron the presenter's desktop becomes fully controllable
via [`@nut-tree-fork/nut-js`](https://www.npmjs.com/package/@nut-tree-fork/nut-js).

## Wiring

1. `npm install --save @nut-tree-fork/nut-js`
2. In `electron/main.cjs`:
   ```js
   const path = require('path');
   const { app, BrowserWindow } = require('electron');
   const { registerRemoteControlHandler } = require('./remoteControlHandler.cjs');
   app.whenReady().then(() => {
     const win = new BrowserWindow({
       webPreferences: {
         preload: path.join(__dirname, 'preload.cjs'),
         contextIsolation: true,
         nodeIntegration: false,
         sandbox: false,
       },
     });
     registerRemoteControlHandler();
     win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
   });
   ```
3. The renderer picks up `window.electronAPI.remoteControl` automatically via
   `src/lib/remoteControl/inputExecutor.ts`.

All coordinates are normalized (0..1); the handler multiplies by the primary
display size so mapping is resolution-agnostic. Esc reclaims control.