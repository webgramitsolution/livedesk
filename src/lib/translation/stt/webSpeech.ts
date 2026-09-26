import type { SttProvider, SttSegment, SttStartOptions } from '../types';
import { normalizeLanguageCode } from '../languages';

// Minimal typing for the Web Speech API (not in every TS DOM lib).
interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as typeof window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Browser-native streaming recognizer (Chromium, Safari). Runs off the main
 * thread inside the browser's speech service. It cannot auto-detect the
 * language, so the caller passes the speaker's configured (or preferred)
 * locale. Restarts itself while active because engines stop after silence.
 */
export class WebSpeechSttProvider implements SttProvider {
  readonly name = 'web-speech';
  private recognition: SpeechRecognitionLike | null = null;
  private active = false;
  private utteranceSeq = 0;
  private currentId: string | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  isAvailable(): boolean {
    return getCtor() !== null;
  }

  async start(options: SttStartOptions): Promise<void> {
    const Ctor = getCtor();
    if (!Ctor) {
      options.onStatus('unavailable', 'Speech recognition is not supported in this browser');
      return;
    }
    this.stop();
    this.active = true;
    options.onStatus('starting');
    const language = normalizeLanguageCode(options.locale);

    const spin = () => {
      if (!this.active) return;
      const rec = new Ctor();
      rec.lang = options.locale;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onstart = () => options.onStatus('listening');
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const result = e.results[i];
          const alt = result[0];
          if (!alt) continue;
          const text = alt.transcript.trim();
          if (!text) continue;
          if (!this.currentId) {
            this.utteranceSeq += 1;
            this.currentId = `ws-${Date.now().toString(36)}-${this.utteranceSeq}`;
          }
          const segment: SttSegment = {
            id: this.currentId,
            text,
            isFinal: result.isFinal,
            confidence: typeof alt.confidence === 'number' && alt.confidence > 0 ? alt.confidence : null,
            language,
            at: Date.now(),
          };
          options.onSegment(segment);
          if (result.isFinal) this.currentId = null;
        }
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          this.active = false;
          options.onStatus('error', 'Microphone access for speech recognition was blocked');
          return;
        }
        if (e.error === 'network') {
          options.onStatus('error', 'Speech recognition service unreachable');
          return;
        }
        // 'no-speech' and 'aborted' are routine; the restart below handles them.
      };
      rec.onend = () => {
        this.currentId = null;
        if (!this.active) return;
        this.restartTimer = setTimeout(spin, 250);
      };
      this.recognition = rec;
      try {
        rec.start();
      } catch (err) {
        options.onStatus('error', err instanceof Error ? err.message : 'Could not start speech recognition');
        this.restartTimer = setTimeout(spin, 1000);
      }
    };
    spin();
  }

  stop(): void {
    this.active = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const rec = this.recognition;
    this.recognition = null;
    this.currentId = null;
    if (rec) {
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
  }
}
