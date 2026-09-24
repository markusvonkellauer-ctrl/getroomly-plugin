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
    // tertiaryButtonStyle (RoomVisualizationFlow.tsx:2153-2184) applies to
    // all three tertiary-row buttons below: flex:1 1 0 + minWidth:0, one of
    // three equal-share items sharing one row (renderResultFooter,
    // ~line 2320-2338) with a 4px gap between them (not the button's own
    // width:100% or an auto-width flex item anymore), so the realistic
    // per-item budget is roughly a third of the footer's own width (520px
    // modal maxWidth / 360px mobile embed width, minus 16px padding each
    // side, minus two 4px row gaps, divided by 3 — see the BUTTON_SPECS
    // header comment above for where those 520px/360px figures come from).
    name: 'New Photo (RoomVisualizationFlow.tsx:2335-2337, tertiary row)',
    translationKey: 'newPhoto',
    containerWidths: [160, 106],
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <button id="target" style="
          box-sizing:border-box; gap:8px; justify-content:center;
          align-items:center; text-align:center; min-height:44px; border-radius:999px;
          display:flex; font-size:14px; padding:10px 16px;
          background:none; color:#6b7280; font-weight:500;
          border:none; flex:1 1 0; min-width:0; font-family:${FONT_STACK};
        ">${text}</button>
      </div>`,
  },
  {
    // Also covers downloadedLabel (the "Nedladdad ✓" confirmation the same
    // button swaps to after a click) -- see the confirmed-label case below.
    name: 'Download to Device (RoomVisualizationFlow.tsx:2323-2325, tertiary row)',
    translationKey: 'downloadToDevice',
    containerWidths: [160, 106],
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <button id="target" style="
          box-sizing:border-box; gap:8px; justify-content:center;
          align-items:center; text-align:center; min-height:44px; border-radius:999px;
          display:flex; font-size:14px; padding:10px 16px;
          background:none; color:#6b7280; font-weight:500;
          border:none; flex:1 1 0; min-width:0; font-family:${FONT_STACK};
        ">${text}</button>
      </div>`,
  },
  {
    name: 'Share with Friends (RoomVisualizationFlow.tsx:2326-2332, tertiary row)',
    translationKey: 'shareWithFriends',
    containerWidths: [160, 106],
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <button id="target" style="
          box-sizing:border-box; gap:8px; justify-content:center;
          align-items:center; text-align:center; min-height:44px; border-radius:999px;
          display:flex; font-size:14px; padding:10px 16px;
          background:none; color:#6b7280; font-weight:500;
          border:none; flex:1 1 0; min-width:0; font-family:${FONT_STACK};
        ">${text}</button>
      </div>`,
  },
  {
    // The share button's clipboard-fallback confirmation (see
    // handleShareWithFriends's 3-tier chain) -- same pill, same width
    // budget as shareWithFriends above, different translation key.
    name: 'Share with Friends: "Copied" confirmation (tertiary row)',
    translationKey: 'copiedLabel',
    containerWidths: [160, 106],
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <button id="target" style="
          box-sizing:border-box; gap:8px; justify-content:center;
          align-items:center; text-align:center; min-height:44px; border-radius:999px;
          display:flex; font-size:14px; padding:10px 16px;
          background:none; color:#6b7280; font-weight:500;
          border:none; flex:1 1 0; min-width:0; font-family:${FONT_STACK};
        ">${text}</button>
      </div>`,
  },
  {
    // The download button's own "Downloaded ✓" confirmation, and also what
    // the share button's tier-3 (download) fallback shows on itself.
    name: 'Downloaded confirmation (tertiary row, download or share button)',
    translationKey: 'downloadedLabel',
    containerWidths: [160, 106],
    render: (text, width) => `
      <div style="width:${width}px; box-sizing:border-box;">
        <button id="target" style="
          box-sizing:border-box; gap:8px; justify-content:center;
          align-items:center; text-align:center; min-height:44px; border-radius:999px;
          display:flex; font-size:14px; padding:10px 16px;
          background:none; color:#6b7280; font-weight:500;
          border:none; flex:1 1 0; min-width:0; font-family:${FONT_STACK};
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
 * (RoomVisualizationFlow.tsx:2153-2184) gives each button `flex:1 1 0;
 * minWidth:0` — an equal share of the row (renderResultFooter,
 * ~line 2320-2338), not an auto-width item that can grow past its share or
 * wrap the row to a second line. This renders the real three-button row
 * together, at the same 488px/328px content widths as the per-button
 * checks above (520px modal / 360px mobile embed minus 16px padding each
 * side), and checks two things flex:1 1 0 is specifically meant to
 * guarantee: the ROW itself never overflows its container (buttons shrink
 * to fit, they never force the row wider), and all three buttons stay
 * equal width regardless of which one has the longest text for that
 * language — the exact "wrong per-button min-width" bug this design
 * replaced (see the tertiaryButtonStyle comment: min-width alone was a
 * floor, not a ceiling, so a longer label grew its own button and pushed
 * its siblings sideways).
 */
describe('Cross-language tertiary row overflow (combined row, not per-button)', () => {
  let browser;

  const ROW_STYLE = `
    display:flex; justify-content:center; gap:4px; width:100%;
    box-sizing:border-box;
  `;
  const BUTTON_STYLE = `
    box-sizing:border-box; gap:8px; justify-content:center; align-items:center;
    text-align:center; min-height:44px; border-radius:999px; display:flex;
    font-size:14px; padding:10px 16px; background:none; color:#6b7280;
    font-weight:500; border:none; flex:1 1 0; min-width:0; font-family:${FONT_STACK};
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
      it(`tertiary row — "${lang}" at ${width}px never overflows horizontally, and all three buttons stay equal width`, async () => {
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
            const widths = Array.from(row.querySelectorAll('.target')).map(
              el => el.getBoundingClientRect().width
            );
            return { scrollWidth: row.scrollWidth, clientWidth: row.clientWidth, widths };
          });

          expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
          // flex:1 1 0 gives all three an equal share regardless of text
          // length — within 1.5px of the widest, to allow for browser
          // subpixel/rounding distribution across three flex items.
          const maxWidth = Math.max(...box.widths);
          const minWidth = Math.min(...box.widths);
          expect(maxWidth - minWidth).toBeLessThanOrEqual(1.5);
        } finally {
          await page.close();
        }
      }, 15000);
    }
  }
});

