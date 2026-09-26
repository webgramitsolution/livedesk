import { describe, expect, it, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../..');
const { validateInputEvent, validateSession, validateToken } = require(path.join(root, 'electron/inputValidation.cjs'));

describe('electron input validation (shared by preload and main)', () => {
  it('accepts well-formed events and strips unknown fields', () => {
    const move = validateInputEvent({ type: 'mousemove', x: 0.5, y: 0.25, extra: 'nope' });
    expect(move).toEqual({ type: 'mousemove', x: 0.5, y: 0.25 });
    const click = validateInputEvent({ type: 'click', x: 1, y: 0, button: 'right', detail: 9 });
    expect(click).toEqual({ type: 'click', x: 1, y: 0, button: 'right', detail: 3 });
    const key = validateInputEvent({ type: 'keydown', key: 'a', code: 'KeyA', ctrl: true, shift: false, alt: false, meta: false });
    expect(key?.code).toBe('KeyA');
    const wheel = validateInputEvent({ type: 'wheel', x: 0.1, y: 0.1, deltaX: 0, deltaY: 500 });
    expect(wheel?.deltaY).toBe(50);
  });

  it('rejects out-of-range coordinates, bad buttons, bad key codes and unknown types', () => {
    expect(validateInputEvent({ type: 'mousemove', x: 1.2, y: 0 })).toBeNull();
    expect(validateInputEvent({ type: 'mousemove', x: -0.1, y: 0 })).toBeNull();
    expect(validateInputEvent({ type: 'mousemove', x: '0.5', y: 0 })).toBeNull();
    expect(validateInputEvent({ type: 'click', x: 0, y: 0, button: 'back', detail: 1 })).toBeNull();
    expect(validateInputEvent({ type: 'keydown', key: 'a', code: 'Key A; rm -rf', ctrl: false, shift: false, alt: false, meta: false })).toBeNull();
    expect(validateInputEvent({ type: 'exec', cmd: 'calc' })).toBeNull();
    expect(validateInputEvent(null)).toBeNull();
  });

  it('validates tokens and session descriptors', () => {
    expect(validateToken('abcdef1234567890')).toBe(true);
    expect(validateToken('short')).toBe(false);
    expect(validateToken('has space in it!')).toBe(false);
    expect(validateSession({ token: 'abcdef1234567890', controllerId: 'peer-1', allowKeyboard: true })).toEqual({
      token: 'abcdef1234567890', controllerId: 'peer-1', allowKeyboard: true, displayId: null,
    });
    expect(validateSession({ token: 'abcdef1234567890', controllerId: 'peer-1', allowKeyboard: 'yes' })).toBeNull();
    expect(validateSession({ token: 'abcdef1234567890', controllerId: 'peer-1', allowKeyboard: true, displayId: 1.5 })).toBeNull();
  });
});

describe('electron remote-control handler session arming', () => {
  // Stub `electron` so the handler module loads under Node.
  const Module = require('node:module');
  const origResolve = Module._resolveFilename;
  let handler: {
    handleInput: (token: string, event: unknown) => Promise<string>;
    startSession: (raw: unknown) => Promise<{ ok: boolean }>;
    endSession: (token: string) => Promise<{ ok: boolean }>;
    getStats: () => Record<string, number>;
  };

  beforeEach(() => {
    Module._resolveFilename = function (request: string, ...rest: unknown[]) {
      if (request === 'electron') return '__stub_electron__';
      return origResolve.call(this, request, ...rest);
    };
    Module._cache['__stub_electron__'] = {
      exports: {
        ipcMain: { handle: () => undefined },
        screen: { getPrimaryDisplay: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }), getAllDisplays: () => [] },
      },
      loaded: true,
      id: '__stub_electron__',
    };
    delete require.cache[require.resolve(path.join(root, 'electron/remoteControlHandler.cjs'))];
    handler = require(path.join(root, 'electron/remoteControlHandler.cjs'));
  });

  it('drops input until a session is armed, then only for the armed token', async () => {
    const token = 'tok_abcdef1234567890';
    expect(await handler.handleInput(token, { type: 'mousemove', x: 0.5, y: 0.5 })).toBe('unarmed');
    expect((await handler.startSession({ token, controllerId: 'peer-1', allowKeyboard: false })).ok).toBe(true);
    expect(await handler.handleInput('tok_wrongwrongwrong', { type: 'mousemove', x: 0.5, y: 0.5 })).toBe('bad-token');
    expect(await handler.handleInput(token, { type: 'mousemove', x: 5, y: 0.5 })).toBe('invalid');
    // Keyboard is refused when the session is mouse-only.
    expect(await handler.handleInput(token, { type: 'keydown', key: 'a', code: 'KeyA', ctrl: false, shift: false, alt: false, meta: false })).toBe('keyboard-not-allowed');
    // Ending with the wrong token is refused; the right token disarms.
    expect((await handler.endSession('tok_wrongwrongwrong')).ok).toBe(false);
    expect((await handler.endSession(token)).ok).toBe(true);
    expect(await handler.handleInput(token, { type: 'mousemove', x: 0.5, y: 0.5 })).toBe('unarmed');
    const stats = handler.getStats();
    expect(stats.droppedUnarmed).toBe(2);
    expect(stats.droppedToken).toBe(1);
    expect(stats.droppedInvalid).toBe(1);
    expect(stats.droppedKeyboard).toBe(1);
  });
});
