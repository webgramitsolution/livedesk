import type { RCInputEvent } from './protocol';
import { getElectronDesktop } from './electronBridge';

/**
 * Best-effort in-tab input dispatcher used when the presenter is a browser
 * (no Electron / nut.js available). Coordinates are normalized (0..1) against
 * the presenter's *viewport*, the only surface a sandboxed tab can synthesize
 * events on. This demonstrates collaboration on the meeting app UI itself; it
 * CANNOT drive the OS or other windows. The desktop app provides real control.
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

/** Which execution surface is available on this presenter. */
export type ControlCapability = 'os' | 'in-app';

export function getControlCapability(): ControlCapability {
  return getElectronDesktop() ? 'os' : 'in-app';
}

/**
 * Execute a validated, authorized input event. `token` must be the control
 * session token issued at grant time; the desktop main process only executes
 * input for the currently armed token.
 */
export function executeInput(event: RCInputEvent, token: string) {
  const desktop = getElectronDesktop();
  if (desktop) {
    desktop.remoteControl.handleInput(token, event);
    return;
  }
  executeBrowserInput(event);
}
