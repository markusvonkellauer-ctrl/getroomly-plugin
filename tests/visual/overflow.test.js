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
// --getroomly-primary-deep, not --getroomly-primary: both fixtures below use
// this as text on white or white text on a filled background, which needs
// the AA-safe deep tone (5.64:1 against white) -- the lighter
// --getroomly-primary (4.02:1) is for decorative/non-text use only.
const PRIMARY = '#2f7267';
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
 *
 * The three tertiary-row buttons (download/share/new photo,
 * RoomVisualizationFlow.tsx:1295-1309/1370-1390) aren't width:100% inside
 * their own column — they're auto-width flex items sharing one row with
 * two 6px gaps between them, so 158px/105px below is the same 488px/328px
 * content width divided three ways instead of two: (488-12)/3 ≈ 158,
 * (328-12)/3 ≈ 105.
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
    // No longer a full-width block -- it shares the action row with the
    // 54px favorite circle + 10px gap, so the realistic budget is the
    // 488px/328px content width (see header comment) minus that 64px:
    // 488-64=424, 328-64=264.
    name: 'Add to Basket (action row, next to the favorite button)',
    translationKey: 'addToBasket',
    containerWidths: [424, 264],
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <button id="target" style="
          width:100%; box-sizing:border-box; gap:8px; justify-content:center;
          text-align:center; font-weight:700; height:54px; border-radius:999px;
          display:flex; align-items:center; border:none; font-size:14px;
          padding:10px 16px; background:${PRIMARY}; color:white;
          font-family:${FONT_STACK};
        ">${text}</button>
      </div>`,
  },
  {
    // tertiaryButtonStyle (RoomVisualizationFlow.tsx:1295-1309) applies to
    // all three tertiary-row buttons below. Not width:100% inside its own
    // grid column anymore — it's an auto-width flex item, one of three
    // sharing one row (renderResultFooter, ~line 1370-1390), so the
    // realistic per-item budget is roughly a third of the footer's own
    // width (520px modal maxWidth / 360px mobile embed width, minus 16px
    // padding each side, minus two 6px row gaps, divided by 3 — see the
    // BUTTON_SPECS header comment above for where those 520px/360px
    // figures come from).
    name: 'New Photo (RoomVisualizationFlow.tsx:1385-1387, tertiary row)',
    translationKey: 'newPhoto',
    containerWidths: [158, 105],
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <button id="target" style="
          box-sizing:border-box; gap:8px; justify-content:center;
          align-items:center; text-align:center; min-height:44px; border-radius:999px;
          display:flex; font-size:14px; padding:10px 16px;
          background:none; color:#6b7280; font-weight:500;
          border:none; font-family:${FONT_STACK};
        ">${text}</button>
      </div>`,
  },
  {
    name: 'Download to Device (RoomVisualizationFlow.tsx:1377-1379, tertiary row)',
    translationKey: 'downloadToDevice',
    containerWidths: [158, 105],
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <button id="target" style="
          box-sizing:border-box; gap:8px; justify-content:center;
          align-items:center; text-align:center; min-height:44px; border-radius:999px;
          display:flex; font-size:14px; padding:10px 16px;
          background:none; color:#6b7280; font-weight:500;
          border:none; font-family:${FONT_STACK};
        ">${text}</button>
      </div>`,
  },
  {
    name: 'Share with Friends (RoomVisualizationFlow.tsx:1380-1382, tertiary row)',
    translationKey: 'shareWithFriends',
    containerWidths: [158, 105],
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <button id="target" style="
          box-sizing:border-box; gap:8px; justify-content:center;
          align-items:center; text-align:center; min-height:44px; border-radius:999px;
          display:flex; font-size:14px; padding:10px 16px;
          background:none; color:#6b7280; font-weight:500;
          border:none; font-family:${FONT_STACK};
        ">${text}</button>
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
          // A typo'd translationKey in BUTTON_SPECS above (or an
          // incomplete translations object slipping past tests/unit/
          // i18n.test.js's own completeness check) would make `text`
          // undefined here — without this guard, escapeHtml(undefined)
          // renders the 9-character literal string "undefined", which
          // fits in every button width and passes every case, silently
          // measuring nothing meaningful for that (spec, language) pair.
          expect(typeof text).toBe('string');
          expect(text.length).toBeGreaterThan(0);

          const page = await browser.newPage();
          try {
            await page.setViewport({ width: width + 40, height: 200 });
            await page.setContent(
              `<!DOCTYPE html><html><body style="margin:0; padding:20px;">${spec.render(escapeHtml(text), width)}</body></html>`
            );

            const box = await page.evaluate(() => {
              const el = document.getElementById('target');
              if (!el) {
                // Without this, a missing #target (a future spec.render()
                // forgetting the id, or setContent partially failing)
                // throws "Cannot read properties of null" deep inside a
                // page.evaluate context — a generic error with no hint of
                // which button/language/width caused it.
                throw new Error(
                  '#target not found in rendered content — spec.render() must include id="target"'
                );
              }
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

/**
 * The per-button checks above measure each tertiary button in isolation at
 * an assumed per-item width budget (a third of the row). That doesn't
 * actually match the real layout: tertiaryButtonStyle
 * (RoomVisualizationFlow.tsx:1295-1310) gives each button no explicit
 * width at all — they're auto-width flex items sharing one row
 * (renderResultFooter, ~line 1370-1390) with `flexWrap: 'wrap'`, so a
 * button doesn't get squeezed into a third of the row; the ROW wraps to a
 * second line instead if all three don't fit on one. This renders the
 * real three-button row together, at the same 488px/328px content widths
 * as the per-button checks above (520px modal / 360px mobile embed minus
 * 16px padding each side), and checks the ROW never overflows
 * horizontally — flexWrap should make that structurally impossible short
 * of a single button's own text exceeding the full row width, so this is
 * a regression guard for `flexWrap: 'wrap'` itself as much as a layout
 * check.
 */
describe('Cross-language tertiary row overflow (combined row, not per-button)', () => {
  let browser;

  const ROW_STYLE = `
    display:flex; flex-wrap:wrap; justify-content:center; gap:6px; width:100%;
    box-sizing:border-box;
  `;
  const BUTTON_STYLE = `
    box-sizing:border-box; gap:8px; justify-content:center; align-items:center;
    text-align:center; min-height:44px; border-radius:999px; display:flex;
    font-size:14px; padding:10px 16px; background:none; color:#6b7280;
    font-weight:500; border:none; font-family:${FONT_STACK};
  `;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: process.env.CI !== 'false',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  for (const lang of ALL_LANGUAGES) {
    for (const width of [488, 328]) {
      it(`tertiary row — "${lang}" at ${width}px never overflows horizontally`, async () => {
        const t = translations[lang];
        const texts = [t.downloadToDevice, t.newPhoto, t.shareWithFriends];
        for (const text of texts) {
          expect(typeof text).toBe('string');
          expect(text.length).toBeGreaterThan(0);
        }

        const page = await browser.newPage();
        try {
          await page.setViewport({ width: width + 40, height: 300 });
          const buttons = texts
            .map(
              text => `<button class="target" style="${BUTTON_STYLE}">${escapeHtml(text)}</button>`
            )
            .join('');
          await page.setContent(
            `<!DOCTYPE html><html><body style="margin:0; padding:20px;">
              <div style="width:${width}px; box-sizing:border-box;">
                <div style="${ROW_STYLE}">${buttons}</div>
              </div>
            </body></html>`
          );

          const box = await page.evaluate(() => {
            const row = document.querySelector('.target').parentElement;
            return { scrollWidth: row.scrollWidth, clientWidth: row.clientWidth };
          });

          expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
        } finally {
          await page.close();
        }
      }, 15000);
    }
  }
});

/**
 * The Before/After toggle pill (RoomVisualizationFlow.tsx, the pill inside
 * renderResultStep) has auto-width buttons with no column to squeeze into,
 * so a per-button isolated-width check (like the specs at the top of this
 * file) can't actually fail regardless of how wide the button renders --
 * an earlier version of this fixture did exactly that and was a no-op.
 * The real risk here is that the image well has `overflow:hidden` and the
 * pill has `maxWidth` + `flexWrap:wrap` (not a fixed width) so it can't be
 * pushed past the well's own edge -- wrapping to a second line instead.
 * This renders both toggle buttons together inside a mock image well and
 * checks the pill never crosses the well's right edge, at 488px/328px
 * (matching the widths used above) AND at a genuinely narrow width
 * simulating a portrait-photo well: the well is sized to the uploaded
 * photo's own aspect ratio, not the modal width, so a tall/narrow upload
 * can render a well far narrower than the modal itself -- this is the case
 * the fix specifically targets.
 *
 * (An earlier version of this fixture also simulated the feedback thumbs
 * colliding with this pill, back when they were an overlay on the same
 * image well. They've since moved into the control stack below the image,
 * so that collision can no longer happen and the mock feedback group was
 * removed.)
 */
describe("Before/After toggle pill overflow (image well's overflow:hidden clipping)", () => {
  let browser;

  const PILL_STYLE = `
    position:absolute; left:14px; bottom:14px; display:flex; flex-wrap:wrap;
    max-width:calc(100% - 28px); gap:4px; padding:4px;
    border-radius:999px; background:rgba(255,255,255,.94); box-sizing:border-box;
  `;
  const BUTTON_STYLE = `
    box-sizing:border-box; border:0; border-radius:999px; padding:9px 16px;
    font-size:12px; font-weight:600; font-family:${FONT_STACK};
    background:${PRIMARY}; color:white;
  `;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: process.env.CI !== 'false',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  for (const lang of ALL_LANGUAGES) {
    // 140px simulates a narrow/portrait-photo well -- far narrower than
    // the 488px/328px figures elsewhere in this file, which assume a well
    // roughly as wide as the modal itself. This well's width is driven by
    // the uploaded photo's own aspect ratio, not the modal, so it can be
    // much narrower in practice.
    for (const width of [488, 328, 140]) {
      it(`toggle pill — "${lang}" at ${width}px image well width is not clipped by overflow:hidden`, async () => {
        const t = translations[lang];
        const texts = [t.toggleBefore, t.toggleAfter];
        for (const text of texts) {
          expect(typeof text).toBe('string');
          expect(text.length).toBeGreaterThan(0);
        }

        const page = await browser.newPage();
        try {
          await page.setViewport({ width: width + 40, height: 250 });
          const buttons = texts
            .map(
              text =>
                `<button class="pill-btn" style="${BUTTON_STYLE}">${escapeHtml(text)}</button>`
            )
            .join('');
          await page.setContent(
            `<!DOCTYPE html><html><body style="margin:0; padding:20px;">
              <div id="well" style="
                position:relative; width:${width}px; height:150px;
                overflow:hidden; box-sizing:border-box; background:#221a17;
              ">
                <div class="pill" style="${PILL_STYLE}">${buttons}</div>
              </div>
            </body></html>`
          );

          const box = await page.evaluate(() => {
            const well = document.getElementById('well');
            const pill = document.querySelector('.pill');
            return {
              wellRight: well.getBoundingClientRect().right,
              pillRight: pill.getBoundingClientRect().right,
            };
          });

          // The well has overflow:hidden in the real component -- anything
          // past its right edge is silently clipped, not wrapped or shrunk.
          expect(box.pillRight).toBeLessThanOrEqual(box.wellRight + 1);
        } finally {
          await page.close();
        }
      }, 15000);
    }
  }
});

/**
 * The modal (.getroomly-modal-container, index.css) caps at 80dvh with
 * overflow:hidden -- header (auto height) + image (was a flat 55dvh) +
 * footer (auto height, and now several rows taller than before this
 * design-update round: feedback row, action row, disclaimer, status line,
 * tertiary row) all have to fit inside that, or the modal's own
 * overflow:hidden silently clips whatever doesn't fit. Since header/footer
 * height is driven by fixed padding and font sizes (roughly constant
 * pixels), not viewport-relative units, a plain `55dvh` image cap doesn't
 * know how much room the rest of the stack actually needs and can claim
 * more than what's left over -- verified this was already true before this
 * PR's footer changes (pre-existing, ~43px overflow at a 375x667 viewport
 * with the old shorter footer), and got worse with the new rows (~177px).
 * The fix subtracts a fixed pixel allowance from the dvh figure instead of
 * a flat percentage (see the comment on the image's maxHeight style).
 *
 * This renders the REAL header + REAL footer markup (all optional rows
 * present, using each language's actual translations) plus a mock image
 * sized with the same formula as production, inside a mock modal with the
 * real 80dvh cap + overflow:hidden, and checks the image's own bottom edge
 * never gets pushed past the modal's bottom edge -- i.e. that it's never
 * actually clipped, regardless of how tall a particular language's control
 * stack renders.
 */
describe('Result-step modal height: image is never clipped by the footer', () => {
  let browser;

  const FEEDBACK_ICON_BUTTON_STYLE = `
    height:38px; width:38px; border-radius:50%; border:none; flex-shrink:0;
  `;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: process.env.CI !== 'false',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  for (const lang of ALL_LANGUAGES) {
    // 667/640 = iPhone SE/8-class; 600/568 = older/smaller phones still seen
    // in real traffic -- 600 and 568 are the exact viewport heights that
    // reproduced a REAL bug in an earlier version of this fix: a static CSS
    // `max(calc(55dvh - 200px), 150px)` formula on the image's own
    // max-height left the image up to ~39px taller than #content-wrapper's
    // actual flex-shrunk box, and the wrapper's own overflow:hidden clipped
    // the excess even though the outer modal itself wasn't overflowing --
    // see the assertion against wrapperBottom below, not just modalBottom.
    for (const viewportHeight of [667, 640, 600, 568]) {
      it(`"${lang}" at 375x${viewportHeight}: image is not clipped by the modal or the content wrapper`, async () => {
        const t = translations[lang];
        const width = 375;

        const page = await browser.newPage();
        try {
          await page.setViewport({ width, height: viewportHeight });

          const headerHtml = `
            <div style="display:flex; flex-direction:row; align-items:center; padding:4px 16px; flex-shrink:0; gap:4px; font-family:${FONT_STACK};">
              <div style="width:28px; flex-shrink:0;"></div>
              <h2 style="flex:1; text-align:center; font-size:18px; font-weight:bold; letter-spacing:-0.025em; margin:0;">${escapeHtml(t.stepResult)}</h2>
              <button style="flex-shrink:0; width:28px; height:28px; border-radius:50%; border:none;"></button>
            </div>
          `;

          const tertiaryButtonStyle = `
            gap:8px; justify-content:center; align-items:center; text-align:center;
            min-height:44px; border-radius:999px; display:flex; font-size:14px;
            padding:10px 16px; background:none; color:#6b7280; font-weight:500;
            border:none; font-family:${FONT_STACK};
          `;

          const footerHtml = `
            <div style="padding:8px 16px 16px; background-color:#ffffff; flex-shrink:0;">
              <div style="display:flex; flex-direction:column; gap:8px; width:100%; margin:0 auto; font-family:${FONT_STACK};">
                <div style="display:flex; align-items:center; gap:8px; min-height:38px;">
                  <span style="flex:1; font-size:12px; line-height:1.35; color:#605d5d;">${escapeHtml(t.feedbackQuestion)}</span>
                  <button style="${FEEDBACK_ICON_BUTTON_STYLE}"></button>
                  <button style="${FEEDBACK_ICON_BUTTON_STYLE}"></button>
                </div>
                <div style="display:flex; gap:10px;">
                  <button style="flex-shrink:0; width:54px; height:54px; border-radius:999px; border:1.5px solid #7d7979;"></button>
                  <button style="flex:1; gap:8px; justify-content:center; text-align:center; font-weight:700; height:54px; border-radius:999px; display:flex; align-items:center; border:none; font-size:14px; padding:10px 16px; background:${PRIMARY}; color:white;">${escapeHtml(t.addToBasket)}</button>
                </div>
                <p style="margin:0; text-align:center; font-size:12px; line-height:1.45; color:#444141;">${escapeHtml(t.disclaimer)}</p>
                <p style="margin:0; text-align:center; font-size:12px; font-weight:600; color:${PRIMARY};">${escapeHtml(t.downloadedStatus)}</p>
                <div style="display:flex; flex-wrap:wrap; justify-content:center; gap:6px;">
                  <button style="${tertiaryButtonStyle}">${escapeHtml(t.downloadToDevice)}</button>
                  <button style="${tertiaryButtonStyle}">${escapeHtml(t.shareWithFriends)}</button>
                  <button style="${tertiaryButtonStyle}">${escapeHtml(t.newPhoto)}</button>
                </div>
              </div>
            </div>
          `;

          // Mirrors the real component: the image starts at an arbitrary
          // (deliberately oversized) height, then a ResizeObserver on
          // #content-wrapper -- the actual clipping boundary, since it has
          // overflow:hidden + min-height:0 and can flex-shrink independently
          // of the image's own size -- sets the image's real height from
          // the wrapper's measured contentRect, exactly like
          // resultContentRef's effect in RoomVisualizationFlow.tsx.
          //
          // Mirrors the real component's img style field-for-field: same
          // 150px initial fallback (availableImageHeightPx ?? 150), same
          // width:'auto'/height:'auto' (NOT forced to the measured value --
          // forcing height would let this test pass even if the real
          // maxHeight calculation were wrong, since equality would be
          // tautological rather than a consequence of the CSS cascade).
          // The used height instead comes from letting the browser's own
          // replaced-element sizing algorithm apply max-height against a
          // real (non-1:1) intrinsic aspect ratio, exactly as it does for
          // an actual photo -- a 4:3 SVG placeholder stands in for that,
          // since a 1x1 GIF's trivial intrinsic ratio can't exercise the
          // clamp at all.
          await page.setContent(
            `<!DOCTYPE html><html><body style="margin:0;">
              <div id="modal" style="max-height:80dvh; overflow:hidden; display:flex; flex-direction:column; width:${width}px; box-sizing:border-box;">
                ${headerHtml}
                <div id="content-wrapper" style="flex:1 1 auto; min-height:0; overflow:hidden; display:flex; align-items:flex-start; justify-content:center;">
                  <img id="result-image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3C/svg%3E" style="display:block; max-width:100%; max-height:150px; width:auto; height:auto;" />
                </div>
                ${footerHtml}
              </div>
              <script>
                const wrapper = document.getElementById('content-wrapper');
                const img = document.getElementById('result-image');
                const ro = new ResizeObserver(entries => {
                  const h = entries[0].contentRect.height;
                  img.style.maxHeight = h + 'px';
                  window.__lastMeasuredHeight = h;
                });
                ro.observe(wrapper);
              </script>
            </body></html>`
          );

          await page.waitForFunction(() => window.__lastMeasuredHeight !== undefined);

          const result = await page.evaluate(() => {
            const modal = document.getElementById('modal');
            const wrapper = document.getElementById('content-wrapper');
            const img = document.getElementById('result-image');
            return {
              modalBottom: modal.getBoundingClientRect().bottom,
              wrapperBottom: wrapper.getBoundingClientRect().bottom,
              imageBottom: img.getBoundingClientRect().bottom,
            };
          });

          // The wrapper is the real clipping boundary (see comment above) --
          // checked first since that's the one the earlier static-formula
          // fix missed. The modal check stays as a second, independent
          // guard against the outer overflow:hidden.
          expect(result.imageBottom).toBeLessThanOrEqual(result.wrapperBottom + 1);
          expect(result.imageBottom).toBeLessThanOrEqual(result.modalBottom + 1);
        } finally {
          await page.close();
        }
      }, 15000);
    }
  }
});
