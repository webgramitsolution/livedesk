// Provider interfaces for the voice translation pipeline:
//   mic -> capture/VAD -> STT (streaming) -> language -> MT -> TTS per receiver.
// Every stage is swappable so hosted and self-hosted providers can be mixed.

export interface SttSegment {
  /** Stable id for the utterance (interim updates reuse the id until final). */
  id: string;
  text: string;
  isFinal: boolean;
  /** 0..1 when the engine reports it, null otherwise. */
  confidence: number | null;
  /** Detected or configured source language (supported code) or null when unknown. */
  language: string | null;
  at: number;
}

export type SttStatus = 'idle' | 'starting' | 'listening' | 'error' | 'unavailable';

export interface SttStartOptions {
  /** BCP-47 locale hint for the recognizer. */
  locale: string;
  onSegment: (segment: SttSegment) => void;
  onStatus: (status: SttStatus, detail?: string) => void;
}

export interface SttProvider {
  readonly name: string;
  isAvailable(): boolean;
  start(options: SttStartOptions): Promise<void>;
  stop(): void;
}

export interface TranslationResult {
  text: string;
  detectedSource: string | null;
}

export interface TranslationProvider {
  readonly name: string;
  translate(text: string, source: string | null, target: string): Promise<TranslationResult>;
}

export interface TtsProvider {
  readonly name: string;
  isAvailable(): boolean;
  /** Speak `text` in `language`; resolves when playback ends or is cancelled. */
  speak(text: string, language: string, options?: { rate?: number; volume?: number }): Promise<void>;
  cancel(): void;
}

/** Wire payload on the `stt` data-plane topic. */
export interface TranscriptMessage {
  kind: 'segment';
  segId: string;
  speakerId: string;
  speakerName: string;
  text: string;
  isFinal: boolean;
  confidence: number | null;
  sourceLanguage: string;
  at: number;
}

/** Wire payload on the `state` topic announcing a participant's language. */
export interface LanguageMessage {
  type: 'language';
  language: string;
}

export const LOW_CONFIDENCE_THRESHOLD = 0.55;
