/**
 * @jest-environment node
 *
 * Puppeteer drives a real, separate Chrome process -- see
 * tests/visual/overflow.test.js's own header comment for why jsdom must be
 * overridden here (the global jest.config.js testEnvironment is jsdom,
 * which hangs Puppeteer's own Node networking).
 *
 * Cross-language overflow check for the upload view (D3 update on top of
 * the D2 redesign -- RoomVisualizationFlow.tsx's renderUploadStep).
 *
 * Renders the real translated strings (imported from src/lib/i18n.ts, never
 * re-typed here) inside a faithful reproduction of each element's real
 * inline styles, at the three realistic content widths this view's own CSS
 * (src/index.css's .getroomly-upload-v2 custom properties) actually
 * produces -- a real Chromium layout engine, since jsdom does no layout at
 * all (width/height always read 0). No network calls to any backend: pure
 * static HTML fixtures, same approach as overflow.test.js.
 *
 * Content widths (panel width minus the view's own horizontal padding):
 *  - 328px: compact mode (max-height:550px -- D3's narrower threshold, see
 *    index.css), smallest realistic phone (360px panel - 2*16px compact
 *    padding).
 *  - 350px: regular/mobile, no compact (390px panel - 2*20px padding).
 *  - 440px: desktop (found in review, Copilot PR #139: the modal's real
 *    cap is 520px -- App.tsx's maxWidth, matching the .lg\:w-\[520px\]
 *    class -- not the 560px the reference mockup shows; 520-80 padding =
 *    440px, not 480px).
 *
 * What this checks: individual elements never force horizontal overflow
 * (an unbreakable long word/compound wider than its container -- German and
 * Finnish compound nouns are the realistic risk) and the upload button
 * specifically never wraps to a second line or clips (it's a fixed-height,
 * single-line flex row by design, unlike the step text and trust-line lines,
 * which are allowed to wrap across multiple lines).
 *
 * The product name row (thumbnail + name) is deliberately NOT covered here
 * -- it already clamps to 2 lines with an ellipsis
 * (-webkit-line-clamp, RoomVisualizationFlow.tsx) by design, so a long name
 * overflowing is the intended, handled case, not a bug to catch.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { translations } = require('../../src/lib/i18n');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SCREENSHOT_DIR = path.join(__dirname, '__upload_view_overflow_failures__');
const FONT_STACK = "system-ui, 'Segoe UI', Roboto, sans-serif";
// Panel width minus this view's own horizontal padding, per content size
// (src/index.css's .getroomly-upload-v2 tokens): compact 360-2*16=328,
// regular 390-2*20=350, desktop 520-2*40=440 (found in review, Copilot PR
// #139: the modal's real cap is 520px -- App.tsx's maxWidth -- not the
// 560px the reference mockup shows).
const CONTENT_WIDTHS = [328, 350, 440];
const ALL_LANGUAGES = Object.keys(translations);

/**
 * Each entry reproduces one real element's inline style (RoomVisualizationFlow.tsx,
 * line cited per entry). `wrap: true` elements are allowed to wrap to
 * multiple lines (the check is "no unbreakable word exceeds the container"
 * via scrollWidth, not "fits on one line"); `wrap: false` (just the button)
 * must stay on exactly one line at a fixed height.
 */
