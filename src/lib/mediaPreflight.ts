// Shared handoff for the media stream acquired during the pre-join device check,
// so the meeting reuses the exact same granted tracks instead of re-prompting
// (a second concurrent getUserMedia is what made devices appear "Blocked").

let readyStream: MediaStream | null = null;

export type MediaAccessStatus = 'granted' | 'denied' | 'unavailable';

export interface MeetingMediaAccessResult {
  stream: MediaStream | null;
  mic: MediaAccessStatus;
  camera: MediaAccessStatus;
  micLabel: string;
  cameraLabel: string;
}

export const MEETING_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: { ideal: 1 },
};

export const MEETING_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: 'user',
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 24, max: 30 },
};

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

export function statusForMediaError(err: unknown): MediaAccessStatus {
  const name = (err as { name?: string })?.name;
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'unavailable';
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return 'unavailable';
  return 'denied';
}

export async function requestMeetingMedia(): Promise<MeetingMediaAccessResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      stream: null,
      mic: 'unavailable',
      camera: 'unavailable',
      micLabel: 'Microphone unsupported',
      cameraLabel: 'Camera unsupported',
    };
  }

  const merged = new MediaStream();
  let mic: MediaAccessStatus = 'denied';
  let camera: MediaAccessStatus = 'denied';
  let micLabel = 'Mic access blocked';
  let cameraLabel = 'Camera access blocked';

  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: MEETING_AUDIO_CONSTRAINTS, video: false });
    audioStream.getAudioTracks().forEach((track) => {
      track.enabled = true;
      merged.addTrack(track);
    });
    const audioTrack = merged.getAudioTracks()[0];
    if (audioTrack) {
      mic = 'granted';
      micLabel = audioTrack.label || 'Microphone';
    }
  } catch (audioErr) {
    mic = statusForMediaError(audioErr);
    micLabel = mic === 'unavailable' ? 'No microphone found' : 'Mic access blocked';
  }

  // Mobile browsers are more reliable when the camera prompt is requested after
  // the microphone prompt has settled, instead of using one combined request.
  await new Promise((resolve) => setTimeout(resolve, 120));

  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: MEETING_VIDEO_CONSTRAINTS });
    videoStream.getVideoTracks().forEach((track) => {
      track.enabled = true;
      merged.addTrack(track);
    });
    const videoTrack = merged.getVideoTracks()[0];
    if (videoTrack) {
      camera = 'granted';
      cameraLabel = videoTrack.label || 'Camera';
    }
  } catch (videoErr) {
    camera = statusForMediaError(videoErr);
    cameraLabel = camera === 'unavailable' ? 'No camera found' : 'Camera access blocked';
  }

  return {
    stream: merged.getTracks().length ? merged : null,
    mic,
    camera,
    micLabel,
    cameraLabel,
  };
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
