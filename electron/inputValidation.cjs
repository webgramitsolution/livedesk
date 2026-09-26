// Strict validation for everything that crosses the renderer -> main boundary
// on its way to OS-level automation. Shared by preload.cjs (first line of
// defence) and remoteControlHandler.cjs (authoritative check in main). Pure
// CommonJS with no Electron imports so it is unit-testable under Node.

const MAX_TOKEN_LENGTH = 128;
const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;
const BUTTONS = new Set(['left', 'right', 'middle']);
const KEY_CODE_RE = /^[A-Za-z0-9]{1,32}$/;

function isNum01(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isBool(v) {
  return typeof v === 'boolean';
}

function validateToken(token) {
  return typeof token === 'string' && token.length <= MAX_TOKEN_LENGTH && TOKEN_RE.test(token);
}

/**
 * Returns a sanitized copy of a control-session descriptor or null.
 * { token, controllerId, allowKeyboard, displayId? }
 */
function validateSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!validateToken(raw.token)) return null;
  if (typeof raw.controllerId !== 'string' || raw.controllerId.length === 0 || raw.controllerId.length > 256) return null;
  if (!isBool(raw.allowKeyboard)) return null;
  let displayId = null;
  if (raw.displayId !== undefined && raw.displayId !== null) {
    if (!Number.isInteger(raw.displayId)) return null;
    displayId = raw.displayId;
  }
  return { token: raw.token, controllerId: raw.controllerId, allowKeyboard: raw.allowKeyboard, displayId };
}

/**
 * Returns a sanitized copy of an input event or null. Only whitelisted fields
 * survive, so nothing else from the renderer reaches nut-js.
 */
function validateInputEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  switch (raw.type) {
    case 'mousemove':
      if (!isNum01(raw.x) || !isNum01(raw.y)) return null;
      return { type: 'mousemove', x: raw.x, y: raw.y };
    case 'mousedown':
    case 'mouseup':
      if (!isNum01(raw.x) || !isNum01(raw.y) || !BUTTONS.has(raw.button)) return null;
      return { type: raw.type, x: raw.x, y: raw.y, button: raw.button };
    case 'click': {
      if (!isNum01(raw.x) || !isNum01(raw.y) || !BUTTONS.has(raw.button)) return null;
      const detail = Number.isInteger(raw.detail) ? Math.max(1, Math.min(3, raw.detail)) : 1;
      return { type: 'click', x: raw.x, y: raw.y, button: raw.button, detail };
    }
    case 'wheel': {
      if (!isNum01(raw.x) || !isNum01(raw.y) || !isFiniteNumber(raw.deltaX) || !isFiniteNumber(raw.deltaY)) return null;
      const clamp = (v) => Math.max(-50, Math.min(50, v));
      return { type: 'wheel', x: raw.x, y: raw.y, deltaX: clamp(raw.deltaX), deltaY: clamp(raw.deltaY) };
    }
    case 'keydown':
    case 'keyup':
      if (typeof raw.key !== 'string' || raw.key.length === 0 || raw.key.length > 32) return null;
      if (typeof raw.code !== 'string' || !KEY_CODE_RE.test(raw.code)) return null;
      if (!isBool(raw.ctrl) || !isBool(raw.shift) || !isBool(raw.alt) || !isBool(raw.meta)) return null;
      return { type: raw.type, key: raw.key, code: raw.code, ctrl: raw.ctrl, shift: raw.shift, alt: raw.alt, meta: raw.meta };
    default:
      return null;
  }
}

module.exports = { validateToken, validateSession, validateInputEvent };
