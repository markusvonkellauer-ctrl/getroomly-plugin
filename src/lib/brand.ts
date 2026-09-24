// ─────────────────────────────────────────────────────────────────────────────
// GetRoomly Plugin brand theming
//
// Nordic Nest runs two sister brands (Nordic Nest, Svensson) on separate
// domains, each with its own colour identity, but both share ONE partner API
// key and integration snippet -- there's no per-site config today the way
// there is for e.g. productImage/sku, so per-site colour has to be detected,
// the same way language already is (see detectLanguageFromTLD in i18n.ts).
// Substring matching, not an exact hostname map: both brand names appear
// consistently across production AND staging domains (confirmed by the
// partner), so this stays correct across any future subdomain/environment
// without needing an exact list kept in sync.
// ─────────────────────────────────────────────────────────────────────────────

export type PluginBrand = 'nordicnest' | 'svensson';

const BRAND_HOSTNAME_KEYWORDS: ReadonlyArray<readonly [string, PluginBrand]> = [
  ['nordicnest', 'nordicnest'],
  ['svensson', 'svensson'],
];

/**
 * Returns the matched brand, or `null` for any hostname that doesn't
 * contain a known brand keyword -- `null` means "use the default GetRoomly
 * theme", not an error. Case-insensitive: real hostnames are always
 * lowercase, but this is defensive against a host page's own casing quirks,
 * mirroring detectLanguageFromTLD's own `.toLowerCase()` call.
 */
export function detectBrandFromHostname(hostname: string): PluginBrand | null {
  const lower = hostname.toLowerCase();
  for (const [keyword, brand] of BRAND_HOSTNAME_KEYWORDS) {
    if (lower.includes(keyword)) {
      return brand;
    }
  }
  return null;
}

export function detectBrand(): PluginBrand | null {
  return detectBrandFromHostname(window.location.hostname);
}

/**
 * One entry per --getroomly-* custom property that carries brand identity
 * (accent colour, backgrounds, and every text/icon role split out of
 * RoomVisualizationFlow.tsx's inline styles -- see index.css for the full
 * default set each of these overrides). Alpha channels are preserved from
 * the default value wherever the original colour used one (tip label,
 * tips heading, terms link/hover, upload hint) -- only the hue changes to
 * black. The one alpha NOT collapsed to a flat value is the terms
 * link/hover pair: that 0.6/0.8 split is the hover state's actual visual
 * feedback, not decorative, so removing it would remove the affordance,
 * not just restyle it.
 */
const NORDIC_NEST_THEME: Readonly<Record<string, string>> = {
  '--getroomly-primary': '#000000',
  '--getroomly-primary-deep': '#000000',
  '--getroomly-primary-press': '#000000',
  '--getroomly-primary-tint': '#F3F3F3',
  '--getroomly-icon-default': '#000000',
  '--getroomly-tip-label': 'rgba(0, 0, 0, 0.8)',
  '--getroomly-tips-heading': 'rgba(0, 0, 0, 0.8)',
  '--getroomly-toggle-inactive': '#000000',
  '--getroomly-tertiary-text': '#000000',
  '--getroomly-disclaimer': '#000000',
  '--getroomly-terms-link': 'rgba(0, 0, 0, 0.6)',
  '--getroomly-terms-link-hover': 'rgba(0, 0, 0, 0.8)',
  '--getroomly-dialog-heading': '#000000',
  '--getroomly-dialog-body': '#000000',
  '--getroomly-header-title': 'rgba(0, 0, 0, 0.8)',
  '--getroomly-upload-hint': 'rgba(0, 0, 0, 0.5)',
  '--getroomly-guidance-border': 'rgba(0, 0, 0, 0.05)',
  // Processing-step spinner gradient (loading-spinner.css): light (tint)
  // to dark (primary), same 3-stop structure as the default teal gradient.
  // --getroomly-spinner-mid has no client-given value -- linearly
  // interpolated between the tint and primary black at the gradient's own
  // 45% stop position, so the animated blob still reads as a smooth
  // gradient instead of two flat colour bands.
  '--getroomly-spinner-start': '#F3F3F3',
  '--getroomly-spinner-mid': '#868686',
  '--getroomly-spinner-end': '#000000',
  // Found in review: the linear progress bar's fill is a brand accent
  // element (like a button), not part of the spinner's own gradient --
  // maps to the primary black, not the spinner's interpolated grey
  // mid-tone, so it doesn't stay teal while the rest of the processing UI
  // has already switched to black/tint.
  '--getroomly-progress-fill': '#000000',
  // Same rule as every other colour token above: swap the hue to black,
  // keep the alpha/blur/spread exactly as-is -- a black glow under a
  // black button, not a green one left over from the default theme.
  '--getroomly-upload-button-shadow': '0 10px 24px -10px rgba(0, 0, 0, 0.6)',
  // Square corners on every rectangular/pill element -- NOT applied to any
  // circular element (favourite button, feedback thumbs, close buttons, tip/
  // step number badges), which stay literal border-radius:50%/999px-on-a-
  // square in the component itself, untouched by these tokens entirely (see
  // index.css's own comment on this token group for why: a circle is a
  // different shape language, not "very rounded corners").
  '--getroomly-radius-pill': '0',
  '--getroomly-radius-card': '0',
  '--getroomly-radius-image': '0',
  '--getroomly-radius-modal': '0',
  '--getroomly-radius-sm': '0',
  '--getroomly-radius-xs': '0',
};

