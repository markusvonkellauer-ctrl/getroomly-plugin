/**
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
      args: ['--no-sandbox', '--disable-setuid-sandbox']
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
  <script type="module" src="http://localhost:5174/src/main.tsx"></script>
</body>
</html>`;

    await page.setContent(aggressiveCssHtml);
    await page.waitForTimeout(2000);
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
        transform: styles.transform
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
        fontFamily: styles.fontFamily
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

    await page.waitForTimeout(1000);

    const modalStyles = await page.evaluate(() => {
      const container = document.querySelector('#getroomly-container');
      const modal = container?.shadowRoot?.querySelector('[role="dialog"]');
      if (!modal) return null;

      const styles = window.getComputedStyle(modal);
      return {
        backgroundColor: styles.backgroundColor,
        transform: styles.transform
      };
    });

    expect(modalStyles).not.toBeNull();
    expect(modalStyles.transform).not.toMatch(/skew/);
  });

  test('Plugin event handling works correctly', async () => {
    const clickHandled = await page.evaluate(() => {
      return new Promise((resolve) => {
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