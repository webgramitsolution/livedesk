// LiveDesk desktop shell. The main process is a thin OS proxy: it creates one
// hardened BrowserWindow, injects a Content Security Policy, answers screen
// capture requests through an in-app source picker, and executes validated
// remote-control input for the currently armed session.
const path = require('path');
const { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } = require('electron');
const { registerRemoteControlHandler, endSession, getActiveSession } = require('./remoteControlHandler.cjs');

const isDev = !app.isPackaged && !!process.env.VITE_DEV_SERVER_URL;
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:8080';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const WINDOW_TITLE = 'LiveDesk';

let mainWindow = null;

function buildCsp() {
  const supabaseOrigin = (() => {
    try {
      return SUPABASE_URL ? new URL(SUPABASE_URL).origin : '';
    } catch (_) {
      return '';
    }
  })();
  const supabaseWs = supabaseOrigin ? supabaseOrigin.replace(/^http/, 'ws') : '';
  const connect = [
    "'self'",
    supabaseOrigin,
    supabaseWs,
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'https://api.elevenlabs.io',
    'wss://api.elevenlabs.io',
    isDev ? DEV_URL : '',
    isDev ? DEV_URL.replace(/^http/, 'ws') : '',
  ].filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' ${isDev ? "'unsafe-inline'" : ''}`.trim(),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: mediastream:",
    `connect-src ${connect}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: WINDOW_TITLE,
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  // CSP for every response the window loads.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildCsp()],
      },
    });
  });

  // External links open in the OS browser; navigation stays inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith(DEV_URL) : url.startsWith('file://');
    if (!allowed) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (isDev) {
    void mainWindow.loadURL(DEV_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Closing the window ends any armed remote-control session.
    const active = getActiveSession();
    if (active) void endSession(active.token);
  });
}

/**
 * Screen sharing: Electron does not show a picker for getDisplayMedia, so the
 * request is answered by asking the renderer to pick a source. The app's own
 * window is filtered out to prevent the mirror-recursion effect.
 */
function registerDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    let sources;
    try {
      sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
    } catch (err) {
      console.error('[screen-share] getSources failed', err);
      callback({});
      return;
    }
    const selfTitle = (mainWindow && mainWindow.getTitle()) || WINDOW_TITLE;
    const offered = sources
      .filter((s) => !(s.id.startsWith('window:') && s.name === selfTitle))
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen:') ? 'screen' : 'window',
        displayId: s.display_id || undefined,
        thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
      }));

    if (!mainWindow || mainWindow.isDestroyed()) {
      callback({});
      return;
    }

    const choice = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ipcMain.removeListener('screen-share:choice', onChoice);
        resolve(null);
      }, 60_000);
      function onChoice(_evt, payload) {
        clearTimeout(timeout);
        ipcMain.removeListener('screen-share:choice', onChoice);
        resolve(payload && typeof payload === 'object' ? payload : null);
      }
      ipcMain.on('screen-share:choice', onChoice);
      mainWindow.webContents.send('screen-share:sources', offered);
    });

    if (!choice || !choice.sourceId) {
      callback({});
      return;
    }
    const picked = sources.find((s) => s.id === choice.sourceId);
    if (!picked) {
      callback({});
      return;
    }
    // System audio loopback is only available for screen sources on Windows.
    const wantsAudio = choice.withAudio === true && picked.id.startsWith('screen:') && process.platform === 'win32';
    callback({ video: picked, audio: wantsAudio ? 'loopback' : undefined });
  }, { useSystemPicker: false });
}

app.whenReady().then(() => {
  registerRemoteControlHandler();
  registerDisplayMediaHandler();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_event, contents) => {
  // Defense in depth: never allow additional webviews or unexpected permission grants.
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'display-capture', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen'];
    callback(allowed.includes(permission));
  });
});
