// ─────────────────────────────────────────────────────────────────────────────
// GetRoomly Plugin i18n
//
// Ported from GetRoomly/src/lib/i18n.ts (the demo storefront repo), where this
// dictionary was fully built out but never wired into any UI. This is the real
// home for it — the actual embeddable widget partners load.
//
// Language is resolved once per config read using this priority chain:
//   1. window.GetRoomlyEmbedConfig.language  (host page sets this explicitly)
//   2. TLD detection                         (.se -> "sv", default -> "en")
// See use-embed-config.ts for where this is applied to the resolved config.
// ─────────────────────────────────────────────────────────────────────────────

export type SupportedLanguage = 'en' | 'sv';

export const translations = {
  en: {
    stepUpload: 'Upload Photo',
    stepProcessing: 'Transforming your space...',
    stepResult: 'Review Your New Room',
    stepIndicatorUpload: 'Upload',
    stepIndicatorProcessing: 'Processing',
    stepIndicatorResult: 'Result',
    launchButton: 'Visualize in Your Room',
    uploadButton: 'Upload Photo',
    uploadHint: 'JPEG, PNG • MAX 10MB',
    tipsHeading: 'For best results:',
    tip1Label: 'Angle & Distance:',
    tip1Body: 'Stand 1–2 metres back and point towards the floor. Capture furniture for scale.',
    tip2Label: 'Lighting:',
    tip2Body: 'Ensure the room is well-lit. Avoid deep shadows or dark corners.',
    tip3Label: 'Clear Space:',
    tip3Body: 'Remove small clutter from the floor area where the rug will be placed.',
    termsLink: 'Terms of Use & Privacy',
    loadingMessages: [
      'Analysing room geometry...',
      'Detecting ambient light...',
      'Scaling product to floor...',
      'Applying neural textures...',
      'Finalising photorealistic render...',
    ],
    labelOriginal: 'Original Room',
    labelNew: 'New Design',
    addToBasket: 'Add to Basket',
    showNew: 'Show New',
    showOriginal: 'Show Original',
    saveShare: 'Save / Share',
    downloadToDevice: 'Download to Device',
    shareWithFriends: 'Share with Friends',
    newPhoto: 'New Photo',
    termsTitle: 'Terms of Use & Privacy',
    termsSection1Title: '1. Purpose of Image Processing',
    termsSection1Body:
      'By uploading an image, you grant GetRoomly a temporary licence to process the photo to visualise furniture products in your environment. The AI analyses room geometry and lighting to provide a realistic preview.',
    termsSection2Title: '2. Data Minimisation & Privacy',
    termsLimitedDataCollectionTitle: 'Limited Data Collection',
    termsLimitedDataCollectionBody:
      'We do not collect names, email addresses, or IP addresses linked to your identity.',
    termsQualityRetentionTitle: 'Quality Assurance Retention',
    termsQualityRetentionBody:
      'Your photo and the generated visualisation are stored on secure servers within the EU/EEA for up to 14 days for internal quality review, then automatically deleted. They are never used to train AI models or shared with third parties, and are linked only to a temporary session reference — never to your name, email, or IP address. If a generation attempt is refused, the same photo and the technical details of that attempt are stored under these same terms, so we can investigate and improve reliability.',
    termsSection3Title: '3. Data Security',
    termsSection3Body:
      'Your photo is processed using a leading global cloud technology platform trusted by major international businesses, under contractual data protection safeguards equivalent to GDPR requirements (such as Standard Contractual Clauses) wherever processing occurs. Your data is never used to train third-party AI models. Photos retained for quality evaluation are stored as described in Section 2, with access restricted to authorised GetRoomly personnel only.',
    termsSection4Title: '4. Ownership',
    termsSection4Body:
      'You retain all ownership of your original photos. GetRoomly and its partners retain all rights to the product visualisations and the underlying AI technology.',
    termsClose: 'Close',
  },
  sv: {
    stepUpload: 'Ladda upp foto',
    stepProcessing: 'Transformerar ditt rum...',
    stepResult: 'Granska ditt nya rum',
    stepIndicatorUpload: 'Ladda upp',
    stepIndicatorProcessing: 'Bearbetar',
    stepIndicatorResult: 'Resultat',
    launchButton: 'Visualisera i ditt rum',
    uploadButton: 'Ladda upp foto',
    uploadHint: 'JPEG, PNG • MAX 10MB',
    tipsHeading: 'För bästa resultat:',
    tip1Label: 'Vinkel & avstånd:',
    tip1Body: 'Stå 1–2 meter bort och rikta kameran mot golvet. Fånga med möbler för skala.',
    tip2Label: 'Belysning:',
    tip2Body: 'Se till att rummet är välbelyst. Undvik djupa skuggor eller mörka hörn.',
    tip3Label: 'Rent golv:',
    tip3Body: 'Ta bort skräp från golvytan där mattan ska placeras.',
    termsLink: 'Användarvillkor & Integritet',
    loadingMessages: [
      'Analyserar rumsgeometri...',
      'Identifierar ljussättning...',
      'Skalar produkt mot golvet...',
      'Applicerar neurala texturer...',
      'Slutför fotorealistisk rendering...',
    ],
    labelOriginal: 'Originalrum',
    labelNew: 'Ny design',
    addToBasket: 'Lägg i varukorg',
    showNew: 'Visa ny',
    showOriginal: 'Visa original',
    saveShare: 'Spara / Dela',
    downloadToDevice: 'Ladda ner till enhet',
    shareWithFriends: 'Dela med vänner',
    newPhoto: 'Nytt foto',
    termsTitle: 'Användarvillkor & Integritet',
    termsSection1Title: '1. Syfte med bildbehandling',
    termsSection1Body:
      'Genom att ladda upp en bild ger du GetRoomly en tillfällig licens att behandla fotot för att visualisera möbelprodukter i din miljö. AI:n analyserar rumsgeometri och ljussättning för att ge en realistisk förhandsgranskning.',
    termsSection2Title: '2. Dataminimering & Integritet',
    termsLimitedDataCollectionTitle: 'Begränsad datainsamling',
    termsLimitedDataCollectionBody:
      'Vi samlar inte in namn, e-postadresser eller IP-adresser kopplade till din identitet.',
    termsQualityRetentionTitle: 'Lagring för kvalitetssäkring',
    termsQualityRetentionBody:
      'Ditt foto och den genererade visualiseringen lagras på säkra servrar inom EU/EES i upp till 14 dagar för intern kvalitetsgranskning och raderas därefter automatiskt. De används aldrig för att träna AI-modeller eller delas med tredje part, och kopplas endast till en tillfällig sessionsreferens — aldrig till ditt namn, e-post eller IP-adress. Om ett genereringsförsök avvisas lagras samma foto och de tekniska detaljerna för det försöket enligt samma villkor, så att vi kan utreda och förbättra tillförlitligheten.',
    termsSection3Title: '3. Datasäkerhet',
    termsSection3Body:
      'Ditt foto behandlas via en ledande global molnplattform som används av stora internationella företag, med avtalsmässiga dataskyddsgarantier som motsvarar GDPR-kraven (exempelvis Standardavtalsklausuler) oavsett var behandlingen sker. Din data används aldrig för att träna tredjeparts-AI-modeller. Bilder som sparas för kvalitetsutvärdering lagras enligt beskrivningen i avsnitt 2, med åtkomst begränsad till behöriga GetRoomly-medarbetare.',
    termsSection4Title: '4. Äganderätt',
    termsSection4Body:
      'Du behåller all äganderätt till dina originalfoton. GetRoomly och dess partners behåller alla rättigheter till produktvisualiseringarna och den underliggande AI-tekniken.',
    termsClose: 'Stäng',
  },
} as const;

