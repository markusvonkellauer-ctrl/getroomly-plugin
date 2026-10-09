// ─────────────────────────────────────────────────────────────────────────────
// GetRoomly Plugin i18n
//
// Language is resolved once per config read using this priority chain:
//   1. window.GetRoomlyEmbedConfig.language  (host page sets this explicitly)
//   2. TLD detection                         (see TLD_MAP below)
//   3. Staging-label detection               (see detectLanguageFromStagingLabel,
//                                              e.g. "stage-de.nordicnest.dev")
//   4. Default -> "en"
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
  // --- Upload view (redesign, Oct 2026 "D2" handoff) ---
  /** Header title for the upload step only -- replaces stepUpload there (processing/result keep stepProcessing/stepResult). Rendered next to a small "AI" badge (EmbedButton's own badge markup, recoloured for a white header). */
  uploadV2HeaderTitle: string;
  uploadV2Step1Title: string;
  uploadV2Step1Body: string;
  /** Step 2 title, default-category phrasing (found in review, Copilot PR #140: `category` is a free-form public config field that genuinely supports sofas/chairs/tables/etc, not just carpets -- a single un-split key said "the rug" for every category). See uploadV2Step3BodyDefault for the identical category-split reasoning. */
  uploadV2Step2TitleDefault: string;
  /** Step 2 title, carpets phrasing -- see uploadV2Step3BodyCarpets. */
  uploadV2Step2TitleCarpets: string;
  uploadV2Step2Body: string;
  uploadV2Step3Title: string;
  uploadV2Step3BodyDefault: string;
  uploadV2Step3BodyCarpets: string;
  uploadV2Hint: string;
  loadingMessages: string[];
  labelOriginal: string;
  labelNew: string;
  addToBasket: string;
  /** The Add to Basket button's own label swaps to this short confirmation (e.g. "Tillagt ✓") for 2400ms after a click, then reverts -- same pattern as downloadedLabel/copiedLabel. Not a status line: the button that triggered the action is the one that changes. */
  addedToBasketLabel: string;
  /** Visually-hidden role="status" aria-live="polite" text announced alongside addedToBasketLabel -- a label change on a button that already has focus isn't reliably announced by all screen readers on its own, so this full-sentence node (stays mounted, only its text changes) carries the confirmation instead. */
  addedToBasketAnnouncement: string;
  /** Before/After toggle pill on the result image (short, e.g. "Före"/"Efter") -- distinct from labelOriginal/labelNew, which are the base/overlay images' alt text and need to work as full sentence fragments there too. */
  toggleBefore: string;
  toggleAfter: string;
  toggleGroupLabel: string;
  /** aria-label on the feedback thumb group (bottom-right of the result image) -- not visible text; there's no written question on the image itself, a deliberate tradeoff (see ANDRING-5b-bildkontroller.md, "Ändring 4"). */
  feedbackQuestion: string;
  /** Shown in a confirmation pill on the image, replacing the two thumb circles in place, for 2200ms after either is clicked, then clears -- see thankForFeedback in RoomVisualizationFlow.tsx. */
  feedbackThanks: string;
  feedbackLikeLabel: string;
  feedbackDislikeLabel: string;
  favoriteLabel: string;
  favoriteLabelActive: string;
  /** Permanent measurement-accuracy disclaimer under the action row -- never replaced by a transient message. */
  disclaimer: string;
  downloadToDevice: string;
  /** The download button's own label swaps to this short confirmation (e.g. "Nedladdad ✓") for 2400ms after a click, then reverts to downloadToDevice -- replaces a separate, permanently-mounted status line that stayed empty nearly all the time. Also reused by the share button (shareWithFriends) for its own download fallback -- see handleShareWithFriends. */
  downloadedLabel: string;
  /** Visually-hidden role="status" aria-live="polite" text announced alongside downloadedLabel, on either the download or share button -- same reasoning as addedToBasketAnnouncement: a label change on a button that already has focus isn't reliably announced by all screen readers on its own. */
  downloadedAnnouncement: string;
  shareWithFriends: string;
  /** The share button's label on touch devices that open the native share sheet, where the sheet also offers "Save image" (e.g. iOS) -- same pill and width budget as shareWithFriends. */
  saveOrShare: string;
  /** Title and message handed to the OS share sheet together with the image (navigator.share). `{product}` is replaced with the product's name. The message is shown as the preview on Android and is passed to the receiving app, so it must be in the shopper's language. */
  shareTitle: string;
  shareText: string;
  /** The share button's own label swaps to this short confirmation (e.g. "Kopierad ✓") for 2400ms when its clipboard fallback succeeds (see handleShareWithFriends's 3-tier chain: native share sheet -> clipboard -> download). */
  copiedLabel: string;
  /** Visually-hidden role="status" aria-live="polite" text announced alongside copiedLabel -- same reasoning as downloadedAnnouncement above. */
  copiedAnnouncement: string;
  newPhoto: string;
  termsTitle: string;
  /** Intro paragraph shown once, above section 1 -- deliberately generic
   * (no partner name) since this same string renders on every partner's
   * site, not just one. */
  termsIntro: string;
  termsSection1Title: string;
  termsSection1Body: string;
  termsSection2Title: string;
  termsLimitedDataCollectionTitle: string;
  termsLimitedDataCollectionBody: string;
  termsQualityRetentionTitle: string;
  termsQualityRetentionBody: string;
  termsSection3Title: string;
  /** New lead paragraph, rendered before termsSection3Body -- the general
   * GDPR/international-standards commitment, distinct from the specific
   * cloud-platform paragraph that follows it. */
  termsSection3Intro: string;
  termsSection3Body: string;
  termsSection4Title: string;
  termsSection4Body: string;
  /** Links out to getroomly.ai/privacy (full policy) from the sticky footer, next to termsClose. */
  termsFullPolicyLink: string;
  termsClose: string;
  /**
   * Shown when the backend refuses a generation because the PARTNER has hit
   * their own render quota (AIGenerationError.code === 'quotaExceeded', no
   * meta.reason) — see RoomVisualizationFlow.tsx's catch block. Deliberately
   * generic: "quota" is an internal partner/billing concept with no meaning
   * to the shopper seeing this, not something to explain to them. This case
   * should be rare in practice — the launch button is normally hidden
   * before a shopper could ever trigger it (see App.tsx's partnerAvailable)
   * — but a race condition (partner gets suspended mid-session) or a host
   * page's own custom trigger button can still reach it, so it needs a
   * message too.
   */
  errorTemporarilyUnavailable: string;
  /**
   * Shown when THIS shopper's own IP has hit the weekly anti-abuse cap
   * (AIGenerationError.code === 'quotaExceeded', meta.reason === 'ipWeeklyCap')
   * — see RoomVisualizationFlow.tsx's catch block. Unlike
   * errorTemporarilyUnavailable, this case is about the shopper's own usage
   * specifically, so it's safe (and more helpful) to name the actual limit.
   * Keep "next week" rather than a precise day/countdown — vaguer on timing
   * is intentional, not a gap: it still answers "when can I try again" for a
   * genuine shopper without giving an abuser exact retry timing to plan
   * around. The cap value itself must stay in sync with
   * PARTNER_DEFAULT_WEEKLY_IP_REQUEST_CAP in getroomly-backend.
   */
  errorWeeklyLimitReached: string;
  /**
   * aria-label for the processing-step progress bar — the visible percentage
   * is decorative-adjacent text, not a programmatic label, so the
   * role="progressbar" element needs its own accessible name.
   */
  loadingProgressLabel: string;
  /**
   * Shown when an uploaded photo is HEIC/HEIF (the default iPhone camera
   * format) and client-side conversion to JPEG fails or can't load — see
   * heic.ts's convertHeicToJpeg and RoomVisualizationFlow.tsx's
   * handleFileSelect. Names the fix (re-export as JPEG/PNG) rather than the
   * technical cause, since "HEIC" and "decode" mean nothing to a shopper.
   */
  errorUnsupportedImageFormat: string;
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

