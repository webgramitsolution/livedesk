# LiveDesk desktop app (Electron)

The desktop build is what makes **OS-level remote control** possible. In a
browser, LiveDesk can only dispatch synthetic events inside its own tab
("in-app pointer"); the desktop app drives the real mouse and keyboard through
[`@nut-tree-fork/nut-js`](https://www.npmjs.com/package/@nut-tree-fork/nut-js).

## Files

| File | Role |
|------|------|
| `main.cjs` | Hardened `BrowserWindow` (`sandbox`, `contextIsolation`, no `nodeIntegration`), CSP injection, screen-share source picker, permission handler. |
| `preload.cjs` | The only bridge to the renderer. Fixed API, validates every argument, no generic IPC. |
| `inputValidation.cjs` | Shared strict validators (unit-tested under Node). |
| `remoteControlHandler.cjs` | Session arming (token), per-event validation, nut-js execution, display/DPI mapping. |

## Security model

1. The renderer receives a control token from the server (`grant_remote_control` RPC) when the presenter approves a request.
2. The renderer arms the main process with `remoteControl.startSession({ token, controllerId, allowKeyboard })`.
3. Every input event carries the token. The main process drops: unarmed input, token mismatches, malformed events, keyboard events for mouse-only sessions.
4. `remoteControl.endSession(token)` disarms and releases any held keys. It is called on revoke, release, disconnect, presenter stop, meeting end and window close.
5. Coordinates are normalized `0..1` and mapped onto the target display bounds and scale factor at execution time.

## Running

```bash
npm install
npm run dev                # Vite on :8080
npm run electron:dev       # loads the dev server in Electron
npm run electron:build     # vite build + electron-builder (see electron-builder.yml)
```

Linux needs the X11 libraries libnut links against (`libX11`, `libXtst`, `libXext`, `libXi`, `libXinerama`, `libXrandr`).

## Real-dependency test

`npm run test:electron` runs `scripts/electron-rc-integration.mjs` against the
real nut-js binding under `xvfb-run`, including session arming and token
rejection. Node-level validation tests live in `src/test/electronValidation.test.ts`.
