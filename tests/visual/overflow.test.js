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
 * The top band (RoomVisualizationFlow.tsx, renderResultStep) holds the
 * Before/After toggle pill (left) and the feedback thumb group (right) as
 * siblings in one `flex-wrap` row -- see ANDRING-5b-bildkontroller.md,
 * "Ändring 6". "Före"/"Efter" is short in Swedish/English but much wider in
 * German ("Vorher"/"Nachher") and Finnish ("Ennen"/"Jälkeen"); on a narrow
 * or landscape-cropped photo the pill can grow enough to reach the thumbs'
 * corner. The fix is layout (flex-wrap + marginLeft:auto on the thumb
 * group), not per-language measurement -- deliberately, per the same
 * document: a pixel reservation needs per-locale upkeep and can still be
 * wrong at 200% zoom or a substituted system font.
 *
 * This renders the real band structure (toggle pill + thumb group,
 * matching the production inline styles) inside a mock image well and
 * checks two things: neither element is clipped by the well's
 * overflow:hidden, and -- the actual point of this suite -- the pill and
 * the thumb group never overlap, wrapping onto separate lines instead when
 * the well is too narrow for both on one line.
 */
describe('Top band: Before/After toggle + feedback thumbs never overlap or clip', () => {
  let browser;

  const BAND_STYLE = `
    position:absolute; top:14px; left:14px; right:14px; display:flex;
    flex-wrap:wrap; align-items:flex-start; justify-content:space-between;
    gap:10px;
  `;
  const PILL_STYLE = `
    display:flex; flex-shrink:0; flex-wrap:wrap; max-width:100%;
    box-sizing:border-box; gap:4px; padding:4px; border-radius:999px;
    background:rgba(255,255,255,.94); box-sizing:border-box;
  `;
  const PILL_BUTTON_STYLE = `
    box-sizing:border-box; border:0; border-radius:999px; padding:9px 16px;
    font-size:12px; font-weight:600; font-family:${FONT_STACK};
    background:${PRIMARY}; color:white; overflow-wrap:break-word;
    min-width:0; max-width:100%;
  `;
  // Matches the real component's feedback group exactly (flexWrap,
  // maxWidth, justify-content:flex-end) -- an earlier version of this
  // fixture omitted all three, so it never actually exercised the thumb
  // group's own internal-wrap path (found in review): at 140px well width
  // the 112px band is still wider than the group's 96px one-line content,
  // so wrapping never triggered there either way. See the 84px case below.
  const THUMB_GROUP_STYLE = `
    display:flex; flex-shrink:0; flex-wrap:wrap; max-width:100%;
    box-sizing:border-box; gap:8px; margin-left:auto; justify-content:flex-end;
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

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: process.env.CI !== 'false',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  const buildBandHtml = (before, after) => `
    <div class="band" style="${BAND_STYLE}">
      <div class="pill" style="${PILL_STYLE}">
        <button style="${PILL_BUTTON_STYLE}">${escapeHtml(before)}</button>
        <button style="${PILL_BUTTON_STYLE}">${escapeHtml(after)}</button>
      </div>
      <div class="thumb-group" style="${THUMB_GROUP_STYLE}">
        <button style="${THUMB_HIT_TARGET_STYLE}"><span style="${THUMB_CIRCLE_STYLE}"></span></button>
        <button style="${THUMB_HIT_TARGET_STYLE}"><span style="${THUMB_CIRCLE_STYLE}"></span></button>
      </div>
    </div>
  `;

  const measure = async (page, width, before, after) => {
    await page.setViewport({ width: width + 40, height: 500 });
    // No overflow:hidden or fixed height here, deliberately: the band no
    // longer renders inside imageContainerRef's own clipped well (see
    // renderTopBand's comment in RoomVisualizationFlow.tsx) -- only its
    // WIDTH is still bound by imageContainerRef's real measured width
    // (bandAnchor.width), which #well still faithfully models. Height is
    // now bounded only by the outer modal's own 80dvh cap, a completely
    // different, viewport-height-dependent budget covered by the "Top
    // band vs the real clipping hierarchy" suite below, not by anything
    // width-only fixture like this one could meaningfully assert against.
    await page.setContent(
      `<!DOCTYPE html><html><body style="margin:0; padding:20px;">
        <div id="well" style="
          position:relative; width:${width}px;
          box-sizing:border-box; background:#221a17;
        ">
          ${buildBandHtml(before, after)}
        </div>
      </body></html>`
    );
    return page.evaluate(() => {
      const toPlain = r => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
      const well = document.getElementById('well');
      const pill = document.querySelector('.pill');
      const thumbs = document.querySelector('.thumb-group');
      return {
        wellRect: toPlain(well.getBoundingClientRect()),
        pillRect: toPlain(pill.getBoundingClientRect()),
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
    // (added in review) is what keeps it from overflowing the well's
    // right edge even when alone on its own line.
    for (const width of [488, 328, 140, 84]) {
      it(`"${lang}" at ${width}px: toggle pill and thumb group don't overlap or clip`, async () => {
        const t = translations[lang];
        const page = await browser.newPage();
        try {
          const { wellRect, pillRect, thumbsRect } = await measure(
            page,
            width,
            t.toggleBefore,
            t.toggleAfter
          );

          // #well only constrains WIDTH now (see measure's comment) --
          // right and left are the two edges that constraint can
          // meaningfully be checked against. top is a basic sanity check
          // (nothing should render above its own container); there's no
          // bottom edge to check here at all, since height clipping is a
          // separate, viewport-dependent concern covered by the "Top band
          // vs the real clipping hierarchy" suite below.
          expect(pillRect.right).toBeLessThanOrEqual(wellRect.right + 1);
          expect(pillRect.left).toBeGreaterThanOrEqual(wellRect.left - 1);
          expect(pillRect.top).toBeGreaterThanOrEqual(wellRect.top - 1);
          expect(thumbsRect.right).toBeLessThanOrEqual(wellRect.right + 1);
          expect(thumbsRect.left).toBeGreaterThanOrEqual(wellRect.left - 1);
          expect(thumbsRect.top).toBeGreaterThanOrEqual(wellRect.top - 1);

          // Real flex layout can't produce overlapping siblings by
          // construction, but that guarantee only holds as long as
          // flex-wrap is actually in effect -- this is the regression net
          // for someone later removing it (or flexShrink:0) from either
          // element. Overlap means: NOT (side by side without crossing)
          // AND NOT (stacked on separate lines without crossing).
          const sideBySide = pillRect.right <= thumbsRect.left + 1;
          const stacked = pillRect.bottom <= thumbsRect.top + 1;
          expect(sideBySide || stacked).toBe(true);
        } finally {
          await page.close();
        }
      }, 15000);
    }
  }

  // Acceptance criterion from ANDRING-5b-bildkontroller.md: verify wrapping
  // specifically with the two longest real translation pairs, at the
  // narrowest well width in the matrix above.
  for (const [lang, label] of [
    ['de', 'Vorher/Nachher'],
    ['fi', 'Ennen/Jälkeen'],
  ]) {
    it(`"${lang}" (${label}) at 140px: the thumb group actually wraps to its own line, staying right-aligned`, async () => {
      const t = translations[lang];
      const page = await browser.newPage();
      try {
        const { wellRect, pillRect, thumbsRect } = await measure(
          page,
          140,
          t.toggleBefore,
          t.toggleAfter
        );

        // Wrapped, not squeezed onto the same line: the thumb group's top
        // is at or below the pill's bottom.
        expect(thumbsRect.top).toBeGreaterThanOrEqual(pillRect.bottom - 1);

        // marginLeft:auto still pushes the thumb group to the right edge
        // even when it's alone on its own line, not just when sharing a
        // line with justify-content:space-between.
        expect(thumbsRect.right).toBeGreaterThan(wellRect.right - 20);

        // The band is position:absolute inside the image well, which has
        // overflow:hidden -- wrapping only grows the band's own height, it
        // can't make the well taller. This isn't a pass/fail check against
        // any target (there's no artificial floor protecting against this
        // -- see the maxHeight comment in RoomVisualizationFlow.tsx for why
        // one was tried and reverted): it's a regression guard on the
        // band's own worst-case depth staying near where it was measured
        // (~144px when this was written), so a future change that makes it
        // meaningfully DEEPER doesn't go unnoticed. See the "band vs the
        // real clipping hierarchy" suite below for whether this depth
        // actually gets clipped at real viewport heights.
        const bandDepth = thumbsRect.bottom - wellRect.top;
        expect(bandDepth).toBeLessThanOrEqual(200);
      } finally {
        await page.close();
      }
    }, 15000);
  }

  // The confirmation pill (feedbackState === 'thanks') replaces the thumb
  // group in the same slot, but wasn't covered by buildBandHtml above at
  // all -- found in review: maxWidth:'100%' alone caps the pill's own BOX
  // width, but doesn't make unbreakable words wrap WITHIN that box.
  // scrollWidth > clientWidth is the real signal (a box-edge comparison
  // like the toggle/thumb checks above wouldn't catch this: the box
  // itself correctly stays within the well, only its TEXT CONTENT
  // overflows it, invisibly to a check that only looks at the box).
  const CONFIRMATION_PILL_STYLE = `
    margin-left:auto; flex-shrink:0; max-width:100%; min-width:0;
    overflow-wrap:break-word; box-sizing:border-box; font-weight:600;
    font-size:11.5px; line-height:1.25; color:#201e1d; padding:11px 14px;
    border-radius:999px; background:rgba(255,255,255,.94); font-family:${FONT_STACK};
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
            <div id="well" style="position:relative; width:84px; box-sizing:border-box; background:#221a17;">
              <div style="position:absolute; top:14px; left:14px; right:14px; display:flex; flex-wrap:wrap; align-items:flex-start; justify-content:space-between; gap:10px;">
                <div class="confirmation-pill" style="${CONFIRMATION_PILL_STYLE}">${escapeHtml(t.feedbackThanks)}</div>
              </div>
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
            border:none; font-family:${FONT_STACK};
          `;

          const footerHtml = `
            <div style="padding:8px 16px 16px; background-color:#ffffff; flex-shrink:0;">
              <div style="display:flex; flex-direction:column; gap:8px; width:100%; margin:0 auto; font-family:${FONT_STACK};">
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
 * "Top band: Before/After toggle + feedback thumbs never overlap or clip"
 * above tests the band in isolation, against a fixed-height mock well.
 * That doesn't model the real risk: the band used to be a child of
 * imageContainerRef, clipped by ITS overflow:hidden, but resultContentRef
 * -- a SEPARATE overflow:hidden ancestor with its own independently
 * flex-resolved height -- could clip it first, before the image's own
 * size ever mattered (Puppeteer-measured: resultContentRef's real height
 * crossed below the band's own worst-case depth, ~144px, somewhere
 * between 512-514px viewport height with the current footer). Real fix
 * (RoomVisualizationFlow.tsx's renderTopBand): the band now renders
 * OUTSIDE resultContentRef entirely, as a sibling positioned via
 * bandAnchor (imageContainerRef's own on-screen box, kept in sync with a
 * dedicated ResizeObserver) -- so it's bounded only by the outer modal's
 * own 80dvh budget, not by resultContentRef's tighter leftover-space
 * calculation.
 *
 * This models that real structure: the band as a sibling of the content
 * wrapper and footer (not nested inside either), positioned the same way
 * production does (offsetTop/Left/Width read off image-container, which
 * -- since nothing between it and the modal has its own position set --
 * resolve directly against the modal, matching how
 * .getroomly-modal-container's position:fixed + transform makes it the
 * real containing block in production).
 */
describe('Top band vs the real clipping hierarchy: rendered outside resultContentRef', () => {
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

  const t = translations.de; // Vorher/Nachher -- the worst-case toggle text.
  const width = 375;

  const measure = async viewportHeight => {
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
            <div style="display:flex; gap:10px;">
              <button style="flex-shrink:0; width:54px; height:54px; border-radius:999px; border:1.5px solid #7d7979;"></button>
              <button style="flex:1; height:54px; border-radius:999px; border:none; font-size:14px; background:${PRIMARY}; color:white;">${escapeHtml(t.addToBasket)}</button>
            </div>
            <p style="margin:0; text-align:center; font-size:12px; line-height:1.45; color:#444141;">${escapeHtml(t.disclaimer)}</p>
            <p style="margin:0; text-align:center; font-size:12px; font-weight:600; color:${PRIMARY};"></p>
            <div style="display:flex; flex-wrap:wrap; justify-content:center; gap:6px;">
              <button style="${tertiaryButtonStyle}">${escapeHtml(t.downloadToDevice)}</button>
              <button style="${tertiaryButtonStyle}">${escapeHtml(t.shareWithFriends)}</button>
              <button style="${tertiaryButtonStyle}">${escapeHtml(t.newPhoto)}</button>
            </div>
          </div>
        </div>
      `;
      const pillButtonStyle = `
        box-sizing:border-box; border:0; border-radius:999px; padding:9px 16px;
        font-size:12px; font-weight:600; font-family:${FONT_STACK};
        background:${PRIMARY}; color:white; overflow-wrap:break-word; min-width:0; max-width:100%;
      `;
      const bandHtml = `
        <div id="band" style="position:absolute; overflow:hidden; display:flex; flex-wrap:wrap; align-items:flex-start; justify-content:space-between; gap:10px; z-index:10;">
          <div style="display:flex; flex-shrink:0; flex-wrap:wrap; max-width:100%; box-sizing:border-box; gap:4px; padding:4px; border-radius:999px; background:rgba(255,255,255,.94);">
            <button style="${pillButtonStyle}">${escapeHtml(t.toggleBefore)}</button>
            <button style="${pillButtonStyle}">${escapeHtml(t.toggleAfter)}</button>
          </div>
          <div id="thumb-group" style="display:flex; flex-shrink:0; flex-wrap:wrap; max-width:100%; box-sizing:border-box; gap:8px; margin-left:auto; justify-content:flex-end;">
            <button style="width:44px; height:44px; display:flex; align-items:center; justify-content:center; border:0; background:transparent; padding:0;"><span style="width:40px; height:40px; border-radius:50%; display:flex; background:rgba(255,255,255,.94);"></span></button>
            <button style="width:44px; height:44px; display:flex; align-items:center; justify-content:center; border:0; background:transparent; padding:0;"><span style="width:40px; height:40px; border-radius:50%; display:flex; background:rgba(255,255,255,.94);"></span></button>
          </div>
        </div>
      `;

      // #content-wrapper is position:relative here, matching
      // resultContentRef's real style in RoomVisualizationFlow.tsx --
      // found in review that this fixture previously omitted it, which
      // meant image-container's offsetParent in the fixture was the
      // modal, while in the REAL component (resultContentRef genuinely
      // is position:relative) it's resultContentRef itself. That
      // mismatch let the old offsetTop/Left-based positioning bug (fixed
      // below, and in the real component) pass here undetected: the
      // fixture measured a different coordinate system than production
      // actually has. The band's own positioning script now mirrors
      // measureBandAnchor exactly (getBoundingClientRect subtraction
      // against the band's own offsetParent, not offsetTop/Left) so it's
      // correct regardless of what content-wrapper's position is.
      await page.setContent(
        `<!DOCTYPE html><html><body style="margin:0;">
          <div id="modal" style="max-height:80dvh; overflow:hidden; display:flex; flex-direction:column; position:relative; width:${width}px; box-sizing:border-box;">
            ${headerHtml}
            <div id="content-wrapper" style="position:relative; flex:1 1 auto; min-height:0; overflow:hidden; display:flex; align-items:flex-start; justify-content:center;">
              <div id="image-container" style="position:relative; display:inline-block; overflow:hidden;">
                <img id="result-image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3C/svg%3E" style="display:block; max-width:100%; max-height:150px; width:auto; height:auto;" />
              </div>
            </div>
            ${bandHtml}
            <div id="footer">${footerHtml}</div>
          </div>
          <script>
            const wrapper = document.getElementById('content-wrapper');
            const img = document.getElementById('result-image');
            const imageContainer = document.getElementById('image-container');
            const band = document.getElementById('band');
            const footer = document.getElementById('footer');

            function measureBand() {
              const containingEl = band.offsetParent || document.body;
              const imageRect = imageContainer.getBoundingClientRect();
              const containingRect = containingEl.getBoundingClientRect();
              const top = imageRect.top - containingRect.top;
              const left = imageRect.left - containingRect.left;
              const footerTop = footer.getBoundingClientRect().top - containingRect.top;
              const maxHeightBeforeFooter = Math.max(0, footerTop - (top + 14) - 8);
              band.style.top = (top + 14) + 'px';
              band.style.left = (left + 14) + 'px';
              band.style.width = Math.max(0, imageRect.width - 28) + 'px';
              band.style.maxHeight = maxHeightBeforeFooter + 'px';
            }

            const wrapperObserver = new ResizeObserver(entries => {
              img.style.maxHeight = entries[0].contentRect.height + 'px';
              window.__lastMeasuredHeight = entries[0].contentRect.height;
            });
            wrapperObserver.observe(wrapper);

            const imageContainerObserver = new ResizeObserver(() => {
              measureBand();
              window.__bandMeasured = true;
            });
            imageContainerObserver.observe(imageContainer);
            measureBand();
          </script>
        </body></html>`
      );
      await page.waitForFunction(
        () => window.__lastMeasuredHeight !== undefined && window.__bandMeasured
      );

      return page.evaluate(() => {
        const toPlain = r => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
        return {
          modalRect: toPlain(document.getElementById('modal').getBoundingClientRect()),
          footerRect: toPlain(document.getElementById('footer').getBoundingClientRect()),
          imageContainerRect: toPlain(
            document.getElementById('image-container').getBoundingClientRect()
          ),
          bandRect: toPlain(document.getElementById('band').getBoundingClientRect()),
          thumbGroupRect: toPlain(document.getElementById('thumb-group').getBoundingClientRect()),
        };
      });
    } finally {
      await page.close();
    }
  };

  // The full previous matrix (667 down to 400) -- all of it, including the
  // range that used to be below the ~514px threshold where clipping was
  // an accepted, documented gap. With the band moved outside
  // resultContentRef, it's now bounded only by the modal's own 80dvh cap,
  // which is far more generous -- verified this genuinely eliminates the
  // clipping down to 450px (previously broken from ~514px down). Only the
  // single most extreme case in this matrix (400px -- a very short
  // viewport, e.g. landscape phone) still clips, and far less badly than
  // before: at 400px, a landscape photo's aspect ratio makes
  // imageContainerRef not just short but also very narrow (~70px wide
  // when this was measured), which forces BOTH the toggle pill's buttons
  // AND the thumb group's circles into maximal internal wrapping at once
  // -- the band's own worst-case height in that specific combination
  // (~336px) can still exceed even the modal's generous cap (320px at
  // this viewport). Measured overshoot ~65px, down from ~143px before
  // this fix (against the tighter resultContentRef boundary) -- real,
  // substantial progress, not a full guarantee at the most extreme
  // viewport in this matrix.
  // The full previous matrix (667 down to 400), all of it now genuinely
  // clean: with the footer-safe cap (maxHeightBeforeFooter), the band's
  // own overflow:hidden always clips before reaching either the footer or
  // the modal's edge, by construction -- verified this holds uniformly
  // rather than needing a separate, weaker bound for the extreme case the
  // way the pre-footer-cap version of this suite did. The trade-off,
  // reported honestly: at the single most extreme viewport in this matrix
  // (400px), the footer-safe cap is much tighter than the modal's own cap
  // was (~31px of visible room vs. the ~143-65px of overlap a version
  // without this cap would have had) -- more of the band's content is
  // invisible there than before, not less. That's intentional: a control
  // that's cleanly clipped (this codebase's existing, already-accepted
  // degradation for pathological viewports) is a known, safe failure mode;
  // a control that visually overlaps the footer's cart button/disclaimer
  // is a new and worse one (found in review) -- this suite verifies the
  // worse one is now impossible, not that the existing one is eliminated.
  for (const viewportHeight of [667, 640, 600, 568, 520, 480, 450, 400]) {
    it(`at 375x${viewportHeight}: the band aligns with the image and never overlaps the footer or the modal edge`, async () => {
      const { modalRect, footerRect, imageContainerRect, bandRect } = await measure(viewportHeight);

      // The actual bug this round: the band used to measure its anchor
      // via offsetTop/Left, which (since resultContentRef is genuinely
      // position:relative) silently resolved relative to
      // resultContentRef rather than the band's own containing block,
      // landing it near the header instead of over the image. Confirms
      // it now lands in the right place, regardless of what's
      // position:relative in between.
      expect(bandRect.top).toBeCloseTo(imageContainerRect.top + 14, 0);
      expect(bandRect.left).toBeCloseTo(imageContainerRect.left + 14, 0);

      expect(bandRect.bottom).toBeLessThanOrEqual(footerRect.top + 1);
      expect(bandRect.bottom).toBeLessThanOrEqual(modalRect.bottom + 1);
    }, 15000);
  }
});

