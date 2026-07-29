// Shared handoff for the media stream acquired during the pre-join device check,
// so the meeting reuses the exact same granted tracks instead of re-prompting
// (a second concurrent getUserMedia is what made devices appear "Blocked").

let readyStream: MediaStream | null = null;

export type MediaAccessStatus = 'granted' | 'denied' | 'unavailable';
export type MediaErrorReason =
  | 'unsupported'
  | 'permission-denied'
  | 'device-not-found'
  | 'device-busy'
  | 'constraints-failed'
  | 'request-aborted'
  | 'unknown-error';

export interface MeetingMediaAccessResult {
  stream: MediaStream | null;
  mic: MediaAccessStatus;
  camera: MediaAccessStatus;
  micLabel: string;
  cameraLabel: string;
  micReason?: MediaErrorReason;
  cameraReason?: MediaErrorReason;
}

export interface RequestMeetingMediaOptions {
  audio?: boolean;
  video?: boolean;
  preferCombined?: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  facingMode?: 'user' | 'environment';
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

export function reasonForMediaError(err: unknown): MediaErrorReason {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'permission-denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'device-not-found';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'device-busy';
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return 'constraints-failed';
  if (name === 'AbortError') return 'request-aborted';
  return 'unknown-error';
}

function cleanDeviceId(deviceId?: string) {
  return deviceId && deviceId !== 'default' ? deviceId : undefined;
}

export function buildAudioConstraints(deviceId?: string): MediaTrackConstraints {
  const exactDeviceId = cleanDeviceId(deviceId);
  return {
    ...MEETING_AUDIO_CONSTRAINTS,
    ...(exactDeviceId ? { deviceId: { exact: exactDeviceId } } : {}),
  };
}

export function buildVideoConstraints(deviceId?: string, facingMode: 'user' | 'environment' = 'user'): MediaTrackConstraints {
  const exactDeviceId = cleanDeviceId(deviceId);
  return {
    ...MEETING_VIDEO_CONSTRAINTS,
    facingMode: exactDeviceId ? undefined : facingMode,
    ...(exactDeviceId ? { deviceId: { exact: exactDeviceId } } : {}),
  };
}

export async function requestMeetingMedia(options: RequestMeetingMediaOptions = {}): Promise<MeetingMediaAccessResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      stream: null,
      mic: 'unavailable',
      camera: 'unavailable',
      micLabel: 'Microphone unsupported',
      cameraLabel: 'Camera unsupported',
      micReason: 'unsupported',
      cameraReason: 'unsupported',
    };
  }

  const merged = new MediaStream();
  const wantsAudio = options.audio ?? true;
  const wantsVideo = options.video ?? true;
  const preferCombined = options.preferCombined ?? true;
  let mic: MediaAccessStatus = 'denied';
  let camera: MediaAccessStatus = 'denied';
  let micLabel = 'Mic access blocked';
  let cameraLabel = 'Camera access blocked';
  let micReason: MediaErrorReason | undefined;
  let cameraReason: MediaErrorReason | undefined;

  if (!wantsAudio) {
    mic = 'unavailable';
    micLabel = 'Microphone not requested';
  }
  if (!wantsVideo) {
    camera = 'unavailable';
    cameraLabel = 'Camera not requested';
  }

  try {
    if (!preferCombined || (!wantsAudio && !wantsVideo)) throw new DOMException('Combined request skipped', 'AbortError');
    const combined = await navigator.mediaDevices.getUserMedia({
      audio: wantsAudio ? buildAudioConstraints(options.audioDeviceId) : false,
      video: wantsVideo ? buildVideoConstraints(options.videoDeviceId, options.facingMode) : false,
    });
    combined.getTracks().forEach((track) => {
      track.enabled = true;
      merged.addTrack(track);
    });
    const audioTrack = merged.getAudioTracks()[0];
    const videoTrack = merged.getVideoTracks()[0];
    if (audioTrack) {
      mic = 'granted';
      micLabel = audioTrack.label || 'Microphone';
      micReason = undefined;
    }
    if (videoTrack) {
      camera = 'granted';
      cameraLabel = videoTrack.label || 'Camera';
      cameraReason = undefined;
    }
    return {
      stream: merged.getTracks().length ? merged : null,
      mic,
      camera,
      micLabel,
      cameraLabel,
      micReason,
      cameraReason,
    };
  } catch (combinedErr) {
    const reason = reasonForMediaError(combinedErr);
    if (wantsAudio) micReason = reason;
    if (wantsVideo) cameraReason = reason;
    // Fall back to individual requests so a bad/missing camera doesn't block
    // the microphone, and a missing mic doesn't block camera-only joining.
  }

  if (wantsAudio) try {
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(options.audioDeviceId), video: false });
    audioStream.getAudioTracks().forEach((track) => {
      track.enabled = true;
      merged.addTrack(track);
    });
    const audioTrack = merged.getAudioTracks()[0];
    if (audioTrack) {
      mic = 'granted';
      micLabel = audioTrack.label || 'Microphone';
      micReason = undefined;
    }
  } catch (audioErr) {
    mic = statusForMediaError(audioErr);
    micReason = reasonForMediaError(audioErr);
    micLabel = mic === 'unavailable' ? 'No microphone found' : 'Mic access blocked';
  }

  if (wantsVideo) try {
    const videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: buildVideoConstraints(options.videoDeviceId, options.facingMode) });
    videoStream.getVideoTracks().forEach((track) => {
      track.enabled = true;
      merged.addTrack(track);
    });
    const videoTrack = merged.getVideoTracks()[0];
    if (videoTrack) {
      camera = 'granted';
      cameraLabel = videoTrack.label || 'Camera';
      cameraReason = undefined;
    }
  } catch (videoErr) {
    camera = statusForMediaError(videoErr);
    cameraReason = reasonForMediaError(videoErr);
    cameraLabel = camera === 'unavailable' ? 'No camera found' : 'Camera access blocked';
  }

  return {
    stream: merged.getTracks().length ? merged : null,
    mic,
    camera,
    micLabel,
    cameraLabel,
    micReason,
    cameraReason,
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
