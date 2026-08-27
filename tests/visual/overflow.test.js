/**
 * @jest-environment node
 *
 * Puppeteer drives a real, separate Chrome process over the Node.js CDP
 * client — jest.config.js's global `testEnvironment: 'jsdom'` provides a
 * FAKE window/document that isn't used here at all (Chrome renders the real
 * DOM), but jsdom's environment patching still interferes with Puppeteer's
 * own Node networking/process handling badly enough to hang page operations
 * indefinitely. This override is required, not optional — verified by
 * reproducing the hang with jsdom active and it disappearing under `node`.
 *
 * Cross-language button overflow check
 *
 * Renders the real translated strings (imported directly from
 * src/lib/i18n.ts — never re-typed here, so this can't drift from what the
 * plugin actually ships) inside a faithful reproduction of each button's
 * real inline styles, at realistic container widths, in a real Chromium
 * layout engine (jsdom does not do layout — width/height always read 0 —
 * so this genuinely needs Puppeteer). For each of the 16 languages this
 * measures whether the rendered text clips or wraps beyond the button's
 * box and reports every failure, with a screenshot, instead of requiring
 * someone to click through 16 language variants by hand.
 *
 * The button CSS below is copied from the real components, not imported,
 * because they're inline React style objects, not extractable CSS — each
 * block names its source file:line so a future style change there is easy
 * to find and re-sync here. This is the one accepted drift risk of this
 * approach; the trade-off against it is that driving the REAL component
 * tree to the "result" step requires a live AI generation through the
 * backend (slow, flaky, costs money), which isn't practical for a check
 * that should run routinely.
 *
 * Known limitation: headless Chrome on a minimal Linux CI runner may not
 * have CJK fonts installed, which can make zh/ko/ja measurements here
 * differ from a real user's device (which does have them). Latin/Greek
 * script results (11 of the 14 new languages) are unaffected either way.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { translations } = require('../../src/lib/i18n');

/**
 * Translated strings are interpolated straight into an HTML template
 * (see spec.render() below, then page.setContent()) — any of the 16
 * languages introducing an untranslated brand name or punctuation
 * containing &, <, >, or a quote character would otherwise be parsed as
 * markup instead of measured as the literal text a user would see,
 * silently skewing the overflow measurement or breaking the DOM.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SCREENSHOT_DIR = path.join(__dirname, '__overflow_failures__');

// --- CSS variables actually used by the styles below (src/index.css) ---
const SPACE_SM = '16px';
const SPACE_LG = '32px';
const FONT_BASE = '14px';
const TRANSITION_SLOW = '0.3s ease';
const PRIMARY = 'hsl(176, 51%, 36%)';
const FONT_STACK = "system-ui, 'Segoe UI', Roboto, sans-serif";

/**
 * Each entry reproduces one real button's inline style object.
 * `translationKey` selects which string from translations[lang] fills it.
 * `containerWidths` are the realistic widths this button is actually
 * squeezed into: the two-column result-footer buttons live inside a
 * 520px desktop modal (src/App.tsx:137, maxWidth: '520px') and 16px
 * padding + 8px grid gap each side (src/index.css --getroomly-space-sm,
 * src/components/RoomVisualizationFlow.tsx:1041-1046) -> 240px per column
 * on desktop; a 360px-wide embed context (common on mobile, where the
 * modal is width:'100%' below its maxWidth) gives 160px per column. The
 * embed launch button's width is entirely partner-controlled (width:
 * '100%' of whatever column the host page gives it, per
 * EmbedButton.tsx:22-44) — 280px/200px below are realistic assumptions
 * for a typical e-commerce "Add to Cart" button column, not a value read
 * from source.
 */
