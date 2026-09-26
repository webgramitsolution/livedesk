// Languages offered for per-participant preferred language and STT source
// language. Codes are BCP-47 primary subtags; `bcp47` is the locale handed to
// speech engines (recognition and synthesis).

export interface LanguageOption {
  code: string;
  label: string;
  nativeLabel: string;
  bcp47: string;
}

export const SUPPORTED_LANGUAGES = [
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी', bcp47: 'hi-IN' },
  { code: 'en', label: 'English', nativeLabel: 'English', bcp47: 'en-US' },
  { code: 'ta', label: 'Tamil', nativeLabel: 'தமிழ்', bcp47: 'ta-IN' },
  { code: 'te', label: 'Telugu', nativeLabel: 'తెలుగు', bcp47: 'te-IN' },
  { code: 'bn', label: 'Bengali', nativeLabel: 'বাংলা', bcp47: 'bn-IN' },
  { code: 'mr', label: 'Marathi', nativeLabel: 'मराठी', bcp47: 'mr-IN' },
  { code: 'gu', label: 'Gujarati', nativeLabel: 'ગુજરાતી', bcp47: 'gu-IN' },
  { code: 'kn', label: 'Kannada', nativeLabel: 'ಕನ್ನಡ', bcp47: 'kn-IN' },
  { code: 'ml', label: 'Malayalam', nativeLabel: 'മലയാളം', bcp47: 'ml-IN' },
  { code: 'pa', label: 'Punjabi', nativeLabel: 'ਪੰਜਾਬੀ', bcp47: 'pa-IN' },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', bcp47: 'ar-SA' },
  { code: 'fr', label: 'French', nativeLabel: 'Français', bcp47: 'fr-FR' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español', bcp47: 'es-ES' },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch', bcp47: 'de-DE' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português', bcp47: 'pt-BR' },
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', bcp47: 'ja-JP' },
  { code: 'zh', label: 'Chinese', nativeLabel: '中文', bcp47: 'zh-CN' },
  { code: 'ko', label: 'Korean', nativeLabel: '한국어', bcp47: 'ko-KR' },
] as const satisfies readonly LanguageOption[];

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export function languageLabel(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.label ?? code.toUpperCase();
}

export function languageLocale(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.bcp47 ?? code;
}

/** Map a BCP-47 tag or free-form engine output ("en-US", "hi_IN", "hin") to a supported code. */
export function normalizeLanguageCode(input: string | null | undefined): LanguageCode | null {
  if (!input) return null;
  const lower = input.toLowerCase().replace('_', '-');
  const primary = lower.split('-')[0];
  const direct = SUPPORTED_LANGUAGES.find((l) => l.code === primary);
  if (direct) return direct.code;
  const three: Record<string, LanguageCode> = { hin: 'hi', eng: 'en', tam: 'ta', tel: 'te', ben: 'bn', mar: 'mr', guj: 'gu', kan: 'kn', mal: 'ml', pan: 'pa', ara: 'ar', fra: 'fr', fre: 'fr', spa: 'es', deu: 'de', ger: 'de', por: 'pt', jpn: 'ja', zho: 'zh', chi: 'zh', kor: 'ko' };
  return three[primary] ?? null;
}
