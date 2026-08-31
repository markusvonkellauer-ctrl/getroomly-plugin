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
 * End-to-End Full Workflow Test
 *
 * Tests the complete user journey from button click to image generation
 */

const puppeteer = require('puppeteer');
const path = require('path');

describe('Full Plugin Workflow E2E', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({ headless: false });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  test('Complete workflow: button click → upload → generate → download', async () => {
    // 1. Load plugin
    await page.goto('http://localhost:5173');
    await page.waitForSelector('.getroomly-embed button', { timeout: 10000 });

    // 2. Click embed button
    await page.click('.getroomly-embed button');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. Verify modal opens
    const modalVisible = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"]');
      return modal && modal.style.display !== 'none';
    });
    expect(modalVisible).toBe(true);

    // 4. Upload test image
    const testImagePath = path.join(__dirname, '../fixtures/test-room.jpg');
    await page.waitForSelector('input[type="file"]');
    const fileInput = await page.$('input[type="file"]');
    await fileInput.uploadFile(testImagePath);

    // 5. Wait for image preview
    await page.waitForSelector('img[alt="Uploaded room"]', { timeout: 5000 });

    // 6. Click generate button
    // :contains(...) is a jQuery pseudo-selector — not valid CSS, and
    // Puppeteer's click()/waitForSelector() resolve through the browser's
    // real querySelector, so it throws at runtime rather than matching
    // anything. ::-p-text(...) is Puppeteer's own native text-matching
    // pseudo-selector (Puppeteer >=22), confirmed working against this
    // installed version (^23.11.1) with a standalone smoke test before
    // applying it here.
    await page.click('button::-p-text(Generate Visualization)');

    // 7. Wait for processing
    await page.waitForSelector('h2::-p-text(Creating your visualization)', { timeout: 2000 });

    // 8. Wait for result (mock API response)
    await page.waitForSelector('img[alt="Generated visualization"]', { timeout: 30000 });

    // 9. Verify download button appears
    const downloadButton = await page.$('button::-p-text(Download)');
    expect(downloadButton).not.toBeNull();

    // 10. Test new photo button
    await page.click('button::-p-text(Try New Photo)');
    await page.waitForSelector('h2::-p-text(Upload a room photo)', { timeout: 2000 });
  }, 60000); // 1 minute timeout for full workflow

  test('Error handling: invalid file upload', async () => {
    await page.goto('http://localhost:5173');
    await page.click('.getroomly-embed button');

    // Try to upload invalid file type
    const testFilePath = path.join(__dirname, '../fixtures/test.txt');
    const fileInput = await page.$('input[type="file"]');
    await fileInput.uploadFile(testFilePath);

    // Verify error message appears
    await page.waitForSelector('[style*="color: #c33"]', { timeout: 5000 });
    const errorText = await page.$eval('[style*="color: #c33"]', el => el.textContent);
    expect(errorText).toContain('Invalid file');
  });

  test('Modal close functionality', async () => {
    await page.goto('http://localhost:5173');
    await page.click('.getroomly-embed button');

    // Click close button
    await page.click('button::-p-text(×)');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify modal is closed
    const modalVisible = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"]');
      return modal && modal.style.display !== 'none';
    });
    expect(modalVisible).toBe(false);
  });
});
