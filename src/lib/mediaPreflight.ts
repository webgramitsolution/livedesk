// Shared handoff for the media stream acquired during the pre-join device check,
// so the meeting reuses the exact same granted tracks instead of re-prompting
// (a second concurrent getUserMedia is what made devices appear "Blocked").

let readyStream: MediaStream | null = null;

function isLive(stream: MediaStream | null): stream is MediaStream {
  return !!stream && stream.getTracks().some((t) => t.readyState === 'live');
}

export function setPreflightStream(stream: MediaStream | null) {
  if (readyStream && readyStream !== stream) {
    readyStream.getTracks().forEach((t) => t.stop());
  }
  readyStream = stream;
}

export function takePreflightStream(): MediaStream | null {
  const stream = readyStream;
  readyStream = null;
  return isLive(stream) ? stream : null;
}

export function clearPreflightStream() {
  readyStream?.getTracks().forEach((t) => t.stop());
  readyStream = null;
}

export async function queryMediaPermissions(): Promise<{ mic: PermissionState | 'unknown'; camera: PermissionState | 'unknown' }> {
  const q = async (name: 'microphone' | 'camera'): Promise<PermissionState | 'unknown'> => {
    try {
      const status = await navigator.permissions?.query({ name: name as PermissionName });
      return status?.state ?? 'unknown';
    } catch {
      return 'unknown';
    }
  };
  const [mic, camera] = await Promise.all([q('microphone'), q('camera')]);
  return { mic, camera };
}
