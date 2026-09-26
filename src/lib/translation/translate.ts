import { supabase } from '@/integrations/supabase/client';
import { languageLabel, normalizeLanguageCode } from './languages';
import type { TranslationProvider, TranslationResult } from './types';

const CACHE_MAX = 500;

/** Small LRU so repeated phrases (and both-path duplicates) are not re-translated. */
class TranslationCache {
  private map = new Map<string, TranslationResult>();
  get(key: string) {
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit;
  }
  set(key: string, value: TranslationResult) {
    this.map.set(key, value);
    if (this.map.size > CACHE_MAX) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
  }
}

export function withCache(provider: TranslationProvider): TranslationProvider {
  const cache = new TranslationCache();
  return {
    name: provider.name,
    async translate(text, source, target) {
      const key = `${source ?? 'auto'}|${target}|${text}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const result = await provider.translate(text, source, target);
      cache.set(key, result);
      return result;
    },
  };
}

/** Translation through the project's edge function (auth-gated). */
export class SupabaseFunctionTranslationProvider implements TranslationProvider {
  readonly name = 'supabase-fn';
  async translate(text: string, source: string | null, target: string): Promise<TranslationResult> {
    const { data, error } = await supabase.functions.invoke('translate-text', {
      body: { text, targetLanguage: target, sourceLanguage: source ?? undefined },
    });
    if (error || !data?.translatedText) {
      throw new Error(error?.message || 'Translation failed');
    }
    return { text: String(data.translatedText), detectedSource: normalizeLanguageCode(data.detectedSourceLanguage) ?? source };
  }
}

/** Self-hostable LibreTranslate-compatible endpoint. */
export class LibreTranslateProvider implements TranslationProvider {
  readonly name = 'libretranslate';
  constructor(private baseUrl: string, private apiKey?: string) {}
  async translate(text: string, source: string | null, target: string): Promise<TranslationResult> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: source ?? 'auto', target, format: 'text', api_key: this.apiKey ?? undefined }),
    });
    if (!response.ok) throw new Error(`Translation service error ${response.status}`);
    const data = (await response.json()) as { translatedText?: string; detectedLanguage?: { language?: string } };
    if (!data.translatedText) throw new Error('Translation service returned no text');
    return { text: data.translatedText, detectedSource: normalizeLanguageCode(data.detectedLanguage?.language) ?? source };
  }
}

/** Deterministic provider for tests and offline development. */
export class MockTranslationProvider implements TranslationProvider {
  readonly name = 'mock';
  constructor(private delayMs = 0) {}
  async translate(text: string, source: string | null, target: string): Promise<TranslationResult> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    return { text: `[${languageLabel(target)}] ${text}`, detectedSource: source };
  }
}

export function createTranslationProvider(): TranslationProvider {
  const kind = (import.meta.env.VITE_TRANSLATION_PROVIDER as string | undefined) ?? 'supabase-fn';
  if (kind === 'libretranslate') {
    const url = import.meta.env.VITE_LIBRETRANSLATE_URL as string | undefined;
    if (url) return withCache(new LibreTranslateProvider(url, import.meta.env.VITE_LIBRETRANSLATE_API_KEY as string | undefined));
  }
  if (kind === 'mock') return withCache(new MockTranslationProvider());
  return withCache(new SupabaseFunctionTranslationProvider());
}
