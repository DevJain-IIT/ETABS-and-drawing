const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto('http://localhost:3456/project/c199f54c74c7/floor', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Full page
  await page.screenshot({ path: path.join(__dirname, 'probe', 'floor_full.png'), fullPage: false });

  // Crop left pane
  await page.screenshot({ path: path.join(__dirname, 'probe', 'floor_left.png'), clip: { x: 0, y: 110, width: 780, height: 600 } });

  // Crop right pane
  await page.screenshot({ path: path.join(__dirname, 'probe', 'floor_right.png'), clip: { x: 790, y: 110, width: 780, height: 600 } });

  await browser.close();
  console.log('done');
})();
