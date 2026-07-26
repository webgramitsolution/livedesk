// Real-dependency Electron remote-control integration harness.
//
// This replaces the previous Vitest test that stubbed `@nut-tree-fork/nut-js`
// out entirely. Here we load the ACTUAL nut-js module (native libnut binding
// + real Key/Button enums, real mouse/keyboard config), invoke the actual
// handler from electron/remoteControlHandler.cjs, and assert that every
// input event is faithfully translated into a real nut-js call.
//
// Only Electron's `ipcMain`+`screen` — a thin wrapper the handler uses to
// register the IPC channel and to read the primary display size — is
// stubbed. Bundling the full Electron binary just to instantiate ipcMain
// would add ~200 MB to the repo for a marginal integration gain.
//
// Runtime requirements (documented in package.json's `test:electron` script):
//   - LD_LIBRARY_PATH must include libX11 / libXtst / libXext / libXi /
//     libXinerama / libXrandr so libnut can dlopen them.
//   - An X display (xvfb-run is fine — nut-js only needs *any* display).
import { createRequire } from 'module';
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Real nut-js (loaded from node_modules, not mocked) ----------
let nut;
try {
  nut = require('@nut-tree-fork/nut-js');
} catch (err) {
  console.error('electron-rc-integration: failed to load @nut-tree-fork/nut-js.');
  console.error(err.message);
  console.error(
    'Ensure LD_LIBRARY_PATH includes libX11/libXtst/libXext/libXi/libXinerama/libXrandr and that an X display is available (xvfb-run).',
  );
  process.exit(2);
}

// Instrument every function on nut.mouse / nut.keyboard so we can assert on
// call arguments AFTER the real call has run. We call through to the real
// implementation so the test exercises real nut-js code paths, not just its
// public shape.
const calls = [];
function instrument(obj, label, methods) {
  for (const name of methods) {
    const original = obj[name];
    if (typeof original !== 'function') continue;
    obj[name] = async function (...args) {
      calls.push({ obj: label, method: name, args });
      return original.apply(this, args);
    };
  }
}
instrument(nut.mouse, 'mouse', [
  'setPosition', 'pressButton', 'releaseButton', 'click', 'doubleClick',
  'scrollDown', 'scrollUp', 'scrollLeft', 'scrollRight',
]);
instrument(nut.keyboard, 'keyboard', ['pressKey', 'releaseKey']);

// ---------- Minimal Electron stub (ipcMain + screen only) ----------
const Module = require('module');
const ipcHandlers = new Map();
const electronStub = {
  ipcMain: {
    handle: (channel, fn) => ipcHandlers.set(channel, fn),
  },
  screen: {
    getPrimaryDisplay: () => ({ size: { width: 1920, height: 1080 } }),
  },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return '__stub_electron__';
  return origResolve.call(this, request, parent, ...rest);
};
Module._cache['__stub_electron__'] = {
  exports: electronStub, loaded: true, id: '__stub_electron__',
};

// ---------- Load the REAL handler ----------
const { registerRemoteControlHandler } = require(
  path.resolve(__dirname, '../electron/remoteControlHandler.cjs'),
);
registerRemoteControlHandler();
const handler = ipcHandlers.get('remote-control:input');
assert.ok(handler, 'handler registered on remote-control:input');

async function invoke(event) {
  await handler({}, event);
}

function firstCall(objLabel, method) {
  return calls.find((c) => c.obj === objLabel && c.method === method);
}

// ---------- Scenario: multi-viewer session ----------
// Two viewers taking turns, exercising every mouse+keyboard path the
// handler supports. Assertions verify resolution-normalized coords and
// nut-js API contract on the REAL library.
await invoke({ type: 'mousemove', x: 0.5, y: 0.5 });
const move = firstCall('mouse', 'setPosition');
assert.ok(move, 'setPosition called');
assert.strictEqual(move.args[0].x, 960, `x expected 960, got ${move.args[0].x}`);
assert.strictEqual(move.args[0].y, 540, `y expected 540, got ${move.args[0].y}`);

// Viewer 1: single right-click at bottom-right.
await invoke({ type: 'click', x: 1, y: 1, button: 'right', detail: 1 });
const rClick = firstCall('mouse', 'click');
assert.ok(rClick, 'right click called');
assert.strictEqual(rClick.args[0], nut.Button.RIGHT, 'button was RIGHT');

// Viewer 2: scroll down 3 clicks, then scroll up 2 clicks and right 1 click.
await invoke({ type: 'wheel', x: 0.5, y: 0.5, deltaX: 0, deltaY: 3 });
assert.ok(firstCall('mouse', 'scrollDown'), 'scrollDown called');
assert.strictEqual(firstCall('mouse', 'scrollDown').args[0], 3, 'scrollDown 3');

await invoke({ type: 'wheel', x: 0.5, y: 0.5, deltaX: 1, deltaY: -2 });
assert.ok(firstCall('mouse', 'scrollUp'), 'scrollUp called');
assert.strictEqual(firstCall('mouse', 'scrollUp').args[0], 2, 'scrollUp 2');
assert.ok(firstCall('mouse', 'scrollRight'), 'scrollRight called');
assert.strictEqual(firstCall('mouse', 'scrollRight').args[0], 1, 'scrollRight 1');

// Viewer 2: double-click at quarter-position.
await invoke({ type: 'click', x: 0.25, y: 0.25, button: 'left', detail: 2 });
const dClick = firstCall('mouse', 'doubleClick');
assert.ok(dClick, 'doubleClick called');
assert.strictEqual(dClick.args[0], nut.Button.LEFT, 'button was LEFT');

// Viewer 2: types "A" — press then release. Uses the real nut.Key.A enum.
await invoke({ type: 'keydown', key: 'a', code: 'KeyA', ctrl: false, shift: true, alt: false, meta: false });
await invoke({ type: 'keyup', key: 'a', code: 'KeyA', ctrl: false, shift: false, alt: false, meta: false });
const press = firstCall('keyboard', 'pressKey');
const release = firstCall('keyboard', 'releaseKey');
assert.ok(press, 'pressKey called');
assert.strictEqual(press.args[0], nut.Key.A, `Key.A: expected ${nut.Key.A}, got ${press.args[0]}`);
assert.ok(release, 'releaseKey called');
assert.strictEqual(release.args[0], nut.Key.A, 'release Key.A');

// ---------- Summary ----------
console.log(`electron-rc-integration: OK — ${calls.length} real nut-js calls verified against libnut`);
console.log(
  `  mouse: setPosition=${calls.filter((c) => c.obj === 'mouse' && c.method === 'setPosition').length}, ` +
    `click=${calls.filter((c) => c.obj === 'mouse' && c.method === 'click').length}, ` +
    `doubleClick=${calls.filter((c) => c.obj === 'mouse' && c.method === 'doubleClick').length}, ` +
    `scrolls=${calls.filter((c) => c.obj === 'mouse' && c.method.startsWith('scroll')).length}`,
);
console.log(
  `  keyboard: pressKey=${calls.filter((c) => c.obj === 'keyboard' && c.method === 'pressKey').length}, ` +
    `releaseKey=${calls.filter((c) => c.obj === 'keyboard' && c.method === 'releaseKey').length}`,
);