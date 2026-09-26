import type { RCInputEvent } from './protocol';

/**
 * Narrow view of the preload bridge exposed by the desktop app. Every method
 * is validated again in the main process; this file only types the surface.
 */
export interface ElectronRemoteControlBridge {
  /** Arm OS-level input for one control session. Input is ignored until armed. */
  startSession: (session: { token: string; controllerId: string; allowKeyboard: boolean; displayId?: number | null }) => Promise<{ ok: boolean; reason?: string }>;
  /** Disarm; any further input is dropped until the next startSession. */
  endSession: (token: string) => Promise<{ ok: boolean }>;
  /** Execute one validated input event for the armed session. */
  handleInput: (token: string, event: RCInputEvent) => void;
}

export interface ElectronDesktopBridge {
  isElectron: true;
  platform: string;
  remoteControl: ElectronRemoteControlBridge;
  screenShare: {
    /** Receive the source list when the app asks for a display-media choice. */
    onSourcesRequested: (handler: (sources: Array<{ id: string; name: string; thumbnail: string; kind: 'screen' | 'window'; displayId?: string }>) => void) => () => void;
    /** Answer with a source id, or null to cancel. */
    chooseSource: (sourceId: string | null, withAudio: boolean) => void;
  };
}

export function getElectronDesktop(): ElectronDesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as typeof window & { electronAPI?: Partial<ElectronDesktopBridge> };
  const api = w.electronAPI;
  if (!api || api.isElectron !== true || !api.remoteControl) return null;
  return api as ElectronDesktopBridge;
}

export function isElectronDesktop(): boolean {
  return getElectronDesktop() !== null;
}
