// Zoom into the naming canvas and verify vector drawing + box alignment.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:3456';
const PID  = process.argv[3];
const PROBE = path.join(__dirname, '..', 'probe');
fs.mkdirSync(PROBE, { recursive: true });

if (!PID) { console.log('usage: node shoot_zoom.js <base> <projectId>'); process.exit(1); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  await page.goto(`${BASE}/project/${PID}/name`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Set drawing slider to 80% so we see the PDF drawing clearly
  const slider = page.locator('input[type=range]').first();
  if (await slider.count()) {
    await slider.fill('0.8');
    await slider.dispatchEvent('input');
    await page.waitForTimeout(300);
  }

  // Zoom in to the canvas by scrolling with wheel events at the canvas center
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width  * 0.5;
  const cy = box.y + box.height * 0.4;

  // Zoom in 8x (each deltaY=-120 is one click ≈ 1.12x zoom)
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(PROBE, 'zoom_naming.png') });
  console.log('screenshot saved: zoom_naming.png');
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
