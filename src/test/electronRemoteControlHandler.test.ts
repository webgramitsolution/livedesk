import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * End-to-end-ish test for the Electron main-process remote-control handler.
 *
 * We can't launch a full Electron runtime inside this sandbox, so we mock
 * `electron` (ipcMain + screen) and `@nut-tree-fork/nut-js`, then drive the
 * exact code path that runs when a viewer's RC input messages arrive over
 * the renderer bridge:
 *
 *   viewer input msg → renderer inputExecutor → ipcRenderer.invoke →
 *   ipcMain.handle('remote-control:input') → handleInput → nut.mouse/keyboard
 *
 * We assert that a realistic multi-viewer session (mouse move + click +
 * wheel + keydown/keyup) is faithfully translated into nut-js calls, and
 * that coordinates are resolution-normalized against the primary display.
 */

type NutMock = {
  mouse: {
    setPosition: ReturnType<typeof vi.fn>;
    pressButton: ReturnType<typeof vi.fn>;
    releaseButton: ReturnType<typeof vi.fn>;
    click: ReturnType<typeof vi.fn>;
    doubleClick: ReturnType<typeof vi.fn>;
    scrollDown: ReturnType<typeof vi.fn>;
    scrollUp: ReturnType<typeof vi.fn>;
    scrollLeft: ReturnType<typeof vi.fn>;
    scrollRight: ReturnType<typeof vi.fn>;
    config: { mouseSpeed: number };
  };
  keyboard: {
    pressKey: ReturnType<typeof vi.fn>;
    releaseKey: ReturnType<typeof vi.fn>;
    config: { autoDelayMs: number };
  };
  Point: new (x: number, y: number) => { x: number; y: number };
  Button: { LEFT: 'L'; RIGHT: 'R'; MIDDLE: 'M' };
  Key: Record<string, string>;
};

const nutMock: NutMock = {
  mouse: {
    setPosition: vi.fn(async () => {}),
    pressButton: vi.fn(async () => {}),
    releaseButton: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
    doubleClick: vi.fn(async () => {}),
    scrollDown: vi.fn(async () => {}),
    scrollUp: vi.fn(async () => {}),
    scrollLeft: vi.fn(async () => {}),
    scrollRight: vi.fn(async () => {}),
    config: { mouseSpeed: 0 },
  },
  keyboard: {
    pressKey: vi.fn(async () => {}),
    releaseKey: vi.fn(async () => {}),
    config: { autoDelayMs: 0 },
  },
  Point: class {
    constructor(public x: number, public y: number) {}
  } as NutMock['Point'],
  Button: { LEFT: 'L', RIGHT: 'R', MIDDLE: 'M' },
  Key: { A: 'A', Enter: 'Enter', LeftShift: 'LeftShift' },
};

const ipcHandlers = new Map<string, (evt: unknown, payload: unknown) => Promise<unknown>>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (evt: unknown, payload: unknown) => Promise<unknown>) => {
      ipcHandlers.set(channel, fn);
    },
  },
  screen: {
    getPrimaryDisplay: () => ({ size: { width: 1920, height: 1080 } }),
  },
}));

vi.mock('@nut-tree-fork/nut-js', () => nutMock);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { registerRemoteControlHandler } = require('../../electron/remoteControlHandler.cjs') as {
  registerRemoteControlHandler: () => void;
};

async function invoke(payload: unknown) {
  const handler = ipcHandlers.get('remote-control:input');
  if (!handler) throw new Error('remote-control:input handler not registered');
  return handler({}, payload);
}

describe('Electron remoteControlHandler — nut-js integration', () => {
  beforeEach(() => {
    Object.values(nutMock.mouse).forEach((v) => {
      if (typeof v === 'function') (v as ReturnType<typeof vi.fn>).mockClear();
    });
    Object.values(nutMock.keyboard).forEach((v) => {
      if (typeof v === 'function') (v as ReturnType<typeof vi.fn>).mockClear();
    });
    ipcHandlers.clear();
    registerRemoteControlHandler();
  });

  it('translates a multi-viewer session (move/click/wheel/keydown) into resolution-scaled nut-js calls', async () => {
    // Viewer 1: moves to centre of a 1920x1080 display.
    await invoke({ type: 'mousemove', x: 0.5, y: 0.5 });
    const firstMove = nutMock.mouse.setPosition.mock.calls[0][0];
    expect(firstMove.x).toBe(960);
    expect(firstMove.y).toBe(540);

    // Viewer 1: right-clicks near bottom-right.
    await invoke({ type: 'click', x: 1, y: 1, button: 'right', detail: 1 });
    expect(nutMock.mouse.click).toHaveBeenCalledWith('R');

    // Viewer 2: scrolls down, then up-and-right.
    await invoke({ type: 'wheel', x: 0.5, y: 0.5, deltaX: 0, deltaY: 120 });
    expect(nutMock.mouse.scrollDown).toHaveBeenCalledWith(120);

    await invoke({ type: 'wheel', x: 0.5, y: 0.5, deltaX: 40, deltaY: -60 });
    expect(nutMock.mouse.scrollUp).toHaveBeenCalledWith(60);
    expect(nutMock.mouse.scrollRight).toHaveBeenCalledWith(40);

    // Viewer 2: types A while holding shift.
    await invoke({
      type: 'keydown',
      key: 'a',
      code: 'KeyA',
      ctrl: false,
      shift: true,
      alt: false,
      meta: false,
    });
    await invoke({
      type: 'keyup',
      key: 'a',
      code: 'KeyA',
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
    });
    expect(nutMock.keyboard.pressKey).toHaveBeenCalledWith('A');
    expect(nutMock.keyboard.releaseKey).toHaveBeenCalledWith('A');
  });

  it('double-click detail routes to nut.doubleClick, single stays on click', async () => {
    await invoke({ type: 'click', x: 0.25, y: 0.25, button: 'left', detail: 2 });
    expect(nutMock.mouse.doubleClick).toHaveBeenCalledWith('L');
    expect(nutMock.mouse.click).not.toHaveBeenCalled();

    await invoke({ type: 'click', x: 0.25, y: 0.25, button: 'left', detail: 1 });
    expect(nutMock.mouse.click).toHaveBeenCalledWith('L');
  });
});