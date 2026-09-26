import { logWebRTCEvent } from './webrtcLogger';

export async function recoverRemoteAudioPlayback(reason = 'manual') {
  if (typeof document === 'undefined') return { total: 0, played: 0, blocked: 0 };

  const elements = Array.from(document.querySelectorAll<HTMLAudioElement>('audio[data-remote-audio="true"]'));
  let played = 0;
  let blocked = 0;

  await Promise.all(
    elements.map(async (audio, index) => {
      try {
        // Elements flagged by permission enforcement stay muted.
        if (audio.dataset.forceMuted !== 'true') audio.muted = false;
        audio.volume = 1;
        await audio.play();
        played += 1;
      } catch (error) {
        blocked += 1;
        logWebRTCEvent('media', 'remote-audio-playback-blocked', {
          reason,
          index,
          error: error instanceof Error ? error.name : String(error),
        });
      }
    }),
  );

  if (elements.length > 0) {
    logWebRTCEvent('media', 'remote-audio-playback-recovery', {
      reason,
      total: elements.length,
      played,
      blocked,
    });
  }

  return { total: elements.length, played, blocked };
}