/**
 * i18n Tests — Nordic Nest's 16-market language support
 */

import {
  detectLanguage,
  detectLanguageFromTLD,
  getTranslations,
  translations,
} from '../../src/lib/i18n';

const ALL_LANGUAGES = [
  'en',
  'sv',
  'da',
  'no',
  'fi',
  'de',
  'nl',
  'fr',
  'pl',
  'zh',
  'ko',
  'ja',
  'es',
  'pt',
  'el',
  'it',
];

// Every key present in the English dictionary — the canonical shape every
// other language's translation object must also satisfy. TypeScript already
// enforces this at compile time (each locale file is typed against
// TranslationStrings), but this runtime check catches anything that could
// slip past that — e.g. an empty string standing in for a real translation,
// which the type system can't detect since '' is still a valid string.
const REQUIRED_KEYS = Object.keys(translations.en);

function setHostname(hostname) {
  Object.defineProperty(window, 'location', {
    value: { hostname },
    writable: true,
  });
}

describe("i18n: TLD detection (Nordic Nest's 16 market domains)", () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
    delete window.GetRoomlyEmbedConfig;
  });

  const domainToLanguage = {
    'nordicnest.se': 'sv',
    'nordicnest.dk': 'da',
    'nordicnest.no': 'no',
    'nordicnest.fi': 'fi',
    'nordicnest.de': 'de',
    'nordicnest.nl': 'nl',
    'nordicnest.fr': 'fr',
    'nordicnest.pl': 'pl',
    'nordicnest.cn': 'zh',
    'nordicnest.kr': 'ko',
    'nordicnest.jp': 'ja',
    'nordicnest.es': 'es',
    'nordicnest.pt': 'pt',
    'nordicnest.gr': 'el',
    'nordicnest.it': 'it',
  };

  for (const [domain, expectedLang] of Object.entries(domainToLanguage)) {
    it(`resolves ${domain} to "${expectedLang}"`, () => {
      setHostname(domain);
      expect(detectLanguageFromTLD()).toBe(expectedLang);
    });
  }

  it('resolves nordicnest.com to English (generic/UK domain, confirmed 2026-08-27)', () => {
    setHostname('nordicnest.com');
    expect(detectLanguageFromTLD()).toBe('en');
  });

  it('falls back to English for an unrecognised TLD', () => {
    setHostname('example.xyz');
    expect(detectLanguageFromTLD()).toBe('en');
  });

  it('resolves correctly regardless of subdomain', () => {
    setHostname('shop.nordicnest.de');
    expect(detectLanguageFromTLD()).toBe('de');
  });

  it('detectLanguage() prefers an explicit window.GetRoomlyEmbedConfig.language over TLD', () => {
    setHostname('nordicnest.de'); // would resolve to 'de' via TLD alone
    window.GetRoomlyEmbedConfig = { language: 'fr' };
    expect(detectLanguage()).toBe('fr');
  });

  it('detectLanguage() ignores an invalid explicit language and falls back to TLD', () => {
    setHostname('nordicnest.jp');
    window.GetRoomlyEmbedConfig = { language: 'not-a-real-language' };
    expect(detectLanguage()).toBe('ja');
  });
});

describe('i18n: translation completeness across all 16 languages', () => {
  it('supports exactly the 16 confirmed Nordic Nest market languages', () => {
    expect(Object.keys(translations).sort()).toEqual([...ALL_LANGUAGES].sort());
  });

  for (const lang of ALL_LANGUAGES) {
    it(`"${lang}" has every required key, non-empty`, () => {
      const dict = translations[lang];
      for (const key of REQUIRED_KEYS) {
        expect(dict).toHaveProperty(key);
        const value = dict[key];
        if (Array.isArray(value)) {
          expect(value.length).toBeGreaterThan(0);
          for (const item of value) {
            expect(typeof item).toBe('string');
            expect(item.trim().length).toBeGreaterThan(0);
          }
        } else {
          expect(typeof value).toBe('string');
          expect(value.trim().length).toBeGreaterThan(0);
        }
      }
    });

    it(`"${lang}" has exactly the same key set as English (no extra/missing keys)`, () => {
      expect(Object.keys(translations[lang]).sort()).toEqual([...REQUIRED_KEYS].sort());
    });

    it(`"${lang}" has 5 loading messages`, () => {
      expect(translations[lang].loadingMessages).toHaveLength(5);
    });
  }

  it('getTranslations(lang) returns the matching dictionary', () => {
    for (const lang of ALL_LANGUAGES) {
      expect(getTranslations(lang)).toBe(translations[lang]);
    }
  });
});
