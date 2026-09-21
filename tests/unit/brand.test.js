/**
 * Brand theming tests — Nordic Nest / Svensson hostname-based detection
 */

import { detectBrandFromHostname, detectBrand, brandThemeCss } from '../../src/lib/brand';

function setHostname(hostname) {
  Object.defineProperty(window, 'location', {
    value: { hostname },
    writable: true,
    configurable: true,
  });
}

describe('detectBrandFromHostname', () => {
  const cases = {
    'nordicnest.se': 'nordicnest',
    'www.nordicnest.com': 'nordicnest',
    'shop.nordicnest.de': 'nordicnest',
    'stage-de.nordicnest.dev': 'nordicnest',
    'svensson.se': 'svensson',
    'svenssons.se': 'svensson', // "svensson" is a substring of "svenssons" -- deliberately still matches
    'shop.svensson.dk': 'svensson',
    'stage-svensson.dev': 'svensson',
  };

  for (const [hostname, expectedBrand] of Object.entries(cases)) {
    it(`resolves "${hostname}" to "${expectedBrand}"`, () => {
      expect(detectBrandFromHostname(hostname)).toBe(expectedBrand);
    });
  }

  it('returns null for a domain that matches neither brand keyword', () => {
    expect(detectBrandFromHostname('example.com')).toBeNull();
  });

  it("returns null for the plugin's own demo/localhost host", () => {
    expect(detectBrandFromHostname('localhost')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(detectBrandFromHostname('WWW.NORDICNEST.SE')).toBe('nordicnest');
    expect(detectBrandFromHostname('SVENSSON.SE')).toBe('svensson');
  });
});

describe('detectBrand', () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('reads window.location.hostname', () => {
    setHostname('nordicnest.se');
    expect(detectBrand()).toBe('nordicnest');
  });

  it('returns null when the hostname matches no known brand', () => {
    setHostname('example.com');
    expect(detectBrand()).toBeNull();
  });
});

