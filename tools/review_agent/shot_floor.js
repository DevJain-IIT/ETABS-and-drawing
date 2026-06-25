const { chromium } = require('playwright');
const path = require('path');

const SHOT = path.join(__dirname, 'probe', 'floor_page.png');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:3456/project/c199f54c74c7/floor', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: SHOT, fullPage: false });
  await browser.close();
  console.log('Screenshot saved to', SHOT);
})();
