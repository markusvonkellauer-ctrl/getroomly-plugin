/**
 * End-to-End Full Workflow Test
 *
 * Tests the complete user journey from button click to image generation
 */

const puppeteer = require('puppeteer');

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
    await page.goto('http://localhost:5174');
    await page.waitForSelector('.getroomly-embed button', { timeout: 10000 });

    // 2. Click embed button
    await page.click('.getroomly-embed button');
    await page.waitForTimeout(1000);

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
    await page.click('button:contains("Generate Visualization")');

    // 7. Wait for processing
    await page.waitForSelector('h2:contains("Creating your visualization")', { timeout: 2000 });

    // 8. Wait for result (mock API response)
    await page.waitForSelector('img[alt="Generated visualization"]', { timeout: 30000 });

    // 9. Verify download button appears
    const downloadButton = await page.$('button:contains("Download")');
    expect(downloadButton).not.toBeNull();

    // 10. Test new photo button
    await page.click('button:contains("Try New Photo")');
    await page.waitForSelector('h2:contains("Upload a room photo")', { timeout: 2000 });
  }, 60000); // 1 minute timeout for full workflow

  test('Error handling: invalid file upload', async () => {
    await page.goto('http://localhost:5174');
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
    await page.goto('http://localhost:5174');
    await page.click('.getroomly-embed button');

    // Click close button
    await page.click('button:contains("×")');
    await page.waitForTimeout(500);

    // Verify modal is closed
    const modalVisible = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"]');
      return modal && modal.style.display !== 'none';
    });
    expect(modalVisible).toBe(false);
  });
});