describe('brandThemeCss', () => {
  it('returns an empty string for null (no brand override injected)', () => {
    expect(brandThemeCss(null)).toBe('');
  });

  it('returns a :host block overriding the primary accent to black for nordicnest', () => {
    const css = brandThemeCss('nordicnest');
    expect(css).toContain(':host {');
    expect(css).toContain('--getroomly-primary: #000000;');
    expect(css).toContain('--getroomly-primary-deep: #000000;');
    expect(css).toContain('--getroomly-primary-tint: #F3F3F3;');
  });

  it('returns a :host block overriding the primary accent to black for svensson, with its own tint', () => {
    const css = brandThemeCss('svensson');
    expect(css).toContain('--getroomly-primary: #000000;');
    expect(css).toContain('--getroomly-primary-tint: #F1EFED;');
  });

  it('the two brands differ ONLY in tint/spinner colours, not the shared black accent/text overrides', () => {
    const nordicNest = brandThemeCss('nordicnest');
    const svensson = brandThemeCss('svensson');
    const sharedBlackLines = [
      '--getroomly-primary: #000000;',
      '--getroomly-primary-deep: #000000;',
      '--getroomly-icon-default: #000000;',
      '--getroomly-toggle-inactive: #000000;',
      '--getroomly-tertiary-text: #000000;',
      '--getroomly-disclaimer: #000000;',
      '--getroomly-dialog-heading: #000000;',
      '--getroomly-dialog-body: #000000;',
    ];
    for (const line of sharedBlackLines) {
      expect(nordicNest).toContain(line);
      expect(svensson).toContain(line);
    }
  });

  it('preserves the terms-link hover/non-hover alpha distinction instead of flattening it to solid black', () => {
    // Found in review of the source instruction ("Text: #000000"): flattening
    // this specific pair to identical opaque black would remove the hover
    // feedback signal entirely, not just restyle it -- so the 0.6/0.8 alpha
    // split from the default theme is deliberately kept, only the hue changes.
    const css = brandThemeCss('nordicnest');
    expect(css).toContain('--getroomly-terms-link: rgba(0, 0, 0, 0.6);');
    expect(css).toContain('--getroomly-terms-link-hover: rgba(0, 0, 0, 0.8);');
  });

  it('spinner gradient goes from the brand tint to black, ending in the same primary black as the accent', () => {
    const nordicNest = brandThemeCss('nordicnest');
    expect(nordicNest).toContain('--getroomly-spinner-start: #F3F3F3;');
    expect(nordicNest).toContain('--getroomly-spinner-end: #000000;');

    const svensson = brandThemeCss('svensson');
    expect(svensson).toContain('--getroomly-spinner-start: #F1EFED;');
    expect(svensson).toContain('--getroomly-spinner-end: #000000;');
  });

  it('swaps the upload button drop shadow to a black glow, keeping the alpha/blur/spread', () => {
    // Same rule as the other colour tokens: only the hue changes to black,
    // the blur/spread/alpha stay exactly as the default theme's -- a black
    // glow under a black button, not the default teal one left over.
    expect(brandThemeCss('nordicnest')).toContain(
      '--getroomly-upload-button-shadow: 0 10px 24px -10px rgba(0, 0, 0, 0.6);'
    );
    expect(brandThemeCss('svensson')).toContain(
      '--getroomly-upload-button-shadow: 0 10px 24px -10px rgba(0, 0, 0, 0.6);'
    );
  });

  it('overrides the 0-100% processing progress bar fill to the primary black, not left teal', () => {
    // Found in review: this is a separate variable from the spinner's own
    // gradient stops, since it's a brand accent element (like a button),
    // not part of the spinner blob's decorative gradient -- a version of
    // this PR shipped without it, leaving the progress bar the only
    // still-teal element on an otherwise fully black/tint processing screen.
    expect(brandThemeCss('nordicnest')).toContain('--getroomly-progress-fill: #000000;');
    expect(brandThemeCss('svensson')).toContain('--getroomly-progress-fill: #000000;');
  });

  it('flattens every rectangular/pill corner radius to 0 for both brands ("Radius: 0")', () => {
    const radiusTokens = [
      '--getroomly-radius-pill',
      '--getroomly-radius-card',
      '--getroomly-radius-image',
      '--getroomly-radius-modal',
      '--getroomly-radius-sm',
      '--getroomly-radius-xs',
    ];
    for (const token of radiusTokens) {
      expect(brandThemeCss('nordicnest')).toContain(`${token}: 0;`);
      expect(brandThemeCss('svensson')).toContain(`${token}: 0;`);
    }
  });

  it("inherits the host page's own font instead of hardcoding a specific typeface", () => {
    // "Gärna våra native typsnitt om möjligt" -- no font name/URL was given,
    // so this picks up whatever font is already active on the host page at
    // the point <getroomly-plugin> sits, rather than guessing a name.
    const css = brandThemeCss('nordicnest');
    // Both the general :host rule (body text, buttons) and a matching
    // `h1, h2` rule (index.css's own h1/h2 selector has higher specificity
    // than :host alone and would otherwise keep winning) must be present.
    expect(css).toMatch(/:host\s*\{[^}]*font-family:\s*inherit/);
    expect(css).toMatch(/h1,\s*h2,\s*:host\s*\{\s*font-family:\s*inherit/);
  });

  it('also makes form controls (button, input, select, textarea) inherit the host font', () => {
    // Found in review: browsers' UA stylesheets commonly give form controls
    // their own font-family that doesn't reliably inherit from an ancestor
    // by default (the classic "why does my button ignore my font-family"
    // problem) -- without this, every button's label would stay in the
    // browser's default UI font even though headings/plain text correctly
    // picked up the host's.
    const css = brandThemeCss('nordicnest');
    expect(css).toMatch(/button,\s*input,\s*select,\s*textarea\s*\{\s*font-family:\s*inherit/);
  });
});
