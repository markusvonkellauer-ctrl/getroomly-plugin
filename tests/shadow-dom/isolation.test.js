/**
 * @jest-environment node
 *
 * Puppeteer drives a real, separate Chrome process over the Node.js CDP
 * client — jest.config.js's global `testEnvironment: 'jsdom'` provides a
 * fake window/document this file doesn't use, but jsdom's environment
 * patching interferes with Puppeteer's own Node networking/process
 * handling badly enough to hang page operations indefinitely. See
 * tests/visual/overflow.test.js for where this was diagnosed.
 *
 * Shadow DOM CSS Isolation Test
 *
 * Tests that the GetRoomly plugin is properly isolated from external CSS
 * and renders correctly regardless of aggressive host page styling.
 */

const puppeteer = require('puppeteer');
const path = require('path');

describe('Shadow DOM CSS Isolation', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: process.env.CI !== 'false',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    // Create aggressive CSS test page
    const aggressiveCssHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Shadow DOM Isolation Test</title>
  <style>
    /* AGGRESSIVE CSS - Should NOT affect Shadow DOM */
    * {
      color: red !important;
      background: yellow !important;
      border: 5px solid purple !important;
      font-size: 40px !important;
      font-family: "Comic Sans MS" !important;
      padding: 20px !important;
      margin: 10px !important;
      text-transform: uppercase !important;
    }
    button {
      background: orange !important;
      color: lime !important;
      transform: rotate(45deg) !important;
      border-radius: 50px !important;
    }
    .modal, [role="dialog"] {
      background: magenta !important;
      transform: skew(45deg) !important;
    }
  </style>
</head>
<body>
  <div id="host-content">
    <h1>Aggressive CSS Host Page</h1>
    <button>Host Button (Should be ugly)</button>
    <div id="getroomly-container"></div>
  </div>

  <script>
    window.GetRoomlyEmbedConfig = {
      productImage: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="gray"/></svg>',
      sku: 'test-001',
      productName: 'Test Product',
      productPrice: 9999,
      category: 'Test'
    };
  </script>
  <script type="module" src="http://localhost:5173/src/main.tsx"></script>
</body>
</html>`;

    await page.setContent(aggressiveCssHtml);
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  test('Plugin container creates shadow root', async () => {
    const hasShadowRoot = await page.evaluate(() => {
      const container = document.querySelector('#getroomly-container');
      return container && container.shadowRoot ? true : false;
    });

    expect(hasShadowRoot).toBe(true);
  });

  test('Plugin button is not affected by aggressive host CSS', async () => {
    const buttonStyles = await page.evaluate(() => {
      const container = document.querySelector('#getroomly-container');
      if (!container?.shadowRoot) return null;

      const button = container.shadowRoot.querySelector('button');
      if (!button) return null;

      const styles = window.getComputedStyle(button);
      return {
        backgroundColor: styles.backgroundColor,
        color: styles.color,
        fontSize: styles.fontSize,
        fontFamily: styles.fontFamily,
        transform: styles.transform,
      };
    });

    expect(buttonStyles).not.toBeNull();

    // Verify the button is NOT affected by host CSS
    expect(buttonStyles.fontFamily).not.toMatch(/Comic Sans/i);
    expect(buttonStyles.backgroundColor).not.toBe('orange');
    expect(buttonStyles.transform).not.toMatch(/rotate/);
  });

  test('Host elements are affected by aggressive CSS', async () => {
    const hostButtonStyles = await page.evaluate(() => {
      const hostButton = document.querySelector('#host-content button');
      const styles = window.getComputedStyle(hostButton);
      return {
        backgroundColor: styles.backgroundColor,
        color: styles.color,
        fontFamily: styles.fontFamily,
      };
    });

    // Verify host elements ARE affected by aggressive CSS
    expect(hostButtonStyles.fontFamily).toMatch(/Comic Sans/i);
  });

  test('Modal content is isolated when opened', async () => {
    // Click plugin button to open modal
    await page.evaluate(() => {
      const container = document.querySelector('#getroomly-container');
      const button = container?.shadowRoot?.querySelector('button');
      if (button) button.click();
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    const modalStyles = await page.evaluate(() => {
      const container = document.querySelector('#getroomly-container');
      const modal = container?.shadowRoot?.querySelector('[role="dialog"]');
      if (!modal) return null;

      const styles = window.getComputedStyle(modal);
      return {
        backgroundColor: styles.backgroundColor,
        transform: styles.transform,
      };
    });

    expect(modalStyles).not.toBeNull();
    expect(modalStyles.transform).not.toMatch(/skew/);
  });

  test('Plugin event handling works correctly', async () => {
    const clickHandled = await page.evaluate(() => {
      return new Promise(resolve => {
        const container = document.querySelector('#getroomly-container');
        const button = container?.shadowRoot?.querySelector('button');

        if (!button) {
          resolve(false);
          return;
        }

        button.addEventListener('click', () => resolve(true));
        button.click();

        setTimeout(() => resolve(false), 1000);
      });
    });

    expect(clickHandled).toBe(true);
  });
});

// Separate describe/browser session, not reusing the suite above's page --
// that one is built via page.setContent() with a script tag pointing at
// localhost:5173, which Chrome treats as loaded from a null/opaque origin
// and CORS-blocks the cross-origin module fetch entirely (pre-existing
// breakage in the suite above, unrelated to this file's own changes --
// confirmed by the very first test above, "Plugin container creates shadow
// root", already failing the same way against `development`). Real
// navigation via page.goto() to a fixture Vite serves keeps everything on
// the same origin, avoiding that problem outright.
describe('Shadow DOM focus trap (real ShadowRoot boundary)', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: process.env.CI !== 'false',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
    await page.goto('http://localhost:5173/tests/shadow-dom/fixtures/embed.html', {
      waitUntil: 'networkidle0',
    });
  });

  afterAll(async () => {
    if (browser) await browser.close();
  });

  // Regression coverage for a Copilot review finding on PR #115: the focus
  // trap's boundary check originally compared against document.activeElement,
  // which stops at the shadow HOST element (<getroomly-plugin>) when focus
  // is actually on a descendant inside a real ShadowRoot -- meaning the
  // trap silently never engaged in production. jsdom-based unit tests
  // (tests/components/App.test.jsx) can't catch this at all: RTL renders
  // directly into document.body, with no real shadow boundary to trip over
  // -- this is the one place that boundary actually exists. Verified this
  // reproduces: reverting the getRootNode()-based fix back to plain
  // document.activeElement here made this test fail with the active
  // element landing on <body>, confirming Tab genuinely escaped the shadow
  // tree entirely, not just failing to wrap within it.
  test("Tab wraps within the shadow root's own dialog and never escapes to the host page (real Shadow DOM boundary)", async () => {
    await page.evaluate(() => {
      const el = document.querySelector('getroomly-plugin');
      const button = el?.shadowRoot?.querySelector('button');
      if (button) button.click();
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    const focusedLast = await page.evaluate(() => {
      const el = document.querySelector('getroomly-plugin');
      const dialog = el?.shadowRoot?.querySelector('[role="dialog"]');
      if (!dialog) return false;
      const focusable = Array.from(
        dialog.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(node => getComputedStyle(node).display !== 'none');
      if (focusable.length === 0) return false;
      focusable[focusable.length - 1].focus();
      return true;
    });
    expect(focusedLast).toBe(true);

    // A real Tab keypress -- Puppeteer drives actual browser tab-order
    // navigation here, unlike jsdom's fireEvent (which never performs real
    // focus movement on its own).
    await page.keyboard.press('Tab');

    const result = await page.evaluate(() => {
      const el = document.querySelector('getroomly-plugin');
      const dialog = el?.shadowRoot?.querySelector('[role="dialog"]');
      const active = el?.shadowRoot?.activeElement;
      return {
        dialogFound: !!dialog,
        activeInsideDialog: !!dialog && !!active && dialog.contains(active),
      };
    });

    expect(result.dialogFound).toBe(true);
    expect(result.activeInsideDialog).toBe(true);
  });

  // Regression coverage for a Copilot review finding on the same PR (#115),
  // found on a LATER review round after the boundary-check fix above had
  // already landed: the capture-on-open call site had the identical Shadow
  // DOM problem, just not yet fixed there too -- document.activeElement at
  // the moment the dialog opens is the <getroomly-plugin> host (not the
  // real trigger button that was clicked), so the later restore-on-close
  // called .focus() on that inert host element instead of the actual
  // trigger, leaving focus stuck on <body>/page after Escape.
  test('restores focus to the real trigger button inside the ShadowRoot on close, not the inert <getroomly-plugin> host', async () => {
    // Starts from a clean (closed) state regardless of what the previous
    // test left behind.
    const openInitially = await page.evaluate(
      () =>
        !!document.querySelector('getroomly-plugin')?.shadowRoot?.querySelector('[role="dialog"]')
    );
    if (openInitially) {
      await page.keyboard.press('Escape');
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    await page.evaluate(() => {
      const el = document.querySelector('getroomly-plugin');
      const button = el?.shadowRoot?.querySelector('button');
      button?.focus();
      button?.click();
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    const dialogOpen = await page.evaluate(
      () =>
        !!document.querySelector('getroomly-plugin')?.shadowRoot?.querySelector('[role="dialog"]')
    );
    expect(dialogOpen).toBe(true);

    await page.keyboard.press('Escape');
    await new Promise(resolve => setTimeout(resolve, 300));

    const result = await page.evaluate(() => {
      const el = document.querySelector('getroomly-plugin');
      const active = el?.shadowRoot?.activeElement;
      return {
        dialogClosed: !el?.shadowRoot?.querySelector('[role="dialog"]'),
        activeIsRealButton: active?.tagName === 'BUTTON',
      };
    });

    expect(result.dialogClosed).toBe(true);
    // Not just "something got focus" -- specifically the real trigger
    // button, not the shadow host itself (which has no meaningful
    // .focus() target of its own).
    expect(result.activeIsRealButton).toBe(true);
  });
});
