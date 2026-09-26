// Preload bridge exposed to the renderer. Runs with contextIsolation and a
// sandboxed renderer; it exposes a fixed, narrow API and validates every
// argument before it reaches IPC. No generic ipcRenderer access is exposed.
const { contextBridge, ipcRenderer } = require('electron');
const { validateInputEvent, validateSession, validateToken } = require('./inputValidation.cjs');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,

  remoteControl: {
    startSession: (raw) => {
      const session = validateSession(raw);
      if (!session) return Promise.resolve({ ok: false, reason: 'invalid-session' });
      return ipcRenderer.invoke('remote-control:session-start', session);
    },
    endSession: (token) => {
      return ipcRenderer.invoke('remote-control:session-end', validateToken(token) ? token : '');
    },
    handleInput: (token, rawEvent) => {
      if (!validateToken(token)) return;
      const event = validateInputEvent(rawEvent);
      if (!event) return;
      ipcRenderer.invoke('remote-control:input', { token, event }).catch(() => undefined);
    },
  },

  screenShare: {
    onSourcesRequested: (handler) => {
      if (typeof handler !== 'function') return () => undefined;
      const listener = (_evt, sources) => {
        if (!Array.isArray(sources)) return;
        handler(
          sources
            .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string')
            .map((s) => ({
              id: s.id,
              name: s.name,
              thumbnail: typeof s.thumbnail === 'string' ? s.thumbnail : '',
              kind: s.kind === 'window' ? 'window' : 'screen',
              displayId: typeof s.displayId === 'string' ? s.displayId : undefined,
            })),
        );
      };
      ipcRenderer.on('screen-share:sources', listener);
      return () => ipcRenderer.removeListener('screen-share:sources', listener);
    },
    chooseSource: (sourceId, withAudio) => {
      const id = typeof sourceId === 'string' && sourceId.length > 0 && sourceId.length < 256 ? sourceId : null;
      ipcRenderer.send('screen-share:choice', { sourceId: id, withAudio: withAudio === true });
    },
  },
});