const SVENSSON_THEME: Readonly<Record<string, string>> = {
  ...NORDIC_NEST_THEME,
  '--getroomly-primary-tint': '#F1EFED',
  '--getroomly-spinner-start': '#F1EFED',
  '--getroomly-spinner-mid': '#858382',
};

const BRAND_THEMES: Readonly<Record<PluginBrand, Readonly<Record<string, string>>>> = {
  nordicnest: NORDIC_NEST_THEME,
  svensson: SVENSSON_THEME,
};

/**
 * CSS text for a `<style>` element to append AFTER the base
 * index.css content in the same Shadow DOM -- `:host` here targets the
 * <getroomly-plugin> element itself (see shadow-entry.tsx), matching index.css's
 * own `:root, :host` rule at equal specificity, so later-in-the-cascade
 * wins without needing !important. Returns '' for `null` (no known brand
 * matched -- inject nothing, the default theme already in the base
 * stylesheet applies unchanged).
 *
 * Also switches the typeface to `inherit` for both brands ("gärna våra
 * native typsnitt om möjligt") -- rather than hardcoding a specific font
 * family (which would need a name/URL from the partner and a maintained
 * @font-face), this lets the plugin pick up whatever font is already active
 * on the host page at the point the <getroomly-plugin> element sits, no
 * partner-supplied font name needed. Three selector groups, not one:
 * `:host` alone would be beaten by index.css's own
 * `h1, h2 { font-family: var(--heading) }` rule, which has higher selector
 * specificity -- matching that exact selector here, at equal specificity,
 * wins on cascade order (this style element is appended after the base
 * one) the same way the :host colour overrides above do. `button, input,
 * select, textarea` is its own separate group for the same reason, found
 * in review: browsers' UA stylesheets commonly give form controls their
 * own font-family that does NOT reliably inherit from an ancestor by
 * default (the classic "why does my button ignore my font-family"
 * problem, historically inconsistent across browsers) -- without this,
 * every button's label (Upload Photo, Add to Basket, Share, ...) would
 * stay in the browser's default UI font even though headings and plain
 * text correctly picked up the host's.
 */
export function brandThemeCss(brand: PluginBrand | null): string {
  if (!brand) {
    return '';
  }
  const theme = BRAND_THEMES[brand];
  const declarations = Object.entries(theme)
    .map(([property, value]) => `  ${property}: ${value};`)
    .join('\n');
  return (
    `:host {\n${declarations}\n}\n` +
    `h1, h2, :host {\n  font-family: inherit;\n}\n` +
    `button, input, select, textarea {\n  font-family: inherit;\n}`
  );
}
