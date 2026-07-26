// Electron main-process handler that turns RCInputEvent messages coming from
// the renderer into OS-level mouse + keyboard actions via @nut-tree-fork/nut-js.
const { ipcMain, screen } = require('electron');

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

function primaryDisplaySize() {
  const d = screen.getPrimaryDisplay();
  return { width: d.size.width, height: d.size.height };
}

function toPoint(nx, ny) {
  const { width, height } = primaryDisplaySize();
  const x = Math.max(0, Math.min(1, Number(nx))) * width;
  const y = Math.max(0, Math.min(1, Number(ny))) * height;
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
  const table = {
    Enter: K.Enter, Return: K.Return, Escape: K.Escape, Tab: K.Tab, Backspace: K.Backspace,
    Space: K.Space, ArrowUp: K.Up, ArrowDown: K.Down, ArrowLeft: K.Left, ArrowRight: K.Right,
    Home: K.Home, End: K.End, PageUp: K.PageUp, PageDown: K.PageDown, Delete: K.Delete, Insert: K.Insert,
    ShiftLeft: K.LeftShift, ShiftRight: K.RightShift,
    ControlLeft: K.LeftControl, ControlRight: K.RightControl,
    AltLeft: K.LeftAlt, AltRight: K.RightAlt,
    MetaLeft: K.LeftSuper, MetaRight: K.RightSuper,
    Minus: K.Minus, Equal: K.Equal, BracketLeft: K.LeftBracket, BracketRight: K.RightBracket,
    Backslash: K.Backslash, Semicolon: K.Semicolon, Quote: K.Quote,
    Comma: K.Comma, Period: K.Period, Slash: K.Slash,
    F1: K.F1, F2: K.F2, F3: K.F3, F4: K.F4, F5: K.F5, F6: K.F6,
    F7: K.F7, F8: K.F8, F9: K.F9, F10: K.F10, F11: K.F11, F12: K.F12,
  };
  if (table[code]) return table[code];
  if (typeof key === 'string' && key.length === 1) {
    const upper = key.toUpperCase();
    if (K[upper]) return K[upper];
  }
  return null;
}

async function handleInput(event) {
  const n = loadNut();
  if (!n) return;
  try {
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
        if ((event.detail || 1) >= 2) await n.mouse.doubleClick(btn);
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
        if (k != null) await n.keyboard.pressKey(k);
        break;
      }
      case 'keyup': {
        const k = mapKey(event.code, event.key);
        if (k != null) await n.keyboard.releaseKey(k);
        break;
      }
    }
  } catch (err) {
    console.error('[remote-control] handleInput failed:', err);
  }
}

function registerRemoteControlHandler() {
  ipcMain.handle('remote-control:input', async (_evt, event) => {
    await handleInput(event);
    return { ok: true };
  });
}

module.exports = { registerRemoteControlHandler, handleInput };