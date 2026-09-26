import { describe, expect, it } from 'vitest';
import { decideForSegment, originalAudioVolume, shouldPublishSegment } from '@/lib/translation/pipeline';
import { MockTranslationProvider, withCache } from '@/lib/translation/translate';
import { normalizeLanguageCode, languageLabel } from '@/lib/translation/languages';

const receiver = (overrides: Partial<{ enabled: boolean; preferredLanguage: string; audioMode: 'original' | 'translated' | 'both' }> = {}) => ({
  enabled: true,
  preferredLanguage: 'ta',
  audioMode: 'translated' as const,
  ...overrides,
});

describe('translation routing decisions', () => {
  it('Hindi speech is translated and spoken for a Tamil listener', () => {
    const d = decideForSegment({ isFinal: true, confidence: 0.9, sourceLanguage: 'hi' }, receiver());
    expect(d).toEqual({ translate: true, speak: true, reason: null });
  });

  it('Tamil speech reaches a Hindi listener and English speech reaches French and Arabic listeners', () => {
    expect(decideForSegment({ isFinal: true, confidence: null, sourceLanguage: 'ta' }, receiver({ preferredLanguage: 'hi' })).translate).toBe(true);
    expect(decideForSegment({ isFinal: true, confidence: 0.8, sourceLanguage: 'en' }, receiver({ preferredLanguage: 'fr' })).translate).toBe(true);
    expect(decideForSegment({ isFinal: true, confidence: 0.8, sourceLanguage: 'en' }, receiver({ preferredLanguage: 'ar' })).translate).toBe(true);
  });

  it('never invents a translation for low-confidence speech or interim text', () => {
    expect(decideForSegment({ isFinal: true, confidence: 0.3, sourceLanguage: 'hi' }, receiver()).reason).toBe('low-confidence');
    expect(decideForSegment({ isFinal: false, confidence: 0.9, sourceLanguage: 'hi' }, receiver()).reason).toBe('interim');
  });

  it('does not translate when languages match or translation is off', () => {
    expect(decideForSegment({ isFinal: true, confidence: 0.9, sourceLanguage: 'ta' }, receiver()).reason).toBe('same-language');
    expect(decideForSegment({ isFinal: true, confidence: 0.9, sourceLanguage: 'hi' }, receiver({ enabled: false })).reason).toBe('disabled');
  });

  it('audio mode "original" translates captions but does not speak', () => {
    const d = decideForSegment({ isFinal: true, confidence: 0.9, sourceLanguage: 'hi' }, receiver({ audioMode: 'original' }));
    expect(d.translate).toBe(true);
    expect(d.speak).toBe(false);
  });
});

describe('original vs translated audio layers', () => {
  const base = { enabled: true, preferredLanguage: 'ta', ttsAvailable: true };
  it('mutes the original voice only for translated mode and a different language', () => {
    expect(originalAudioVolume('hi', { ...base, audioMode: 'translated' })).toBe(0);
    expect(originalAudioVolume('ta', { ...base, audioMode: 'translated' })).toBe(1);
    expect(originalAudioVolume('hi', { ...base, audioMode: 'original' })).toBe(1);
    expect(originalAudioVolume('hi', { ...base, audioMode: 'both' })).toBeGreaterThan(0);
  });
  it('keeps the original voice when translation is off, language unknown, or TTS unavailable', () => {
    expect(originalAudioVolume('hi', { ...base, audioMode: 'translated', enabled: false })).toBe(1);
    expect(originalAudioVolume(null, { ...base, audioMode: 'translated' })).toBe(1);
    expect(originalAudioVolume('hi', { ...base, audioMode: 'translated', ttsAvailable: false })).toBe(1);
  });
});

describe('speaker-side publishing', () => {
  it('always publishes finals, throttles interims, drops empty text', () => {
    expect(shouldPublishSegment({ text: '', isFinal: true, at: 1000 }, 0)).toBe(false);
    expect(shouldPublishSegment({ text: 'namaste', isFinal: true, at: 1000 }, 900)).toBe(true);
    expect(shouldPublishSegment({ text: 'nam', isFinal: false, at: 1000 }, 900)).toBe(false);
    expect(shouldPublishSegment({ text: 'namas', isFinal: false, at: 1500 }, 900)).toBe(true);
  });
});

describe('translation provider plumbing', () => {
  it('caches identical requests and labels targets', async () => {
    let calls = 0;
    const inner = new MockTranslationProvider();
    const counting = { name: 'x', translate: (t: string, s: string | null, g: string) => { calls += 1; return inner.translate(t, s, g); } };
    const provider = withCache(counting);
    const a = await provider.translate('kal meeting kitne baje hai?', 'hi', 'ta');
    const b = await provider.translate('kal meeting kitne baje hai?', 'hi', 'ta');
    expect(a.text).toBe('[Tamil] kal meeting kitne baje hai?');
    expect(b).toEqual(a);
    expect(calls).toBe(1);
  });

  it('normalizes engine language tags', () => {
    expect(normalizeLanguageCode('hi-IN')).toBe('hi');
    expect(normalizeLanguageCode('ta_IN')).toBe('ta');
    expect(normalizeLanguageCode('eng')).toBe('en');
    expect(normalizeLanguageCode('xx')).toBeNull();
    expect(languageLabel('ar')).toBe('Arabic');
  });
});