/**
 * The download-status <p> (RoomVisualizationFlow.tsx, in renderResultFooter)
 * used to permanently reserve 15px via minHeight, even though it's empty
 * except for the 2400ms after a download. That reservation was removed so
 * the line collapses to 0 when idle and only takes real space while the
 * confirmation message is actually showing -- reclaiming height for the
 * image the rest of the time. Neither of this file's other suites actually
 * exercises the idle (empty) case in a real browser: the jsdom component
 * test only checks the text is absent (not computed height), and the
 * "Result-step modal height" suite above always fills the status line with
 * real text -- so a regression that reintroduced minHeight would pass both
 * unnoticed. This isolates exactly that: same footer fixture, idle vs.
 * filled, in a real browser.
 */
describe('Result footer: idle download-status line collapses instead of reserving space', () => {
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

  // English only -- this is a CSS-structural check (does the empty <p>
  // collapse), not a translated-text-length one, so it doesn't need every
  // language the way the pill/button overflow suites above do.
  const t = translations.en;
  const width = 375;
  const viewportHeight = 568;

  const buildFooterHtml = statusText => `
    <div id="result-footer" style="padding:8px 16px 16px; background-color:#ffffff; flex-shrink:0;">
      <div style="display:flex; flex-direction:column; gap:8px; width:100%; margin:0 auto; font-family:${FONT_STACK};">
        <div style="display:flex; gap:10px;">
          <button style="flex-shrink:0; width:54px; height:54px; border-radius:999px; border:1.5px solid #7d7979;"></button>
          <button style="flex:1; gap:8px; justify-content:center; text-align:center; font-weight:700; height:54px; border-radius:999px; display:flex; align-items:center; border:none; font-size:14px; padding:10px 16px; background:${PRIMARY}; color:white;">${escapeHtml(t.addToBasket)}</button>
        </div>
        <p style="margin:0; text-align:center; font-size:12px; line-height:1.45; color:#444141;">${escapeHtml(t.disclaimer)}</p>
        <p id="status-line" style="margin:0; text-align:center; font-size:12px; font-weight:600; color:${PRIMARY};">${escapeHtml(statusText)}</p>
        <div style="display:flex; flex-wrap:wrap; justify-content:center; gap:6px;">
          <button style="${tertiaryButtonStyleFixture}">${escapeHtml(t.downloadToDevice)}</button>
          <button style="${tertiaryButtonStyleFixture}">${escapeHtml(t.shareWithFriends)}</button>
          <button style="${tertiaryButtonStyleFixture}">${escapeHtml(t.newPhoto)}</button>
        </div>
      </div>
    </div>
  `;

  const tertiaryButtonStyleFixture = `
    gap:8px; justify-content:center; align-items:center; text-align:center;
    min-height:44px; border-radius:999px; display:flex; font-size:14px;
    padding:10px 16px; background:none; color:#6b7280; font-weight:500;
    border:none; font-family:${FONT_STACK};
  `;

  const headerHtml = `
    <div style="display:flex; flex-direction:row; align-items:center; padding:4px 16px; flex-shrink:0; gap:4px; font-family:${FONT_STACK};">
      <div style="width:28px; flex-shrink:0;"></div>
      <h2 style="flex:1; text-align:center; font-size:18px; font-weight:bold; letter-spacing:-0.025em; margin:0;">${escapeHtml(t.stepResult)}</h2>
      <button style="flex-shrink:0; width:28px; height:28px; border-radius:50%; border:none;"></button>
    </div>
  `;

  // Mirrors the real component's ResizeObserver-driven image sizing (see
  // the "Result-step modal height" suite above for the full rationale) so
  // the geometry comparison below reflects genuine available space, not an
  // artifact of a fixed image size.
  const measure = async statusText => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width, height: viewportHeight });
      await page.setContent(
        `<!DOCTYPE html><html><body style="margin:0;">
          <div id="modal" style="max-height:80dvh; overflow:hidden; display:flex; flex-direction:column; width:${width}px; box-sizing:border-box;">
            ${headerHtml}
            <div id="content-wrapper" style="position:relative; flex:1 1 auto; min-height:0; overflow:hidden; display:flex; align-items:flex-start; justify-content:center;">
              <img id="result-image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3C/svg%3E" style="display:block; max-width:100%; max-height:150px; width:auto; height:auto;" />
            </div>
            ${buildFooterHtml(statusText)}
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
      return page.evaluate(() => ({
        statusLineHeight: document.getElementById('status-line').getBoundingClientRect().height,
        wrapperHeight: document.getElementById('content-wrapper').getBoundingClientRect().height,
        footerHeight: document.getElementById('result-footer').getBoundingClientRect().height,
      }));
    } finally {
      await page.close();
    }
  };

  it('the empty status line renders at 0 height in a real browser (not the old 15px minHeight)', async () => {
    const idle = await measure('');
    expect(idle.statusLineHeight).toBe(0);
  }, 15000);

  it('the filled status line renders at its real text height, not 0', async () => {
    const filled = await measure(t.downloadedStatus);
    expect(filled.statusLineHeight).toBeGreaterThan(0);
  }, 15000);

  // Compares the footer's own rendered height, not the image well's --
  // whether the wrapper (and therefore the image) actually gets taller
  // depends on the modal's 80dvh cap being engaged in the first place,
  // which varies by viewport/footer-content combination (below the cap,
  // flex-grow has no established container size to expand into, so the
  // footer shrinking doesn't hand the image anything). The footer's own
  // height shrinking is the direct, viewport-independent consequence of
  // removing minHeight -- it's what makes more room possible whenever the
  // cap IS engaged, which the "Result-step modal height" suite above
  // covers across 16 languages x 4 viewport heights.
  it('the footer itself renders shorter when idle than when the status message is showing', async () => {
    const idle = await measure('');
    const filled = await measure(t.downloadedStatus);
    expect(idle.footerHeight).toBeLessThan(filled.footerHeight);
  }, 20000);
});
