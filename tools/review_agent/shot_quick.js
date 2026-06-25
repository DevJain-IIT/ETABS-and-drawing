const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto('http://localhost:3456/project/c199f54c74c7/floor', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);  // let canvas render
  await page.screenshot({ path: path.join(__dirname, 'probe', 'floor_text_fix.png'), fullPage: false });
  // Zoom into right pane for text details
  await page.screenshot({ path: path.join(__dirname, 'probe', 'floor_text_right.png'), clip: { x: 790, y: 110, width: 780, height: 600 } });
  await browser.close();
  console.log('done');
})();