// Staging/preview environments are commonly named with an environment
// keyword and a market code joined by a hyphen in one hostname label (e.g.
// Nordic Nest's "stage-de.nordicnest.dev", "stage-no.nordicnest.dev") — the
// TLD itself (.dev) never matches TLD_MAP, so without this, every staging
// domain silently falls back to English regardless of market.
//
// Deliberately narrow to reduce false positives: requires an EXACT
// environment keyword AND an exact market code as the two hyphen-separated
// parts of one label — not a substring search. A substring search would
// also match unrelated things like "de-luxe-collection" (contains "de") or
// "no-reply" (contains "no"). This pattern only fires for the specific
// {env}-{code} / {code}-{env} shape, so those don't match at all.
const ENVIRONMENT_LABEL_KEYWORDS: ReadonlySet<string> = new Set([
  'stage',
  'staging',
  'test',
  'dev',
  'qa',
  'preprod',
  'uat',
]);

function detectLanguageFromStagingLabel(hostname: string): SupportedLanguage {
  for (const label of hostname.split('.')) {
    const parts = label.split('-');
    if (parts.length !== 2) {
      continue;
    }
    const [first, second] = parts;
    if (ENVIRONMENT_LABEL_KEYWORDS.has(first) && TLD_MAP.has(second)) {
      return TLD_MAP.get(second) as SupportedLanguage;
    }
    if (ENVIRONMENT_LABEL_KEYWORDS.has(second) && TLD_MAP.has(first)) {
      return TLD_MAP.get(first) as SupportedLanguage;
    }
  }
  return 'en';
}

/**
 * TLD-based detection: see TLD_MAP above. Checked first (production domains
 * always resolve here) — only when that finds no match does this fall
 * through to detectLanguageFromStagingLabel's narrower staging-hostname
 * pattern. Unmapped/unmatched on both -> English.
 */
export function detectLanguageFromTLD(): SupportedLanguage {
  const hostname = window.location.hostname.toLowerCase();
  const tld = hostname.split('.').pop();
  const mapped = tld && TLD_MAP.get(tld);
  if (mapped) {
    return mapped;
  }
  return detectLanguageFromStagingLabel(hostname);
}

/**
 * Full priority chain: explicit host-page override, then TLD, then the
 * staging-label fallback (see detectLanguageFromStagingLabel above), then
 * English. Use this when there's no already-resolved `config.language` to
 * read from (e.g. inside use-embed-config.ts, before defaults are applied).
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
