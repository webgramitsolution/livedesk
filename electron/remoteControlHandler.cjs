// Electron main-process handler that turns validated RCInputEvent messages
// coming from the renderer into OS-level mouse + keyboard actions via
// @nut-tree-fork/nut-js.
//
// Security model:
//  - Nothing executes unless a control session has been armed with
//    `remote-control:session-start` carrying the server-issued token.
//  - Every input carries the token; a mismatch is dropped and counted.
//  - Keyboard events are dropped unless the armed session allows keyboard.
//  - Every payload is re-validated here (the preload validates too, but the
//    main process is the authority).
//  - Coordinates are normalized 0..1 and mapped onto the display bounds at
//    execution time, so they are resolution and DPI independent.
const { ipcMain, screen } = require('electron');
const { validateInputEvent, validateSession, validateToken } = require('./inputValidation.cjs');

let nut = null;
function loadNut() {
  if (nut) return nut;
  try {
    nut = require('@nut-tree-fork/nut-js');
  } catch (_) {
    try {
      nut = require('@nut-tree/nut-js');
    } catch (err) {
      console.error('[remote-control] nut-js is not installed:', err.message);
      nut = null;
    }
  }
  if (nut) {
    nut.mouse.config.mouseSpeed = 1000;
    nut.keyboard.config.autoDelayMs = 0;
  }
  return nut;
}

// ---------- Session arming ----------
let activeSession = null; // { token, controllerId, allowKeyboard, displayId, startedAt }
const pressedKeys = new Set();
const stats = { executed: 0, droppedUnarmed: 0, droppedToken: 0, droppedInvalid: 0, droppedKeyboard: 0 };

function targetDisplay() {
  if (activeSession && activeSession.displayId != null) {
    const match = screen.getAllDisplays().find((d) => d.id === activeSession.displayId);
    if (match) return match;
  }
  return screen.getPrimaryDisplay();
}

function toPoint(nx, ny) {
  const display = targetDisplay();
  const bounds = display.bounds; // DIP coordinates; nut-js expects physical pixels
  const scale = typeof display.scaleFactor === 'number' && display.scaleFactor > 0 ? display.scaleFactor : 1;
  const x = (bounds.x + Math.max(0, Math.min(1, Number(nx))) * bounds.width) * scale;
  const y = (bounds.y + Math.max(0, Math.min(1, Number(ny))) * bounds.height) * scale;
  return new nut.Point(Math.round(x), Math.round(y));
}

function mapButton(b) {
  if (!nut) return null;
  if (b === 'right') return nut.Button.RIGHT;
  if (b === 'middle') return nut.Button.MIDDLE;
  return nut.Button.LEFT;
}

function mapKey(code, key) {
  if (!nut) return null;
  const K = nut.Key;
  if (/^Key[A-Z]$/.test(code)) return K[code.slice(3)];
  if (/^Digit[0-9]$/.test(code)) return K['Num' + code.slice(5)];
  if (/^Numpad[0-9]$/.test(code)) return K['NumPad' + code.slice(6)];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return K[code];
  const table = {
    Enter: K.Enter, NumpadEnter: K.Enter, Escape: K.Escape, Tab: K.Tab, Backspace: K.Backspace,
    Space: K.Space, ArrowUp: K.Up, ArrowDown: K.Down, ArrowLeft: K.Left, ArrowRight: K.Right,
    Home: K.Home, End: K.End, PageUp: K.PageUp, PageDown: K.PageDown, Delete: K.Delete, Insert: K.Insert,
    ShiftLeft: K.LeftShift, ShiftRight: K.RightShift,
    ControlLeft: K.LeftControl, ControlRight: K.RightControl,
    AltLeft: K.LeftAlt, AltRight: K.RightAlt,
    MetaLeft: K.LeftSuper, MetaRight: K.RightSuper,
    CapsLock: K.CapsLock, PrintScreen: K.Print, ScrollLock: K.ScrollLock, Pause: K.Pause, NumLock: K.NumLock,
    Minus: K.Minus, Equal: K.Equal, BracketLeft: K.LeftBracket, BracketRight: K.RightBracket,
    Backslash: K.Backslash, Semicolon: K.Semicolon, Quote: K.Quote, Backquote: K.Grave,
    Comma: K.Comma, Period: K.Period, Slash: K.Slash,
    NumpadAdd: K.Add, NumpadSubtract: K.Subtract, NumpadMultiply: K.Multiply, NumpadDivide: K.Divide, NumpadDecimal: K.Decimal,
    AudioVolumeMute: K.AudioMute, AudioVolumeDown: K.AudioVolDown, AudioVolumeUp: K.AudioVolUp,
  };
  if (table[code] != null) return table[code];
  if (typeof key === 'string' && key.length === 1) {
    const upper = key.toUpperCase();
    if (K[upper] != null) return K[upper];
  }
  return null;
}