/**
 * Replaces a shared top row (toggle + thumbs in one flex-wrap band) with
 * two INDEPENDENTLY corner-anchored controls -- toggle top-left, thumbs
 * (or the confirmation pill that replaces them) bottom-right -- decided
 * directly with the user after measuring that the shared row could make
 * the thumb group entirely invisible on narrow portrait photos (see the
 * PR conversation). Each control now gets the well's FULL width to
 * itself instead of splitting it, and each has its own independent
 * height budget measured from its own corner, so "do they overlap" is no
 * longer a per-width flex-wrap question (there's no shared row to wrap
 * within) -- it's a per-HEIGHT question instead: can the top-anchored
 * toggle and the bottom-anchored thumbs both fit without their wrapped
 * content meeting in the middle of a short well. #well below therefore
 * has a REAL fixed height (150px, this component's own fallback image
 * height) and overflow:hidden, unlike the old width-only fixture --
 * height is no longer a separate, unbounded concern the way it was under
 * the old footer-distance-tracked band (see measureOverlayAnchor's
 * comment in RoomVisualizationFlow.tsx for why the overlay's height now
 * always equals the image's own height directly).
 */
describe('Photo overlay: toggle (top-left) and thumbs (bottom-right) each fit within their own corner', () => {
  let browser;

  const TOGGLE_GROUP_STYLE = `
    position:absolute; top:14px; left:14px; display:flex; flex-shrink:0;
    flex-wrap:wrap; max-width:calc(100% - 28px); box-sizing:border-box;
    gap:4px; padding:4px; border-radius:999px;
    background:rgba(255,255,255,.94);
  `;
  const PILL_BUTTON_STYLE = `
    box-sizing:border-box; border:0; border-radius:999px; padding:9px 16px;
    font-size:12px; font-weight:600; font-family:${FONT_STACK};
    background:${PRIMARY}; color:white; overflow-wrap:break-word;
    min-width:0; max-width:100%;
  `;
  const THUMB_GROUP_STYLE = `
    position:absolute; bottom:14px; right:14px; display:flex; flex-shrink:0;
    flex-wrap:wrap; max-width:calc(100% - 28px); box-sizing:border-box;
    gap:8px; justify-content:flex-end;
  `;
  const THUMB_HIT_TARGET_STYLE = `
    width:44px; height:44px; display:flex; align-items:center;
    justify-content:center; border:0; background:transparent; padding:0;
  `;
  const THUMB_CIRCLE_STYLE = `
    width:40px; height:40px; border-radius:50%; display:flex;
    align-items:center; justify-content:center;
    background:rgba(255,255,255,.94); box-sizing:border-box;
  `;
  const WELL_HEIGHT = 150;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: process.env.CI !== 'false',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  // #bottom-control mirrors production's stable wrapper (see
  // renderPhotoOverlay/bottomControlRef in RoomVisualizationFlow.tsx): one
  // consistently-mounted element positioning whichever child (thumb group
  // here) occupies the bottom-right corner, so its real rendered height
  // can be measured and used to cap the toggle group -- see the script
  // below.
  const buildOverlayHtml = (before, after) => `
    <div class="toggle-group" style="${TOGGLE_GROUP_STYLE}">
      <button style="${PILL_BUTTON_STYLE}">${escapeHtml(before)}</button>
      <button style="${PILL_BUTTON_STYLE}">${escapeHtml(after)}</button>
    </div>
    <div id="bottom-control" style="position:absolute; bottom:14px; right:14px; max-width:calc(100% - 28px); box-sizing:border-box;">
      <div class="thumb-group" style="display:flex; flex-shrink:0; flex-wrap:wrap; gap:8px; justify-content:flex-end;">
        <button style="${THUMB_HIT_TARGET_STYLE}"><span style="${THUMB_CIRCLE_STYLE}"></span></button>
        <button style="${THUMB_HIT_TARGET_STYLE}"><span style="${THUMB_CIRCLE_STYLE}"></span></button>
      </div>
    </div>
  `;

  const measure = async (page, width, before, after) => {
    await page.setViewport({ width: width + 40, height: 500 });
    // #well has overflow:hidden + a REAL fixed height now (matching
    // overlayAnchor.height === imageRect.height in production) -- the
    // toggle/thumb groups themselves are NOT individually clipped (same
    // as production: only the outer overlay clips), so their own
    // getBoundingClientRect reflects their true natural size even when
    // it exceeds the well, letting clipping be measured directly instead
    // of just asserted away by the well's own overflow:hidden.
    await page.setContent(
      `<!DOCTYPE html><html><body style="margin:0; padding:20px;">
        <div id="well" style="
          position:relative; width:${width}px; height:${WELL_HEIGHT}px;
          overflow:hidden; box-sizing:border-box; background:#221a17;
        ">
          ${buildOverlayHtml(before, after)}
        </div>
        <script>
          // Mirrors the toggle group's own maxHeight formula in
          // RoomVisualizationFlow.tsx exactly: overlayAnchor.height (the
          // well here) minus both 14px insets, the bottom control's real
          // measured height, and an 8px buffer.
          const well = document.getElementById('well');
          const toggle = document.querySelector('.toggle-group');
          const bottomControl = document.getElementById('bottom-control');
          const wellRect = well.getBoundingClientRect();
          const bottomControlRect = bottomControl.getBoundingClientRect();
          const bottomControlHeight = bottomControlRect.bottom - bottomControlRect.top;
          const overlayHeight = wellRect.bottom - wellRect.top;
          const maxHeight = Math.max(0, overlayHeight - 14 - bottomControlHeight - 14 - 8);
          toggle.style.maxHeight = maxHeight + 'px';
          toggle.style.overflow = 'hidden';
        </script>
      </body></html>`
    );
    return page.evaluate(() => {
      const toPlain = r => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
      const well = document.getElementById('well');
      const toggle = document.querySelector('.toggle-group');
      const thumbs = document.querySelector('.thumb-group');
      return {
        wellRect: toPlain(well.getBoundingClientRect()),
        toggleRect: toPlain(toggle.getBoundingClientRect()),
        thumbsRect: toPlain(thumbs.getBoundingClientRect()),
      };
    });
  };

  for (const lang of ALL_LANGUAGES) {
    // 140px simulates a narrow/portrait-photo well -- far narrower than
    // the 488px/328px figures elsewhere in this file, which assume a well
    // roughly as wide as the modal itself. 84px is narrower still --
    // below the thumb group's own 96px one-line footprint (2x44px +
    // 8px gap), the exact threshold where its own internal flex-wrap
    // is what keeps it from overflowing the well's right edge even when
    // alone on its own line.
    for (const width of [488, 328, 140, 84]) {
      it(`"${lang}" at ${width}x${WELL_HEIGHT}px: neither control overflows the well's left/right edges`, async () => {
        const t = translations[lang];
        const page = await browser.newPage();
        try {
          const { wellRect, toggleRect, thumbsRect } = await measure(
            page,
            width,
            t.toggleBefore,
            t.toggleAfter
          );

          // Horizontal bounds are a hard guarantee at every width in the
          // matrix -- each control's own maxWidth:calc(100% - 28px) plus
          // internal flex-wrap keeps it from ever needing more width than
          // the well provides, regardless of how narrow that is.
          expect(toggleRect.right).toBeLessThanOrEqual(wellRect.right + 1);
          expect(toggleRect.left).toBeGreaterThanOrEqual(wellRect.left - 1);
          expect(thumbsRect.right).toBeLessThanOrEqual(wellRect.right + 1);
          expect(thumbsRect.left).toBeGreaterThanOrEqual(wellRect.left - 1);
        } finally {
          await page.close();
        }
      }, 15000);
    }
  }

  // The real question at a fixed, realistic image height (150px, this
  // component's own fallback): does the top-anchored toggle's wrapped
  // content ever grow down far enough to visually collide with the
  // bottom-anchored thumb group's wrapped content growing up? German
  // (Vorher/Nachher) is the worst-case toggle text used throughout this
  // file.
  const t = translations.de;
  for (const width of [488, 328, 140]) {
    it(`"de" at ${width}x${WELL_HEIGHT}px: the toggle and thumb group don't visually collide`, async () => {
      const page = await browser.newPage();
      try {
        const { toggleRect, thumbsRect } = await measure(
          page,
          width,
          t.toggleBefore,
          t.toggleAfter
        );
        expect(toggleRect.bottom).toBeLessThanOrEqual(thumbsRect.top + 1);
      } finally {
        await page.close();
      }
    }, 15000);
  }

  // 84px is the extreme, previously-broken case (see ANDRING-5b-
  // bildkontroller's own citation of a 9:16 crop at this component's
  // 150px fallback height working out to ~84px wide).
  //
  // Two DIFFERENT failure modes were found here across two rounds of
  // actually screenshotting this case, not trusting numeric bounds alone:
  // (1) with the original shared band, the thumb group was measured
  // ENTIRELY clipped (its own top already past the shared band's clipped
  // bottom); (2) after splitting into independent corners, the thumb
  // group became fully visible, but the toggle's own worst-case wrapped
  // text (~146px tall) was tall enough to visually OVERLAP it instead
  // (~120px measured) -- two independently, correctly positioned controls
  // that still visually collided because one grew too large toward the
  // other.
  //
  // Fixed by measuring the bottom control's real rendered height
  // (bottomControlHeight in RoomVisualizationFlow.tsx) and capping the
  // toggle's own maxHeight to whatever's left above it, rather than
  // guessing -- a static reservation was tried and rejected first (see
  // bottomControlHeight's own comment): it would have clipped the
  // toggle's ordinary single-line case on any ~150px-tall image,
  // regardless of width, since it can't tell "the thumb group needs 96px
  // because it wrapped" apart from "it only needs 44px because it
  // didn't" without a real measurement.
  it('"de" at 84x150px (the previously-broken case): the thumb group is fully visible AND no longer overlaps the toggle', async () => {
    const page = await browser.newPage();
    try {
      const { wellRect, toggleRect, thumbsRect } = await measure(
        page,
        84,
        t.toggleBefore,
        t.toggleAfter
      );

      // The thumb group itself is never clipped by the well's own edges.
      expect(thumbsRect.top).toBeGreaterThanOrEqual(wellRect.top - 1);
      expect(thumbsRect.bottom).toBeLessThanOrEqual(wellRect.bottom + 1);

      // The toggle no longer extends past the thumb group's own top at
      // all -- this is now a hard guarantee (by construction: the
      // toggle's maxHeight is computed FROM the thumb group's real
      // measured position), not a bounded best-effort. +1 is float
      // rounding tolerance only.
      expect(toggleRect.bottom).toBeLessThanOrEqual(thumbsRect.top + 1);

      // The trade-off, reported honestly: closing the overlap means the
      // toggle's own visible area shrinks a lot in this specific extreme
      // case (measured ~18px tall, essentially just a sliver, vs. its
      // ~146px natural/unclipped size) -- accepted directly with the user
      // as better than either the thumb group disappearing (the original
      // bug) or the two controls visually overlapping (the regression
      // this round fixed). Bounded generously (40px, above the ~18px
      // measured) as a regression net, not a claim this is generous.
      const toggleVisibleHeight = toggleRect.bottom - toggleRect.top;
      expect(toggleVisibleHeight).toBeGreaterThan(0);
      expect(toggleVisibleHeight).toBeLessThanOrEqual(40);
    } finally {
      await page.close();
    }
  }, 15000);

  // The confirmation pill (feedbackState === 'thanks') replaces the thumb
  // group in the same bottom-right corner -- found in review: maxWidth
  // alone only caps the pill's own BOX width, it doesn't make unbreakable
  // words wrap WITHIN that box. scrollWidth > clientWidth is the real
  // signal (a box-edge comparison wouldn't catch this: the box itself
  // correctly stays within the well, only its TEXT CONTENT overflows it,
  // invisibly to a check that only looks at the box).
  const CONFIRMATION_PILL_STYLE = `
    position:absolute; bottom:14px; right:14px; flex-shrink:0;
    max-width:calc(100% - 28px); min-width:0; overflow-wrap:break-word;
    box-sizing:border-box; font-weight:600; font-size:11.5px; line-height:1.25;
    color:#201e1d; padding:11px 14px; border-radius:999px;
    background:rgba(255,255,255,.94); font-family:${FONT_STACK};
  `;
  for (const lang of ['ja', 'el', 'pt']) {
    // ja/el/pt: the three longest feedbackThanks strings by real rendered
    // width (measured with Puppeteer -- byte/character length is
    // misleading for CJK and Greek scripts, so this was measured, not
    // guessed: ja 201px, el 186px, pt 163.5px, vs. en/de mid-pack at
    // ~149px/136px). All three overflowed their own pill box at this
    // width before this fix (min-width:0 + overflow-wrap:break-word).
    it(`"${lang}" confirmation pill at 84px: text wraps within the pill instead of overflowing it`, async () => {
      const t = translations[lang];
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 124, height: 250 });
        await page.setContent(
          `<!DOCTYPE html><html><body style="margin:0; padding:20px;">
            <div id="well" style="position:relative; width:84px; height:${WELL_HEIGHT}px; overflow:hidden; box-sizing:border-box; background:#221a17;">
              <div class="confirmation-pill" style="${CONFIRMATION_PILL_STYLE}">${escapeHtml(t.feedbackThanks)}</div>
            </div>
          </body></html>`
        );
        const result = await page.evaluate(() => {
          const pill = document.querySelector('.confirmation-pill');
          return { clientWidth: pill.clientWidth, scrollWidth: pill.scrollWidth };
        });
        expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth + 1);
      } finally {
        await page.close();
      }
    }, 15000);
  }

  // Found in review: the width-only check above doesn't catch a
  // DIFFERENT overflow direction -- at 84px width the confirmation pill's
  // own wrapped TEXT can grow taller than the well itself. Japanese
  // (フィードバックありがとうございます。) wraps to ~9 short lines in a
  // ~28px-wide text column (56px pill width minus 14px horizontal padding
  // each side), and since the pill is bottom-anchored, growing past the
  // well's own height clips its TOP -- verified directly with a screenshot
  // cropped to the well's own bounds: the first line/character(s) are
  // genuinely cut off, not just theoretically over budget.
  //
  // Confirmed directly with the user (2026-09-19) as an accepted, final
  // trade-off rather than something to fix further: the hidden aria-live
  // region always carries the complete text regardless of this visual
  // clipping (screen readers are unaffected), the feedback click itself
  // already succeeded before this confirmation even renders (this is
  // purely a transient, 2200ms cosmetic acknowledgement, not a functional
  // failure), and it's bounded to one language at the single most extreme
  // image width. Reported honestly with a bounded regression net, not
  // silently ignored or asserted away.
  it('"ja" confirmation pill at 84x150px: the pill can be vertically clipped at the top -- accepted, bounded trade-off', async () => {
    const t = translations.ja;
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 124, height: 250 });
      await page.setContent(
        `<!DOCTYPE html><html><body style="margin:0; padding:20px;">
          <div id="well" style="position:relative; width:84px; height:${WELL_HEIGHT}px; overflow:hidden; box-sizing:border-box; background:#221a17;">
            <div class="confirmation-pill" style="${CONFIRMATION_PILL_STYLE}">${escapeHtml(t.feedbackThanks)}</div>
          </div>
        </body></html>`
      );
      const result = await page.evaluate(() => {
        const toPlain = r => ({ top: r.top, bottom: r.bottom });
        return {
          wellRect: toPlain(document.getElementById('well').getBoundingClientRect()),
          pillRect: toPlain(document.querySelector('.confirmation-pill').getBoundingClientRect()),
        };
      });
      const clippedBy = Math.max(0, result.wellRect.top - result.pillRect.top);
      // Real measured: ~15.4px. Bounded generously (30px, roughly double)
      // as a regression net against this getting dramatically worse
      // unnoticed, not a claim that 15px of clipping is ideal.
      expect(clippedBy).toBeLessThanOrEqual(30);
      // The pill's own BOTTOM must still land exactly at the well's own
      // bottom edge (its anchor point) -- if this ever fails, the pill
      // has drifted from its intended position entirely, a different and
      // more serious bug than the accepted top-clipping above.
      expect(result.pillRect.bottom).toBeLessThanOrEqual(result.wellRect.bottom + 1);
      expect(result.pillRect.bottom).toBeGreaterThanOrEqual(result.wellRect.bottom - 15);
    } finally {
      await page.close();
    }
  }, 15000);
});