const ELEMENT_SPECS = [
  {
    name: 'Step 2 title, default-category phrasing (RoomVisualizationFlow.tsx -- found in review, Copilot PR #140: category-split again, same as step 3)',
    getText: t => t.uploadV2Step2TitleDefault,
    wrap: true,
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <div id="target" style="font-size:15px; font-weight:600; font-family:${FONT_STACK};">${text}</div>
      </div>`,
  },
  {
    name: 'Step 2 title, carpets phrasing (RoomVisualizationFlow.tsx)',
    getText: t => t.uploadV2Step2TitleCarpets,
    wrap: true,
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <div id="target" style="font-size:15px; font-weight:600; font-family:${FONT_STACK};">${text}</div>
      </div>`,
  },
  {
    name: 'Step body text (RoomVisualizationFlow.tsx, step 1 body -- longest of the step descriptions)',
    getText: t => t.uploadV2Step1Body,
    wrap: true,
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <div id="target" style="font-size:14px; line-height:1.45; font-family:${FONT_STACK};">${text}</div>
      </div>`,
  },
  {
    name: 'Upload button (RoomVisualizationFlow.tsx) -- must stay single-line, fixed 60px height (desktop, the tallest/largest-font variant)',
    getText: t => t.uploadButton,
    wrap: false,
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <button id="target" style="
          height:60px; width:100%; box-sizing:border-box; border:none; border-radius:999px;
          background:#2f7267; color:#fff; font-size:17px; font-weight:600; display:flex;
          align-items:center; justify-content:center; gap:10px; font-family:${FONT_STACK};
        ">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M12 15V4m0 0L8 8m4-4l4 4M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4"/></svg>
          <span id="target-text">${text}</span>
        </button>
      </div>`,
  },
  {
    name: 'Size-limit hint (RoomVisualizationFlow.tsx)',
    getText: t => t.uploadV2Hint,
    wrap: true,
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <div id="target" style="font-size:11px; font-weight:400; text-align:center; font-family:${FONT_STACK};">${text}</div>
      </div>`,
  },
  {
    name: 'Trust line, line 1, default-category phrasing (RoomVisualizationFlow.tsx -- found in review, Copilot PR #140: category-split again, same as step 3)',
    getText: t => t.uploadV2TrustLineStatementDefault,
    wrap: true,
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <div id="target" style="font-size:12px; line-height:1.5; text-align:center; font-family:${FONT_STACK};">${text}</div>
      </div>`,
  },
  {
    name: 'Trust line, line 1, carpets phrasing (RoomVisualizationFlow.tsx)',
    getText: t => t.uploadV2TrustLineStatementCarpets,
    wrap: true,
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <div id="target" style="font-size:12px; line-height:1.5; text-align:center; font-family:${FONT_STACK};">${text}</div>
      </div>`,
  },
  {
    name: 'Trust line, line 2 (RoomVisualizationFlow.tsx -- link prefix + termsLink, its own block since D3)',
    getText: t => t.uploadV2TrustLineLinkPrefix + ' ' + t.termsLink,
    wrap: true,
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <div id="target" style="font-size:12px; line-height:1.5; text-align:center; font-family:${FONT_STACK};">${text}</div>
      </div>`,
  },
];

describe('D3 upload view: cross-language overflow', () => {
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
    if (browser) await browser.close();
  });

  for (const spec of ELEMENT_SPECS) {
    for (const lang of ALL_LANGUAGES) {
      for (const width of CONTENT_WIDTHS) {
        const text = spec.getText(translations[lang]);

        it(`${spec.name} -- "${lang}" at ${width}px: no unbreakable-word overflow${spec.wrap ? '' : ', stays single-line'}`, async () => {
          expect(typeof text).toBe('string');
          expect(text.length).toBeGreaterThan(0);

          const page = await browser.newPage();
          try {
            await page.setViewport({ width: width + 40, height: 300 });
            await page.setContent(
              `<!DOCTYPE html><html><body style="margin:0; padding:20px; background:#FAFAFA;">${spec.render(escapeHtml(text), width)}</body></html>`
            );

            const box = await page.evaluate(() => {
              const el = document.getElementById('target');
              if (!el) {
                throw new Error('#target not found -- spec.render() must include id="target"');
              }
              // Found in review (Copilot, PR #139): scrollHeight ===
              // clientHeight alone doesn't prove single-line -- a two-line
              // label can still fit inside the button's fixed 60px height
              // without triggering any height overflow at all. Counting the
              // text's own rendered line boxes via Range.getClientRects()
              // is what actually distinguishes "wrapped to 2 lines, by
              // coincidence still ≤60px tall" from the real single-line
              // case -- 1 rect per line, always, regardless of the
              // container's own height.
              const textEl = document.getElementById('target-text');
              let lineCount = null;
              if (textEl) {
                const range = document.createRange();
                range.selectNodeContents(textEl);
                lineCount = range.getClientRects().length;
              }
              return {
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
                scrollHeight: el.scrollHeight,
                clientHeight: el.clientHeight,
                lineCount,
              };
            });

            const overflowsX = box.scrollWidth > box.clientWidth + 1;
            // Only the no-wrap button cares about height/line-wrapping --
            // wrapped text elements are SUPPOSED to grow taller with more
            // lines.
            const overflowsY =
              !spec.wrap && (box.scrollHeight > box.clientHeight + 1 || box.lineCount > 1);

            if (overflowsX || overflowsY) {
              const safeLang = lang.replace(/[^a-z0-9]/gi, '_');
              const safeName = spec.name.split(' (')[0].replace(/[^a-z0-9]/gi, '_');
              const screenshotPath = path.join(
                SCREENSHOT_DIR,
                `${safeName}__${safeLang}__${width}px.png`
              );
              await page.screenshot({ path: screenshotPath });
              failures.push({
                element: spec.name,
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
          `  [${f.language}] ${f.element} @ ${f.width}px: "${f.text}"\n` +
          `    overflow: ${f.overflowsX ? `+${f.excessWidth}px width ` : ''}${f.overflowsY ? `+${f.excessHeight}px height` : ''}\n` +
          `    screenshot: ${f.screenshot}`
      )
      .join('\n\n');
    console.log(
      `\n=== D2 UPLOAD VIEW OVERFLOW SUMMARY: ${failures.length} case(s) ===\n\n${report}\n`
    );
  });
});