async function releaseAllKeys() {
  const n = loadNut();
  if (!n) return;
  for (const k of Array.from(pressedKeys)) {
    try {
      await n.keyboard.releaseKey(k);
    } catch (_) {
      /* best effort */
    }
  }
  pressedKeys.clear();
}

async function executeValidated(event) {
  const n = loadNut();
  if (!n) return;
  switch (event.type) {
    case 'mousemove':
      await n.mouse.setPosition(toPoint(event.x, event.y));
      break;
    case 'mousedown':
      await n.mouse.setPosition(toPoint(event.x, event.y));
      await n.mouse.pressButton(mapButton(event.button));
      break;
    case 'mouseup':
      await n.mouse.setPosition(toPoint(event.x, event.y));
      await n.mouse.releaseButton(mapButton(event.button));
      break;
    case 'click': {
      await n.mouse.setPosition(toPoint(event.x, event.y));
      const btn = mapButton(event.button);
      if (event.detail >= 2) await n.mouse.doubleClick(btn);
      else await n.mouse.click(btn);
      break;
    }
    case 'wheel': {
      const dy = Math.round(event.deltaY || 0);
      const dx = Math.round(event.deltaX || 0);
      if (dy > 0) await n.mouse.scrollDown(dy);
      else if (dy < 0) await n.mouse.scrollUp(-dy);
      if (dx > 0) await n.mouse.scrollRight(dx);
      else if (dx < 0) await n.mouse.scrollLeft(-dx);
      break;
    }
    case 'keydown': {
      const k = mapKey(event.code, event.key);
      if (k != null) {
        await n.keyboard.pressKey(k);
        pressedKeys.add(k);
      }
      break;
    }
    case 'keyup': {
      const k = mapKey(event.code, event.key);
      if (k != null) {
        await n.keyboard.releaseKey(k);
        pressedKeys.delete(k);
      }
      break;
    }
  }
}

/**
 * Execute one input for `token`. Returns a status string for observability.
 * Exported for the real-dependency harness.
 */
async function handleInput(token, rawEvent) {
  if (!activeSession) {
    stats.droppedUnarmed += 1;
    return 'unarmed';
  }
  if (!validateToken(token) || token !== activeSession.token) {
    stats.droppedToken += 1;
    return 'bad-token';
  }
  const event = validateInputEvent(rawEvent);
  if (!event) {
    stats.droppedInvalid += 1;
    return 'invalid';
  }
  if ((event.type === 'keydown' || event.type === 'keyup') && !activeSession.allowKeyboard) {
    stats.droppedKeyboard += 1;
    return 'keyboard-not-allowed';
  }
  try {
    await executeValidated(event);
    stats.executed += 1;
    return 'ok';
  } catch (err) {
    console.error('[remote-control] execute failed:', err);
    return 'error';
  }
}

async function startSession(raw) {
  const session = validateSession(raw);
  if (!session) return { ok: false, reason: 'invalid-session' };
  if (activeSession) await endSession(activeSession.token);
  activeSession = { ...session, startedAt: Date.now() };
  return { ok: true };
}

async function endSession(token) {
  if (!activeSession) return { ok: true };
  if (typeof token === 'string' && token.length > 0 && token !== activeSession.token) {
    return { ok: false, reason: 'bad-token' };
  }
  activeSession = null;
  await releaseAllKeys();
  return { ok: true };
}

function getActiveSession() {
  return activeSession ? { ...activeSession } : null;
}

function getStats() {
  return { ...stats };
}

function registerRemoteControlHandler() {
  ipcMain.handle('remote-control:session-start', async (_evt, raw) => startSession(raw));
  ipcMain.handle('remote-control:session-end', async (_evt, token) => endSession(token));
  ipcMain.handle('remote-control:input', async (_evt, payload) => {
    const token = payload && typeof payload === 'object' ? payload.token : undefined;
    const event = payload && typeof payload === 'object' ? payload.event : undefined;
    const status = await handleInput(token, event);
    return { ok: status === 'ok', status };
  });
  ipcMain.handle('remote-control:stats', async () => getStats());
}

module.exports = { registerRemoteControlHandler, handleInput, startSession, endSession, getActiveSession, getStats };
