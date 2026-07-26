import type { RCInputEvent } from './protocol';

/**
 * Best-effort in-tab input dispatcher used when the presenter is a browser
 * (no Electron / nut.js available). Coordinates are normalized (0..1) against
 * the presenter's *viewport* — the only surface we can synthesize events on
 * inside a sandboxed browser tab. This works for demoing/collaborating on the
 * meeting app UI itself; it CANNOT drive the OS or other windows.
 */
export function executeBrowserInput(event: RCInputEvent) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;

  const toPx = (nx: number, ny: number) => ({
    x: Math.round(Math.max(0, Math.min(1, nx)) * vw),
    y: Math.round(Math.max(0, Math.min(1, ny)) * vh),
  });

  const buttonToInt = (b: 'left' | 'right' | 'middle') => (b === 'right' ? 2 : b === 'middle' ? 1 : 0);

  switch (event.type) {
    case 'mousemove': {
      const { x, y } = toPx(event.x, event.y);
      const el = document.elementFromPoint(x, y);
      el?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      break;
    }
    case 'mousedown':
    case 'mouseup':
    case 'click': {
      const { x, y } = toPx(event.x, event.y);
      const el = document.elementFromPoint(x, y);
      if (!el) break;
      const button = buttonToInt(event.button);
      el.dispatchEvent(
        new MouseEvent(event.type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button,
          detail: 'detail' in event ? event.detail : 1,
        }),
      );
      break;
    }
    case 'wheel': {
      const { x, y } = toPx(event.x, event.y);
      const el = document.elementFromPoint(x, y) ?? window;
      (el as EventTarget).dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
        }),
      );
      break;
    }
    case 'keydown':
    case 'keyup': {
      const target = (document.activeElement as HTMLElement) || document.body;
      target.dispatchEvent(
        new KeyboardEvent(event.type, {
          bubbles: true,
          cancelable: true,
          key: event.key,
          code: event.code,
          ctrlKey: event.ctrl,
          shiftKey: event.shift,
          altKey: event.alt,
          metaKey: event.meta,
        }),
      );
      break;
    }
  }
}

// Electron-only bridge stub; picked up automatically if the desktop build
// exposes window.electronAPI.remoteControl. In the desktop app the preload
// script (electron/preload.cjs) wires this to the nut-js handler running in
// the main process, giving full OS-level mouse + keyboard control.
interface ElectronRemoteControlBridge {
  handleInput: (event: RCInputEvent) => void;
}

export function getElectronBridge(): ElectronRemoteControlBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as typeof window & {
    electronAPI?: { remoteControl?: ElectronRemoteControlBridge };
  };
  return w.electronAPI?.remoteControl ?? null;
}

export function executeInput(event: RCInputEvent) {
  const bridge = getElectronBridge();
  if (bridge) {
    bridge.handleInput(event);
    return;
  }
  executeBrowserInput(event);
}