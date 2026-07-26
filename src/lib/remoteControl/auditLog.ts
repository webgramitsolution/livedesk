// Audit log for remote-control sessions. Records request / grant / deny /
// revoke / auto-revoke events with ISO timestamps and supports JSON download
// for troubleshooting.

export type RCAuditAction =
  | 'request'
  | 'cancel'
  | 'grant'
  | 'deny'
  | 'revoke'
  | 'auto-revoke'
  | 'reclaim'
  | 'queue-added'
  | 'queue-removed';

export interface RCAuditEntry {
  t: number;
  iso: string;
  action: RCAuditAction;
  actorId?: string;
  actorName?: string;
  targetId?: string;
  targetName?: string;
  mode?: 'mouse' | 'mouse+keyboard';
  reason?: string;
  meetingId?: string;
}

const MAX_ENTRIES = 500;
const buffer: RCAuditEntry[] = [];
const listeners = new Set<(entries: RCAuditEntry[]) => void>();

function emit() {
  const snap = buffer.slice();
  listeners.forEach((l) => {
    try {
      l(snap);
    } catch {
      /* ignore */
    }
  });
}

export function logRCAudit(entry: Omit<RCAuditEntry, 't' | 'iso'>) {
  const now = Date.now();
  buffer.push({ t: now, iso: new Date(now).toISOString(), ...entry });
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  emit();
}

export function getRCAudit(): RCAuditEntry[] {
  return buffer.slice();
}

export function clearRCAudit() {
  buffer.length = 0;
  emit();
}

export function subscribeRCAudit(fn: (entries: RCAuditEntry[]) => void) {
  listeners.add(fn);
  fn(buffer.slice());
  return () => {
    listeners.delete(fn);
  };
}

export function downloadRCAudit(filenameHint = 'meeting') {
  const payload = {
    exportedAt: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    entries: buffer,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `remote-control-audit-${filenameHint}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}