const BUTTON_SPECS = [
  {
    name: 'Embed launch button (EmbedButton.tsx:22-67)',
    translationKey: 'launchButton',
    containerWidths: [280, 200],
    // Two-line CSS, matching the real <button><span>{text}</span><span>AI</span></button>
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <button id="target" style="
          width:100%; box-sizing:border-box; display:flex; align-items:center;
          justify-content:center; gap:${SPACE_SM}; padding:${SPACE_LG};
          font-size:${FONT_BASE}; font-weight:bold; letter-spacing:0.1em;
          text-transform:uppercase; transition:all ${TRANSITION_SLOW};
          background-color:#000; color:#fff; border:none; border-radius:0;
          font-family:${FONT_STACK};
        ">
          <span>${text}</span>
          <span style="background:rgba(255,255,255,0.2); padding:4px 8px; border-radius:4px; font-size:10px; font-weight:900; border:1px solid rgba(255,255,255,0.2);">AI</span>
        </button>
      </div>`,
  },
  {
    name: 'Add to Basket (RoomVisualizationFlow.tsx:1049-1071)',
    translationKey: 'addToBasket',
    containerWidths: [240, 160],
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <button id="target" style="
          width:100%; box-sizing:border-box; gap:8px; justify-content:center;
          text-align:center; font-weight:700; height:44px; border-radius:6px;
          display:flex; align-items:center; border:none; font-size:14px;
          padding:10px 16px; background:${PRIMARY}; color:white;
          font-family:${FONT_STACK};
        ">${text}</button>
      </div>`,
  },
  {
    name: 'Show Original (RoomVisualizationFlow.tsx:1075-1096)',
    translationKey: 'showOriginal',
    containerWidths: [240, 160],
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <button id="target" style="
          width:100%; box-sizing:border-box; gap:8px; justify-content:center;
          text-align:center; height:44px; border-radius:6px; display:flex;
          align-items:center; font-size:14px; padding:10px 16px;
          border:1px solid rgba(176,143,106,0.3); color:${PRIMARY};
          background:white; font-weight:700; font-family:${FONT_STACK};
        ">${text}</button>
      </div>`,
  },
  {
    name: 'Save / Share (RoomVisualizationFlow.tsx:1102-1122)',
    translationKey: 'saveShare',
    containerWidths: [240, 160],
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <button id="target" style="
          width:100%; box-sizing:border-box; gap:8px; justify-content:center;
          align-items:center; text-align:center; height:44px; border-radius:6px;
          display:flex; font-size:14px; padding:10px 16px;
          background:rgba(147,163,178,0.3); color:#6b7280; font-weight:700;
          border:1px solid transparent; font-family:${FONT_STACK};
        ">${text}</button>
      </div>`,
  },
  {
    name: 'New Photo (RoomVisualizationFlow.tsx:1165-1186)',
    translationKey: 'newPhoto',
    containerWidths: [240, 160],
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <button id="target" style="
          width:100%; box-sizing:border-box; gap:8px; justify-content:center;
          align-items:center; text-align:center; height:44px; border-radius:6px;
          display:flex; font-size:14px; padding:10px 16px;
          background:rgba(147,163,178,0.3); color:#6b7280; font-weight:700;
          border:1px solid transparent; font-family:${FONT_STACK};
        ">${text}</button>
      </div>`,
  },
  {
    name: 'Download to Device (dropdown item, RoomVisualizationFlow.tsx:1136-1147)',
    translationKey: 'downloadToDevice',
    containerWidths: [180], // DropdownMenu.Content minWidth: '180px' (line 1132)
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <div id="target" style="
          padding:8px 12px; font-size:14px; border-radius:4px;
          font-family:${FONT_STACK};
        ">${text}</div>
      </div>`,
  },
  {
    name: 'Share with Friends (dropdown item, RoomVisualizationFlow.tsx:1148-1159)',
    translationKey: 'shareWithFriends',
    containerWidths: [180],
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <div id="target" style="
          padding:8px 12px; font-size:14px; border-radius:4px;
          font-family:${FONT_STACK};
        ">${text}</div>
      </div>`,
  },
];

const ALL_LANGUAGES = Object.keys(translations);

describe('Cross-language button overflow', () => {
  let browser;
  const failures = [];

  beforeAll(async () => {
    fs.rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    browser = await puppeteer.launch({
      headless: process.env.CI !== 'false',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }, 30000);

  afterAll(async () => {
    // Guarded: if puppeteer.launch() itself failed above (e.g. missing
    // Chromium deps in a minimal CI image), `browser` is undefined —
    // calling close() unconditionally would throw a second, unrelated
    // error here that buries the real launch failure in the report.
    if (browser) await browser.close();
  });

  for (const spec of BUTTON_SPECS) {
    for (const lang of ALL_LANGUAGES) {
      for (const width of spec.containerWidths) {
        const text = translations[lang][spec.translationKey];

        it(`${spec.name} — "${lang}" at ${width}px fits without clipping/wrapping-overflow`, async () => {
          const page = await browser.newPage();
          try {
            await page.setViewport({ width: width + 40, height: 200 });
            await page.setContent(
              `<!DOCTYPE html><html><body style="margin:0; padding:20px;">${spec.render(escapeHtml(text), width)}</body></html>`
            );

            const box = await page.evaluate(() => {
              const el = document.getElementById('target');
              return {
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
                scrollHeight: el.scrollHeight,
                clientHeight: el.clientHeight,
              };
            });

            const overflowsX = box.scrollWidth > box.clientWidth + 1; // +1px rounding tolerance
            const overflowsY = box.scrollHeight > box.clientHeight + 1;

            if (overflowsX || overflowsY) {
              const safeLang = lang.replace(/[^a-z0-9]/gi, '_');
              const safeName = spec.name.split(' (')[0].replace(/[^a-z0-9]/gi, '_');
              const screenshotPath = path.join(
                SCREENSHOT_DIR,
                `${safeName}__${safeLang}__${width}px.png`
              );
              await page.screenshot({ path: screenshotPath });

              failures.push({
                button: spec.name,
                language: lang,
                width,
                text,
                overflowsX,
                overflowsY,
                excessWidth: box.scrollWidth - box.clientWidth,
                excessHeight: box.scrollHeight - box.clientHeight,
                screenshot: screenshotPath,
              });
            }

            expect({ overflowsX, overflowsY }).toEqual({ overflowsX: false, overflowsY: false });
          } finally {
            await page.close();
          }
        }, 15000);
      }
    }
  }

  afterAll(() => {
    if (failures.length === 0) return;
    const report = failures
      .map(
        f =>
          `  [${f.language}] ${f.button} @ ${f.width}px: "${f.text}"\n` +
          `    overflow: ${f.overflowsX ? `+${f.excessWidth}px width ` : ''}${f.overflowsY ? `+${f.excessHeight}px height` : ''}\n` +
          `    screenshot: ${f.screenshot}`
      )
      .join('\n\n');
    // Printed regardless of individual test pass/fail state so a full
    // picture is visible even if only some cases fail.
    console.log(`\n=== OVERFLOW SUMMARY: ${failures.length} case(s) ===\n\n${report}\n`);
  });
});