export type TranslationKeys = keyof typeof translations.en;
// Union, not just `typeof translations.en` — indexing `translations` by a
// SupportedLanguage union (as getTranslations does below) yields a union of
// both language objects' literal types, which isn't assignable to the `en`
// shape alone (sv's string literals aren't the same literal types as en's).
export type Translations = typeof translations.en | typeof translations.sv;

/** TLD-based fallback: `.se` -> Swedish, everything else -> English. */
export function detectLanguageFromTLD(): SupportedLanguage {
  const hostname = window.location.hostname;
  if (hostname.endsWith('.se')) {
    return 'sv';
  }
  return 'en';
}

/**
 * Full priority chain: explicit host-page override, then TLD, then English.
 * Use this when there's no already-resolved `config.language` to read from
 * (e.g. inside use-embed-config.ts, before defaults are applied).
 */
export function detectLanguage(): SupportedLanguage {
  const configLang = window.GetRoomlyEmbedConfig?.language;
  if (configLang === 'sv' || configLang === 'en') {
    return configLang;
  }
  return detectLanguageFromTLD();
}

/**
 * Returns the translation dictionary for a language. Pass an already-resolved
 * `config?.language` where available (components downstream of
 * useEmbedConfig always have one, since the hook fills in a default) — falls
 * back to running the full detection chain itself if omitted.
 */
export function getTranslations(lang?: SupportedLanguage): Translations {
  return translations[lang ?? detectLanguage()];
}
