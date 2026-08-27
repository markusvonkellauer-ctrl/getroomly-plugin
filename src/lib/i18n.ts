// ─────────────────────────────────────────────────────────────────────────────
// GetRoomly Plugin i18n
//
// Language is resolved once per config read using this priority chain:
//   1. window.GetRoomlyEmbedConfig.language  (host page sets this explicitly)
//   2. TLD detection                         (see TLD_MAP below, default -> "en")
// See use-embed-config.ts for where this is applied to the resolved config.
//
// Each language's strings live in their own file under ./locales/ — every
// file is typed against TranslationStrings below, so a locale file missing a
// key (or with a typo'd key name) fails the build instead of silently
// falling back to English or rendering blank text in production.
// ─────────────────────────────────────────────────────────────────────────────

import { da } from './locales/da';
import { de } from './locales/de';
import { el } from './locales/el';
import { en } from './locales/en';
import { es } from './locales/es';
import { fi } from './locales/fi';
import { fr } from './locales/fr';
import { it } from './locales/it';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { nl } from './locales/nl';
import { no } from './locales/no';
import { pl } from './locales/pl';
import { pt } from './locales/pt';
import { sv } from './locales/sv';
import { zh } from './locales/zh';

/** The canonical shape every language must satisfy — see the header comment. */
export interface TranslationStrings {
  stepUpload: string;
  stepProcessing: string;
  stepResult: string;
  stepIndicatorUpload: string;
  stepIndicatorProcessing: string;
  stepIndicatorResult: string;
  launchButton: string;
  uploadButton: string;
  uploadHint: string;
  tipsHeading: string;
  tip1Label: string;
  tip1Body: string;
  tip2Label: string;
  tip2Body: string;
  tip3Label: string;
  tip3Body: string;
  termsLink: string;
  loadingMessages: string[];
  labelOriginal: string;
  labelNew: string;
  addToBasket: string;
  showNew: string;
  showOriginal: string;
  saveShare: string;
  downloadToDevice: string;
  shareWithFriends: string;
  newPhoto: string;
  termsTitle: string;
  termsSection1Title: string;
  termsSection1Body: string;
  termsSection2Title: string;
  termsLimitedDataCollectionTitle: string;
  termsLimitedDataCollectionBody: string;
  termsQualityRetentionTitle: string;
  termsQualityRetentionBody: string;
  termsSection3Title: string;
  termsSection3Body: string;
  termsSection4Title: string;
  termsSection4Body: string;
  termsClose: string;
}

export type SupportedLanguage =
  | 'en'
  | 'sv'
  | 'da'
  | 'no'
  | 'fi'
  | 'de'
  | 'nl'
  | 'fr'
  | 'pl'
  | 'zh'
  | 'ko'
  | 'ja'
  | 'es'
  | 'pt'
  | 'el'
  | 'it';

export const translations: Record<SupportedLanguage, TranslationStrings> = {
  en,
  sv,
  da,
  no,
  fi,
  de,
  nl,
  fr,
  pl,
  zh,
  ko,
  ja,
  es,
  pt,
  el,
  it,
};

export type TranslationKeys = keyof TranslationStrings;
export type Translations = TranslationStrings;

const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = Object.keys(
  translations
) as SupportedLanguage[];

/**
 * Runtime type guard — the TypeScript type on window.GetRoomlyEmbedConfig
 * only describes what a well-behaved host page WOULD send. It's actual
 * untyped JS written by partners, so a value that reaches us at runtime can
 * be any string (typo, stale integration, copy-pasted example code). This
 * is the one place that distrust is checked, so every caller downstream —
 * detectLanguage() and getTranslations() — gets the same protection.
 */
export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

// Nordic Nest's 16 market domains, confirmed 2026-08-27. .com has no entry —
// it's the generic/UK domain and falls through to the 'en' default below.
// A Map (not a plain object) so lookup can never accidentally hit an
// inherited Object.prototype property (e.g. a hostname ending in a segment
// that happens to match "toString" or "constructor").
const TLD_MAP: ReadonlyMap<string, SupportedLanguage> = new Map([
  ['se', 'sv'],
  ['dk', 'da'],
  ['no', 'no'],
  ['fi', 'fi'],
  ['de', 'de'],
  ['nl', 'nl'],
  ['fr', 'fr'],
  ['pl', 'pl'],
  ['cn', 'zh'], // Simplified Chinese, mainland China market
  ['kr', 'ko'],
  ['jp', 'ja'],
  ['es', 'es'],
  ['pt', 'pt'], // European Portuguese
  ['gr', 'el'],
  ['it', 'it'],
]);

/** TLD-based fallback: see TLD_MAP above. Unmapped TLDs (incl. .com) -> English. */
export function detectLanguageFromTLD(): SupportedLanguage {
  const hostname = window.location.hostname.toLowerCase();
  const tld = hostname.split('.').pop();
  const mapped = tld && TLD_MAP.get(tld);
  return mapped || 'en';
}

/**
 * Full priority chain: explicit host-page override, then TLD, then English.
 * Use this when there's no already-resolved `config.language` to read from
 * (e.g. inside use-embed-config.ts, before defaults are applied).
 */
export function detectLanguage(): SupportedLanguage {
  const configLang = window.GetRoomlyEmbedConfig?.language;
  if (isSupportedLanguage(configLang)) {
    return configLang;
  }
  return detectLanguageFromTLD();
}

/**
 * Returns the translation dictionary for a language. Pass an already-resolved
 * `config?.language` where available (components downstream of
 * useEmbedConfig always have one, since the hook fills in a default) — falls
 * back to running the full detection chain itself if omitted.
 *
 * Accepts `string` rather than trusting the `SupportedLanguage` type alone:
 * callers may be forwarding a value that ultimately came from an untyped
 * host page (see isSupportedLanguage above), so this validates again at the
 * point of use rather than assuming an upstream check already happened —
 * an invalid/unrecognised value falls back through the same detection chain
 * instead of returning `undefined` and crashing the caller.
 */
export function getTranslations(lang?: string): Translations {
  return translations[isSupportedLanguage(lang) ? lang : detectLanguage()];
}