/**
 * Found in review: the collision-avoidance formula (toggle maxHeight =
 * overlayHeight - 14 - bottomControlHeight - 14 - 8) doesn't care WHY the
 * overlay is short -- only that it is. The "Photo overlay" suite above
 * fixes width:150px, so it only exercises narrow-width-driven shortness
 * (both controls needing to wrap). This suite fixes a comfortably WIDE
 * well (300px -- the toggle never needs to wrap) and varies HEIGHT
 * instead, using the exact real image heights already established by the
 * "Result-step modal height" suite below for each viewport (400px
 * viewport -> ~106.6px image; 450px -> ~146.6px; 480px+ -> the full 150px
 * fallback) -- this is the SAME underlying concern raised earlier in this
 * PR about short viewports, now re-verified against the new formula
 * rather than assumed to no longer apply just because the old
 * maxHeightWithinBounds code was removed.
 *
 * Measured directly before writing any assertion: only the single most
 * extreme viewport (400px, ~106.6px image) actually clips a
 * comfortably-wide, never-wrapping toggle at all (~26.6px visible vs. its
 * ~40px natural single-line height) -- 450px and above leave enough room
 * even in this axis. Reported honestly as a real, bounded degradation
 * (same category as the narrow-width case) -- the only way to eliminate
 * it entirely would be scroll/reflow in the result view, which the user
 * explicitly decided against pursuing (2026-09-19, see the PR
 * conversation): the current bounded/documented behavior is accepted as
 * final, not a placeholder awaiting a future fix.
 */
