// Lightweight ring-buffer logger for WebRTC / signaling / presence events.
// Used by useWebRTC + MeetingPresenceManager + PerformanceHud to help
// troubleshoot missing participants or missing audio/video.

export type WebRTCLogCategory =
  | 'signal'
  | 'peer'
  | 'track'
  | 'ice'
  | 'presence'
  | 'media'
  | 'retry'
  | 'error';

export interface WebRTCLogEntry {
  t: number; // epoch ms
  iso: string;
  category: WebRTCLogCategory;
  event: string;
  peer?: string;
  data?: Record<string, unknown>;
}

const MAX_ENTRIES = 500;
const buffer: WebRTCLogEntry[] = [];
const listeners = new Set<(entries: WebRTCLogEntry[]) => void>();

function emit() {
  const snapshot = buffer.slice();
  listeners.forEach((l) => {
    try {
      l(snapshot);
    } catch {
      /* ignore */
    }
  });
}

export function logWebRTCEvent(
  category: WebRTCLogCategory,
  event: string,
  data?: Record<string, unknown>,
  peer?: string,
) {
  const now = Date.now();
  buffer.push({
    t: now,
    iso: new Date(now).toISOString(),
    category,
    event,
    peer,
    data,
  });
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  emit();
}

export function getWebRTCLog(): WebRTCLogEntry[] {
  return buffer.slice();
}

export function clearWebRTCLog() {
  buffer.length = 0;
  emit();
}

export function subscribeWebRTCLog(fn: (entries: WebRTCLogEntry[]) => void) {
  listeners.add(fn);
  fn(buffer.slice());
  return () => {
    listeners.delete(fn);
  };
}

export function downloadWebRTCLog(filenameHint = 'meeting') {
  const payload = buildWebRTCLogPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `webrtc-log-${filenameHint}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildWebRTCLogPayload() {
  return {
    exportedAt: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    entries: buffer,
  };
}

export async function shareWebRTCLog(filenameHint = 'meeting') {
  const payload = buildWebRTCLogPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const file = new File([blob], `webrtc-log-${filenameHint}-${Date.now()}.json`, { type: 'application/json' });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData & { files?: File[] }) => boolean;
    share?: (data: ShareData & { files?: File[] }) => Promise<void>;
  };

  if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
    await nav.share({
      title: 'Meeting diagnostics log',
      text: 'WebRTC media/signaling diagnostics log',
      files: [file],
    });
    return;
  }

  downloadWebRTCLog(filenameHint);
}