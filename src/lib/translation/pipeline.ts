import { LOW_CONFIDENCE_THRESHOLD, type TranscriptMessage } from './types';
import type { TranslationAudioMode } from '@/store/meetingStore';

// Pure decision helpers for the receiver side of the pipeline (unit tested).

export interface ReceiverDecision {
  /** Translate this segment into the receiver's language. */
  translate: boolean;
  /** Speak the translation aloud. */
  speak: boolean;
  /** Why translation was skipped, for the UI. */
  reason: 'same-language' | 'low-confidence' | 'disabled' | 'interim' | null;
}

export function decideForSegment(
  message: Pick<TranscriptMessage, 'isFinal' | 'confidence' | 'sourceLanguage'>,
  receiver: { enabled: boolean; preferredLanguage: string; audioMode: TranslationAudioMode },
): ReceiverDecision {
  if (!receiver.enabled) return { translate: false, speak: false, reason: 'disabled' };
  if (!message.isFinal) return { translate: false, speak: false, reason: 'interim' };
  if (message.sourceLanguage === receiver.preferredLanguage) return { translate: false, speak: false, reason: 'same-language' };
  if (message.confidence !== null && message.confidence < LOW_CONFIDENCE_THRESHOLD) {
    return { translate: false, speak: false, reason: 'low-confidence' };
  }
  return { translate: true, speak: receiver.audioMode !== 'original', reason: null };
}

/**
 * Volume for a remote speaker's ORIGINAL audio given the receiver's settings.
 * The original track is never stopped; only local playback volume changes so
 * "translated" mode does not overlap two voices.
 */
export function originalAudioVolume(
  speakerLanguage: string | null,
  receiver: { enabled: boolean; preferredLanguage: string; audioMode: TranslationAudioMode; ttsAvailable: boolean },
): number {
  if (!receiver.enabled) return 1;
  if (!speakerLanguage || speakerLanguage === receiver.preferredLanguage) return 1;
  if (!receiver.ttsAvailable) return 1;
  switch (receiver.audioMode) {
    case 'translated':
      return 0;
    case 'both':
      return 0.35;
    case 'original':
    default:
      return 1;
  }
}

/** Speaker-side gate: publish only meaningful text, throttling interim updates. */
export function shouldPublishSegment(
  segment: { text: string; isFinal: boolean; at: number },
  lastInterimAt: number,
  minInterimGapMs = 400,
): boolean {
  if (!segment.text.trim()) return false;
  if (segment.isFinal) return true;
  return segment.at - lastInterimAt >= minInterimGapMs;
}