describe('Photo overlay at short (not narrow) viewports: height alone can clip a normal, never-wrapping toggle', () => {
  let browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: process.env.CI !== 'false',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  const TOGGLE_GROUP_STYLE = `
    position:absolute; top:14px; left:14px; display:flex; flex-shrink:0;
    flex-wrap:wrap; max-width:calc(100% - 28px); box-sizing:border-box;
    gap:4px; padding:4px; border-radius:999px;
    background:rgba(255,255,255,.94);
  `;
  const PILL_BUTTON_STYLE = `
    box-sizing:border-box; border:0; border-radius:999px; padding:9px 16px;
    font-size:12px; font-weight:600; font-family:${FONT_STACK};
    background:${PRIMARY}; color:white; overflow-wrap:break-word;
    min-width:0; max-width:100%;
  `;
  const THUMB_HIT_TARGET_STYLE = `
    width:44px; height:44px; display:flex; align-items:center;
    justify-content:center; border:0; background:transparent; padding:0;
  `;
  const THUMB_CIRCLE_STYLE = `
    width:40px; height:40px; border-radius:50%; display:flex;
    align-items:center; justify-content:center;
    background:rgba(255,255,255,.94); box-sizing:border-box;
  `;
  const WELL_WIDTH = 300; // Comfortably wide -- the toggle never wraps here.

  const measure = async (page, wellHeight, before, after) => {
    await page.setViewport({ width: WELL_WIDTH + 40, height: 300 });
    await page.setContent(
      `<!DOCTYPE html><html><body style="margin:0; padding:20px;">
        <div id="well" style="
          position:relative; width:${WELL_WIDTH}px; height:${wellHeight}px;
          overflow:hidden; box-sizing:border-box; background:#221a17;
        ">
          <div class="toggle-group" style="${TOGGLE_GROUP_STYLE}">
            <button style="${PILL_BUTTON_STYLE}">${escapeHtml(before)}</button>
            <button style="${PILL_BUTTON_STYLE}">${escapeHtml(after)}</button>
          </div>
          <div id="bottom-control" style="position:absolute; bottom:14px; right:14px; max-width:calc(100% - 28px); box-sizing:border-box;">
            <div class="thumb-group" style="display:flex; flex-shrink:0; flex-wrap:wrap; gap:8px; justify-content:flex-end;">
              <button style="${THUMB_HIT_TARGET_STYLE}"><span style="${THUMB_CIRCLE_STYLE}"></span></button>
              <button style="${THUMB_HIT_TARGET_STYLE}"><span style="${THUMB_CIRCLE_STYLE}"></span></button>
            </div>
          </div>
        </div>
        <script>
          const well = document.getElementById('well');
          const toggle = document.querySelector('.toggle-group');
          const bottomControl = document.getElementById('bottom-control');
          const wellRect = well.getBoundingClientRect();
          const bottomControlRect = bottomControl.getBoundingClientRect();
          const bottomControlHeight = bottomControlRect.bottom - bottomControlRect.top;
          const overlayHeight = wellRect.bottom - wellRect.top;
          const maxHeight = Math.max(0, overlayHeight - 14 - bottomControlHeight - 14 - 8);
          toggle.style.maxHeight = maxHeight + 'px';
          toggle.style.overflow = 'hidden';
        </script>
      </body></html>`
    );
    return page.evaluate(() => {
      const toPlain = r => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
      return {
        wellRect: toPlain(document.getElementById('well').getBoundingClientRect()),
        toggleRect: toPlain(document.querySelector('.toggle-group').getBoundingClientRect()),
        thumbsRect: toPlain(document.querySelector('.thumb-group').getBoundingClientRect()),
      };
    });
  };

  const t = translations.en;

  // Real image heights at 480px viewport and above are the full 150px
  // fallback (measured via the "Result-step modal height" suite's own
  // fixture) -- comfortable, hard guarantee: neither control is clipped
  // at all in this wide, never-wrapping case.
  for (const wellHeight of [150]) {
    it(`at a comfortable ${wellHeight}px well height (480px viewport and taller): neither control is clipped`, async () => {
      const page = await browser.newPage();
      try {
        const { wellRect, toggleRect, thumbsRect } = await measure(
          page,
          wellHeight,
          t.toggleBefore,
          t.toggleAfter
        );
        expect(toggleRect.bottom).toBeLessThanOrEqual(wellRect.bottom + 1);
        expect(thumbsRect.bottom).toBeLessThanOrEqual(wellRect.bottom + 1);
        // Not just "clipped box stays in bounds" -- the toggle's natural
        // single-line height (~40px) must be FULLY represented, not
        // silently shrunk by the cap.
        expect(toggleRect.bottom - toggleRect.top).toBeGreaterThanOrEqual(38);
      } finally {
        await page.close();
      }
    }, 15000);
  }

  it('at a ~146.6px well height (450px viewport, real measured image height): still no clipping', async () => {
    const page = await browser.newPage();
    try {
      const { wellRect, toggleRect } = await measure(
        page,
        146.578125,
        t.toggleBefore,
        t.toggleAfter
      );
      expect(toggleRect.bottom).toBeLessThanOrEqual(wellRect.bottom + 1);
      expect(toggleRect.bottom - toggleRect.top).toBeGreaterThanOrEqual(38);
    } finally {
      await page.close();
    }
  }, 15000);

  it('at a ~106.6px well height (400px viewport, real measured image height): the toggle is clipped even though it never wraps -- open, bounded gap', async () => {
    const page = await browser.newPage();
    try {
      const { toggleRect } = await measure(page, 106.59375, t.toggleBefore, t.toggleAfter);
      const toggleVisibleHeight = toggleRect.bottom - toggleRect.top;
      // Real measured: ~26.6px (vs. its ~40px natural single-line
      // height). Bounded generously (35px, above the ~26.6px measured) as
      // a regression net, not a claim this is fine -- reported the same
      // way as every other accepted-degradation case in this file.
      expect(toggleVisibleHeight).toBeGreaterThan(0);
      expect(toggleVisibleHeight).toBeLessThanOrEqual(35);
    } finally {
      await page.close();
    }
  }, 15000);
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
 * A version of this tried giving the image's maxHeight extra headroom
 * beyond the real measurement, reasoning it would give the top band
 * (toggle + thumbs, added on the image itself in a later change) room to
 * wrap. That didn't actually work: resultContentRef (the wrapper this
 * measures) is its own separate overflow:hidden ancestor with an
 * independently flex-resolved height, so padding the image taller than
 * what's genuinely available just gets clipped by resultContentRef itself
 * -- see the maxHeight comment in RoomVisualizationFlow.tsx, and the "band
 * vs the real clipping hierarchy" suite below for what actually happens to
 * the band at short viewports. This suite only covers the image itself
 * (not the band): the image must never exceed what's genuinely measured,
 * full stop, at every viewport height in the matrix below.
 *
 * This renders the REAL header + REAL footer markup (all optional rows
 * present, using each language's actual translations) plus a mock image
 * sized with the same formula as production, inside a mock modal with the
 * real 80dvh cap + overflow:hidden.
 */
describe('Result-step modal height: image is never clipped by the footer', () => {
  let browser;

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
    //
    // 520/480/450/400 extend the matrix down into short-viewport territory
    // -- the image itself must never exceed the real measurement at any of
    // these, regardless of how little room that leaves for the band on top
    // of it (see the "band vs the real clipping hierarchy" suite below for
    // that separate question).
    for (const viewportHeight of [667, 640, 600, 568, 520, 480, 450, 400]) {
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
            border:none; flex:1 1 0; min-width:0; font-family:${FONT_STACK};
          `;

          const footerHtml = `
            <div style="padding:8px 16px 19px; background-color:#ffffff; flex-shrink:0; position:relative;">
              <div style="display:flex; flex-direction:column; gap:8px; width:100%; margin:0 auto; font-family:${FONT_STACK};">
                <div style="display:flex; gap:10px;">
                  <button style="flex-shrink:0; width:54px; height:54px; border-radius:999px; border:1.5px solid #7d7979;"></button>
                  <button style="flex:1; gap:8px; justify-content:center; text-align:center; font-weight:700; height:54px; border-radius:999px; display:flex; align-items:center; border:none; font-size:14px; padding:10px 16px; background:${PRIMARY}; color:white;">${escapeHtml(t.addToBasket)}</button>
                </div>
                <p style="margin:0 0 -4px; text-align:center; font-size:12px; line-height:1.45; color:#444141;">${escapeHtml(t.disclaimer)}</p>
                <div style="display:flex; justify-content:center; gap:4px;">
                  <button style="${tertiaryButtonStyle}">${escapeHtml(t.downloadToDevice)}</button>
                  <button style="${tertiaryButtonStyle}">${escapeHtml(t.shareWithFriends)}</button>
                  <button style="${tertiaryButtonStyle}">${escapeHtml(t.newPhoto)}</button>
                </div>
              </div>
              <!-- Absolutely positioned against this wrapper's own bottom
                   padding (not a flex child of the column above) -- 19px =
                   4px (same gap already used between the disclaimer and the
                   button row above) + 11px (this line's own height) + 4px
                   (to the widget's edge), not an arbitrary leftover value.
                   See RoomVisualizationFlow.tsx's renderResultFooterCredit. -->
              <p style="position:absolute; bottom:4px; left:0; right:0; margin:0; text-align:center; font-size:11px; line-height:1; color:#6b7280; font-family:${FONT_STACK};">Powered by GetRoomly</p>
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
                <div id="content-wrapper" style="position:relative; flex:1 1 auto; min-height:0; overflow:hidden; display:flex; align-items:flex-start; justify-content:center;">
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

/**
 * Copilot review on PR #118: the component/unit tests for the "Powered by
 * GetRoomly" credit line's spacing only assert CSS string values
 * (bottom:'4px', padding ending in '19px') via jsdom -- which has no real
 * layout engine, so they can prove the VALUES are what's intended without
 * proving those values actually PRODUCE a 4px visual gap once real CSS
 * cascade/box-model rules apply. This renders the real footer markup (the
 * same fixture as "Result-step modal height" above) in a real browser and
 * measures the three gaps directly, the same way the earlier manual
 * Puppeteer verification did (disclaimer-to-buttons, buttons-to-credit,
 * credit-to-widget-edge) -- confirming all three are genuinely equal, not
 * just that each CSS declaration looks correct in isolation.
 */
describe('Result footer "Powered by GetRoomly" credit: real gaps match the disclaimer-to-button-row gap', () => {
  let browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: process.env.CI !== 'false',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  it('measures a 4px gap disclaimer-to-buttons, buttons-to-credit, and credit-to-widget-edge -- all three equal', async () => {
    const t = translations.en;
    const tertiaryButtonStyle = `
      box-sizing:border-box; gap:8px; justify-content:center; align-items:center;
      text-align:center; min-height:44px; border-radius:999px; display:flex;
      font-size:14px; padding:10px 16px; background:none; color:#6b7280;
      font-weight:500; border:none; flex:1 1 0; min-width:0; font-family:${FONT_STACK};
    `;

    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 375, height: 300 });
      await page.setContent(
        `<!DOCTYPE html><html><body style="margin:0;">
          <div id="footer" style="padding:8px 16px 19px; background-color:#ffffff; position:relative; width:375px; box-sizing:border-box;">
            <div style="display:flex; flex-direction:column; gap:8px; width:100%; margin:0 auto; font-family:${FONT_STACK};">
              <div style="display:flex; gap:10px;">
                <button style="flex-shrink:0; width:54px; height:54px; border-radius:999px; border:1.5px solid #7d7979;"></button>
                <button style="flex:1; gap:8px; justify-content:center; text-align:center; font-weight:700; height:54px; border-radius:999px; display:flex; align-items:center; border:none; font-size:14px; padding:10px 16px; background:${PRIMARY}; color:white;">${escapeHtml(t.addToBasket)}</button>
              </div>
              <p id="disclaimer" style="margin:0 0 -4px; text-align:center; font-size:12px; line-height:1.45; color:#444141;">${escapeHtml(t.disclaimer)}</p>
              <div id="button-row" style="display:flex; justify-content:center; gap:4px;">
                <button style="${tertiaryButtonStyle}">${escapeHtml(t.downloadToDevice)}</button>
                <button style="${tertiaryButtonStyle}">${escapeHtml(t.shareWithFriends)}</button>
                <button style="${tertiaryButtonStyle}">${escapeHtml(t.newPhoto)}</button>
              </div>
            </div>
            <p id="credit" style="position:absolute; bottom:4px; left:0; right:0; margin:0; text-align:center; font-size:11px; line-height:1; color:#6b7280; font-family:${FONT_STACK};">Powered by GetRoomly</p>
          </div>
        </body></html>`
      );

      const gaps = await page.evaluate(() => {
        const footer = document.getElementById('footer');
        const disclaimer = document.getElementById('disclaimer');
        const buttonRow = document.getElementById('button-row');
        const credit = document.getElementById('credit');
        const dRect = disclaimer.getBoundingClientRect();
        const bRect = buttonRow.getBoundingClientRect();
        const cRect = credit.getBoundingClientRect();
        const fRect = footer.getBoundingClientRect();
        return {
          disclaimerToButtons: bRect.top - dRect.bottom,
          buttonsToCredit: cRect.top - bRect.bottom,
          creditToEdge: fRect.bottom - cRect.bottom,
        };
      });

      expect(gaps.disclaimerToButtons).toBe(4);
      expect(gaps.buttonsToCredit).toBe(4);
      expect(gaps.creditToEdge).toBe(4);
    } finally {
      await page.close();
    }
  }, 15000);
});

/**
 * Point 3 of the 2026-09 footer redesign replaced the tertiary row's
 * per-button `min-width` (a floor, not a ceiling -- a longer confirmation
 * label like "Downloaded ✓" still grew that one button's own natural width
 * and visibly pushed its siblings sideways) with `flex: 1 1 0; min-width: 0`
 * on all three buttons, so width is determined by the row, not by any one
 * button's text. jsdom can't be trusted for this (no real layout engine),
 * and the "Cross-language tertiary row overflow" suite above only exercises
 * each button's IDLE label -- never the moment right after a click, when
 * one button's label is longer than the other two's. This isolates exactly
 * that real-browser case: swap one button to its longest real confirmation
 * label and verify the row still doesn't overflow and all three buttons
 * stay equal width, instead of the old per-button min-width bug where only
 * the clicked button visibly grew.
 */
describe('Result footer tertiary row: button widths are label-independent', () => {
  let browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: process.env.CI !== 'false',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  const width = 375;
  const containerWidth = width - 32; // 16px padding each side, real footer

  const tertiaryButtonStyleFixture = `
    box-sizing:border-box; gap:8px; justify-content:center; align-items:center;
    text-align:center; min-height:44px; border-radius:999px; display:flex;
    font-size:14px; padding:10px 16px; background:none; color:#6b7280;
    font-weight:500; border:none; flex:1 1 0; min-width:0; font-family:${FONT_STACK};
  `;

  const measure = async (downloadLabel, shareLabel, newPhotoLabel) => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width, height: 300 });
      await page.setContent(
        `<!DOCTYPE html><html><body style="margin:0; padding:16px; box-sizing:border-box;">
          <div id="row" style="display:flex; justify-content:center; gap:4px; width:${containerWidth}px; box-sizing:border-box;">
            <button id="download-btn" style="${tertiaryButtonStyleFixture}">${escapeHtml(downloadLabel)}</button>
            <button id="share-btn" style="${tertiaryButtonStyleFixture}">${escapeHtml(shareLabel)}</button>
            <button id="newphoto-btn" style="${tertiaryButtonStyleFixture}">${escapeHtml(newPhotoLabel)}</button>
          </div>
        </body></html>`
      );
      return page.evaluate(() => {
        const row = document.getElementById('row');
        const widths = ['download-btn', 'share-btn', 'newphoto-btn'].map(
          id => document.getElementById(id).getBoundingClientRect().width
        );
        return {
          scrollWidth: row.scrollWidth,
          clientWidth: row.clientWidth,
          widths,
        };
      });
    } finally {
      await page.close();
    }
  };

  // German has consistently the longest translated confirmation labels in
  // this string set ("Hinzugefügt ✓", "Heruntergeladen ✓") -- the worst
  // case for this check, not an arbitrary pick.
  const t = translations.de;

  const expectEqualWidths = widths => {
    const maxWidth = Math.max(...widths);
    const minWidth = Math.min(...widths);
    expect(maxWidth - minWidth).toBeLessThanOrEqual(1.5);
  };

  it('all three buttons are equal width when idle', async () => {
    const idle = await measure(t.downloadToDevice, t.shareWithFriends, t.newPhoto);
    expect(idle.scrollWidth).toBeLessThanOrEqual(idle.clientWidth + 1);
    expectEqualWidths(idle.widths);
  }, 15000);

  it('swapping the download button to "Heruntergeladen ✓" does not grow it relative to its siblings, or overflow the row', async () => {
    const confirmed = await measure(t.downloadedLabel, t.shareWithFriends, t.newPhoto);
    expect(confirmed.scrollWidth).toBeLessThanOrEqual(confirmed.clientWidth + 1);
    expectEqualWidths(confirmed.widths);
  }, 15000);

  it('swapping the share button to "Kopiert ✓" does not grow it relative to its siblings, or overflow the row', async () => {
    const confirmed = await measure(t.downloadToDevice, t.copiedLabel, t.newPhoto);
    expect(confirmed.scrollWidth).toBeLessThanOrEqual(confirmed.clientWidth + 1);
    expectEqualWidths(confirmed.widths);
  }, 15000);
});
