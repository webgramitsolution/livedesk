import { languageLocale } from './languages';
import type { TtsProvider } from './types';

/**
 * Browser speech synthesis. Voices are picked per language; utterances are
 * queued per provider instance so translated sentences play in order without
 * overlapping each other.
 */
export class WebSpeechTtsProvider implements TtsProvider {
  readonly name = 'web-speech-tts';
  private queue: Array<() => Promise<void>> = [];
  private running = false;
  private voices: SpeechSynthesisVoice[] = [];

  constructor() {
    if (this.isAvailable()) {
      this.voices = window.speechSynthesis.getVoices();
      window.speechSynthesis.addEventListener?.('voiceschanged', () => {
        this.voices = window.speechSynthesis.getVoices();
      });
    }
  }

  isAvailable(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  /** Whether a voice exists for the language (otherwise the engine may fall back to the default voice). */
  hasVoiceFor(language: string): boolean {
    return this.pickVoice(language) !== null;
  }

  private pickVoice(language: string): SpeechSynthesisVoice | null {
    const locale = languageLocale(language).toLowerCase();
    const primary = locale.split('-')[0];
    if (this.voices.length === 0 && this.isAvailable()) this.voices = window.speechSynthesis.getVoices();
    const exact = this.voices.find((v) => v.lang.toLowerCase() === locale);
    if (exact) return exact;
    const partial = this.voices.find((v) => v.lang.toLowerCase().startsWith(primary));
    return partial ?? null;
  }

  speak(text: string, language: string, options: { rate?: number; volume?: number } = {}): Promise<void> {
    if (!this.isAvailable()) return Promise.resolve();
    return new Promise((resolve) => {
      this.queue.push(
        () =>
          new Promise<void>((done) => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = languageLocale(language);
            const voice = this.pickVoice(language);
            if (voice) utterance.voice = voice;
            utterance.rate = options.rate ?? 1.05;
            utterance.volume = options.volume ?? 1;
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              done();
              resolve();
            };
            utterance.onend = finish;
            utterance.onerror = finish;
            // Safety net: some engines never fire onend after cancel().
            setTimeout(finish, Math.min(30_000, 2000 + text.length * 90));
            window.speechSynthesis.speak(utterance);
          }),
      );
      void this.drain();
    });
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) await next();
    }
    this.running = false;
  }

  cancel(): void {
    this.queue = [];
    if (this.isAvailable()) window.speechSynthesis.cancel();
  }
}
